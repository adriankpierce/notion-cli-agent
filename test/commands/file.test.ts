import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

describe('File Command', () => {
  let program: Command;
  let mockClient: any;
  let mockFS: Map<string, Buffer | string>;

  beforeEach(async () => {
    vi.resetModules();
    mockFS = new Map();

    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      sendFile: vi.fn(),
    };

    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    vi.doMock('fs', () => ({
      readFileSync: vi.fn((path: string) => {
        if (mockFS.has(path)) return mockFS.get(path);
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }),
      existsSync: vi.fn((path: string) => mockFS.has(path)),
    }));

    const { registerFileCommand } = await import('../../src/commands/file');
    program = new Command();
    registerFileCommand(program);
  });

  describe('file upload', () => {
    it('should upload a local image file', async () => {
      const fileBuffer = Buffer.from('fake-image-data');
      mockFS.set('/tmp/photo.jpg', fileBuffer);

      mockClient.post.mockResolvedValueOnce({ id: 'upload-123' }); // create
      mockClient.sendFile.mockResolvedValueOnce({ id: 'upload-123', status: 'uploaded' }); // send
      mockClient.patch.mockResolvedValueOnce({ results: [{ id: 'block-1' }] }); // attach

      await program.parseAsync(['node', 'test', 'file', 'upload', 'page-123', '/tmp/photo.jpg']);

      // Step 1: create file upload
      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'single_part',
      });

      // Step 2: send binary with MIME type
      expect(mockClient.sendFile).toHaveBeenCalledWith(
        'file_uploads/upload-123/send',
        fileBuffer,
        'photo.jpg',
        'image/jpeg',
      );

      // Step 3: attach as image block
      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'image',
          image: {
            type: 'file_upload',
            file_upload: { id: 'upload-123' },
            caption: [],
          },
        }],
      });

      expect(console.log).toHaveBeenCalledWith('Uploaded photo.jpg as image block');
    });

    it('should upload from external URL', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 'upload-456', status: 'pending' }); // create with external_url
      mockClient.get.mockResolvedValueOnce({ id: 'upload-456', status: 'uploaded' }); // poll status
      mockClient.patch.mockResolvedValueOnce({ results: [{ id: 'block-1' }] }); // attach

      await program.parseAsync([
        'node', 'test', 'file', 'upload', 'page-123',
        '--url', 'https://example.com/document.pdf',
      ]);

      // Should create with external_url mode
      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'external_url',
        external_url: 'https://example.com/document.pdf',
        filename: 'document.pdf',
      });

      // Should NOT call sendFile
      expect(mockClient.sendFile).not.toHaveBeenCalled();

      // Should attach as pdf block
      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'pdf',
          pdf: {
            type: 'file_upload',
            file_upload: { id: 'upload-456' },
            caption: [],
          },
        }],
      });
    });

    it('should detect block type from extension', async () => {
      const testCases = [
        { file: 'video.mp4', expectedType: 'video' },
        { file: 'song.mp3', expectedType: 'audio' },
        { file: 'doc.pdf', expectedType: 'pdf' },
        { file: 'data.csv', expectedType: 'file' },
        { file: 'photo.png', expectedType: 'image' },
      ];

      for (const { file, expectedType } of testCases) {
        vi.clearAllMocks();
        mockFS.set(`/tmp/${file}`, Buffer.from('data'));
        mockClient.post.mockResolvedValueOnce({ id: 'upload-id' });
        mockClient.sendFile.mockResolvedValueOnce({ id: 'upload-id', status: 'uploaded' });
        mockClient.patch.mockResolvedValueOnce({ results: [] });

        await program.parseAsync(['node', 'test', 'file', 'upload', 'page-123', `/tmp/${file}`]);

        expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
          children: [expect.objectContaining({ type: expectedType })],
        });
      }
    });

    it('should add caption when --caption is provided', async () => {
      mockFS.set('/tmp/photo.jpg', Buffer.from('data'));
      mockClient.post.mockResolvedValueOnce({ id: 'upload-123' });
      mockClient.sendFile.mockResolvedValueOnce({ id: 'upload-123', status: 'uploaded' });
      mockClient.patch.mockResolvedValueOnce({ results: [] });

      await program.parseAsync([
        'node', 'test', 'file', 'upload', 'page-123', '/tmp/photo.jpg',
        '--caption', 'My vacation photo',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'image',
          image: {
            type: 'file_upload',
            file_upload: { id: 'upload-123' },
            caption: [{ type: 'text', text: { content: 'My vacation photo' } }],
          },
        }],
      });
    });

    it('should insert at top when --position top', async () => {
      mockFS.set('/tmp/photo.jpg', Buffer.from('data'));
      mockClient.post.mockResolvedValueOnce({ id: 'upload-123' });
      mockClient.sendFile.mockResolvedValueOnce({ id: 'upload-123', status: 'uploaded' });
      mockClient.get.mockResolvedValueOnce({
        results: [{ id: 'first-block-id' }],
      });
      mockClient.patch.mockResolvedValueOnce({ results: [] });

      await program.parseAsync([
        'node', 'test', 'file', 'upload', 'page-123', '/tmp/photo.jpg',
        '--position', 'top',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children', { page_size: 1 });
      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [expect.objectContaining({ type: 'image' })],
        position: { before_block: 'first-block-id' },
      });
    });

    it('should output JSON with --json', async () => {
      mockFS.set('/tmp/photo.jpg', Buffer.from('data'));
      mockClient.post.mockResolvedValueOnce({ id: 'upload-123' });
      mockClient.sendFile.mockResolvedValueOnce({ id: 'upload-123', status: 'uploaded' });
      mockClient.patch.mockResolvedValueOnce({ results: [{ id: 'block-1', type: 'image' }] });

      await program.parseAsync([
        'node', 'test', 'file', 'upload', 'page-123', '/tmp/photo.jpg', '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"block-1"'));
    });

    it('should error when file not found', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'file', 'upload', 'page-123', '/tmp/missing.jpg'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    });

    it('should error when neither file nor --url provided', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'file', 'upload', 'page-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error: Provide a file path or --url');
    });

    it('should error when both file and --url provided', async () => {
      mockFS.set('/tmp/photo.jpg', Buffer.from('data'));

      await expect(
        program.parseAsync([
          'node', 'test', 'file', 'upload', 'page-123', '/tmp/photo.jpg',
          '--url', 'https://example.com/photo.jpg',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error: Provide either a file path or --url, not both');
    });
  });
});
