import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, setupDatabaseResolution } from '../fixtures/notion-data';

describe('Template Command', () => {
  let program: Command;
  let mockClient: any;
  let mockFS: Map<string, string>;

  // Simulate a stable templates directory path
  const TEMPLATES_DIR = `${process.env.HOME}/.notion-cli/templates`;

  beforeEach(async () => {
    vi.resetModules();
    mockFS = new Map();

    // Create mock client
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    // Mock the client module
    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    // Mock fs module
    vi.doMock('fs', () => ({
      writeFileSync: vi.fn((path: string, data: string) => {
        mockFS.set(path, data);
      }),
      readFileSync: vi.fn((path: string) => {
        if (mockFS.has(path)) {
          return mockFS.get(path);
        }
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }),
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      mkdirSync: vi.fn((path: string) => {
        mockFS.set(path, '<directory>');
      }),
      readdirSync: vi.fn((path: string) => {
        const entries: string[] = [];
        const prefix = path.endsWith('/') ? path : `${path}/`;
        for (const filePath of mockFS.keys()) {
          if (filePath.startsWith(prefix)) {
            const relativePath = filePath.slice(prefix.length);
            const firstSegment = relativePath.split('/')[0];
            if (firstSegment && !entries.includes(firstSegment)) {
              entries.push(firstSegment);
            }
          }
        }
        return entries;
      }),
      unlinkSync: vi.fn((path: string) => {
        if (!mockFS.has(path)) {
          throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
        }
        mockFS.delete(path);
      }),
    }));

    // Import command and register it
    const { registerTemplateCommand } = await import('../../src/commands/template');
    program = new Command();
    registerTemplateCommand(program);
  });

  describe('template save', () => {
    const mockBlocks = {
      results: [
        {
          id: 'block-1',
          type: 'heading_1',
          heading_1: { rich_text: [{ id: 'rt-1', type: 'text', plain_text: 'Title' }] },
          has_children: false,
        },
        {
          id: 'block-2',
          type: 'paragraph',
          paragraph: { rich_text: [{ id: 'rt-2', type: 'text', plain_text: 'Content' }] },
          has_children: false,
        },
      ],
      has_more: false,
    };

    it('should save a page as a template', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage); // GET pages/{id}
      mockClient.get.mockResolvedValueOnce(mockBlocks); // GET blocks/{id}/children

      await program.parseAsync(['node', 'test', 'template', 'save', 'page-123', '--name', 'test-template']);

      // Should create templates directory
      expect(mockFS.has(TEMPLATES_DIR)).toBe(true);

      // Should save template file
      const templatePath = `${TEMPLATES_DIR}/test-template.json`;
      expect(mockFS.has(templatePath)).toBe(true);

      const saved = JSON.parse(mockFS.get(templatePath)!);
      expect(saved.name).toBe('test-template');
      expect(saved.sourcePageId).toBe('page-123');
      expect(saved.blocks).toHaveLength(2);
      expect(saved.propertyTypes).toHaveProperty('Name', 'title');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Template saved: test-template'));
    });

    it('should save template with description', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage);
      mockClient.get.mockResolvedValueOnce(mockBlocks);

      await program.parseAsync([
        'node', 'test', 'template', 'save', 'page-123',
        '--name', 'my-tmpl',
        '--description', 'A meeting notes template',
      ]);

      const templatePath = `${TEMPLATES_DIR}/my-tmpl.json`;
      const saved = JSON.parse(mockFS.get(templatePath)!);
      expect(saved.description).toBe('A meeting notes template');
    });

    it('should refuse to overwrite existing template without --overwrite', async () => {
      // Pre-create a template
      mockFS.set(`${TEMPLATES_DIR}/existing.json`, '{}');

      await expect(
        program.parseAsync(['node', 'test', 'template', 'save', 'page-123', '--name', 'existing'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('already exists')
      );
    });

    it('should overwrite existing template with --overwrite flag', async () => {
      mockFS.set(`${TEMPLATES_DIR}/existing.json`, '{"old": true}');
      mockClient.get.mockResolvedValueOnce(mockPage);
      mockClient.get.mockResolvedValueOnce(mockBlocks);

      await program.parseAsync([
        'node', 'test', 'template', 'save', 'page-123',
        '--name', 'existing',
        '--overwrite',
      ]);

      const saved = JSON.parse(mockFS.get(`${TEMPLATES_DIR}/existing.json`)!);
      expect(saved.name).toBe('existing');
      expect(saved).not.toHaveProperty('old');
    });

    it('should clean block IDs and timestamps from template data', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage);
      mockClient.get.mockResolvedValueOnce(mockBlocks);

      await program.parseAsync(['node', 'test', 'template', 'save', 'page-123', '--name', 'clean-test']);

      const saved = JSON.parse(mockFS.get(`${TEMPLATES_DIR}/clean-test.json`)!);
      for (const block of saved.blocks) {
        expect(block).not.toHaveProperty('id');
        expect(block).not.toHaveProperty('created_time');
        expect(block).not.toHaveProperty('last_edited_time');
      }
    });
  });

  describe('template list', () => {
    it('should list saved templates', async () => {
      const templateData = {
        name: 'meeting-notes',
        description: 'For meetings',
        blocks: [{ type: 'heading_1' }, { type: 'paragraph' }],
      };
      mockFS.set(`${TEMPLATES_DIR}/meeting-notes.json`, JSON.stringify(templateData));

      await program.parseAsync(['node', 'test', 'template', 'list']);

      expect(console.log).toHaveBeenCalledWith('Saved templates:\n');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('meeting-notes'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Blocks: 2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Description: For meetings'));
    });

    it('should show message when no templates exist', async () => {
      // Templates directory exists but is empty
      mockFS.set(TEMPLATES_DIR, '<directory>');

      await program.parseAsync(['node', 'test', 'template', 'list']);

      expect(console.log).toHaveBeenCalledWith('No templates saved yet.');
    });

    it('should list multiple templates', async () => {
      mockFS.set(`${TEMPLATES_DIR}/template-a.json`, JSON.stringify({
        name: 'template-a', description: '', blocks: [{ type: 'paragraph' }],
      }));
      mockFS.set(`${TEMPLATES_DIR}/template-b.json`, JSON.stringify({
        name: 'template-b', description: '', blocks: [],
      }));

      await program.parseAsync(['node', 'test', 'template', 'list']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('template-a'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('template-b'));
    });
  });

  describe('template use', () => {
    const templateData = {
      name: 'test-template',
      description: 'Test',
      sourcePageId: 'original-page',
      createdAt: '2024-01-01T00:00:00.000Z',
      blocks: [
        { object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: 'Title' } }] } },
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Content' } }] } },
      ],
      propertyTypes: { Name: 'title', Status: 'status' },
    };

    it('should create a page from template with title', async () => {
      mockFS.set(`${TEMPLATES_DIR}/test-template.json`, JSON.stringify(templateData));

      // setupDatabaseResolution for getDatabaseSchema call inside 'use'
      setupDatabaseResolution(mockClient);

      mockClient.post.mockResolvedValue({ id: 'new-page-id', url: 'https://notion.so/new-page' });

      await program.parseAsync([
        'node', 'test', 'template', 'use', 'test-template',
        '--parent', 'db-123',
        '--title', 'My New Page',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { database_id: 'db-123' },
        properties: expect.objectContaining({
          Name: { title: [{ text: { content: 'My New Page' } }] },
        }),
        children: expect.any(Array),
      }));

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Page created from template'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('new-page-id'));
    });

    it('should create page with page parent type', async () => {
      mockFS.set(`${TEMPLATES_DIR}/test-template.json`, JSON.stringify(templateData));

      mockClient.post.mockResolvedValue({ id: 'new-page-id', url: 'https://notion.so/new-page' });

      await program.parseAsync([
        'node', 'test', 'template', 'use', 'test-template',
        '--parent', 'parent-page-id',
        '--parent-type', 'page',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { page_id: 'parent-page-id' },
      }));
    });

    it('should fail when template is not found', async () => {
      mockFS.set(TEMPLATES_DIR, '<directory>');

      await expect(
        program.parseAsync([
          'node', 'test', 'template', 'use', 'nonexistent',
          '--parent', 'db-123',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('template show', () => {
    const templateData = {
      name: 'show-test',
      description: 'A nice template',
      sourcePageId: 'source-page-123',
      createdAt: '2024-06-15T10:00:00.000Z',
      blocks: [
        { type: 'heading_1', children: [{ type: 'paragraph' }] },
        { type: 'paragraph' },
      ],
      propertyTypes: { Name: 'title', Status: 'status' },
    };

    it('should show template details', async () => {
      mockFS.set(`${TEMPLATES_DIR}/show-test.json`, JSON.stringify(templateData));

      await program.parseAsync(['node', 'test', 'template', 'show', 'show-test']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Template: show-test'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('A nice template'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('source-page-123'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Blocks: 2'));
    });

    it('should output raw JSON with --json flag', async () => {
      mockFS.set(`${TEMPLATES_DIR}/show-test.json`, JSON.stringify(templateData));

      await program.parseAsync(['node', 'test', 'template', 'show', 'show-test', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"name": "show-test"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"sourcePageId"'));
    });

    it('should show property types', async () => {
      mockFS.set(`${TEMPLATES_DIR}/show-test.json`, JSON.stringify(templateData));

      await program.parseAsync(['node', 'test', 'template', 'show', 'show-test']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Property types:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Name: title'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status: status'));
    });

    it('should show block structure', async () => {
      mockFS.set(`${TEMPLATES_DIR}/show-test.json`, JSON.stringify(templateData));

      await program.parseAsync(['node', 'test', 'template', 'show', 'show-test']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Block structure:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('heading_1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('paragraph'));
    });

    it('should fail when template is not found', async () => {
      mockFS.set(TEMPLATES_DIR, '<directory>');

      await expect(
        program.parseAsync(['node', 'test', 'template', 'show', 'nonexistent'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('template delete', () => {
    it('should delete an existing template', async () => {
      mockFS.set(`${TEMPLATES_DIR}/to-delete.json`, '{}');

      await program.parseAsync(['node', 'test', 'template', 'delete', 'to-delete']);

      expect(mockFS.has(`${TEMPLATES_DIR}/to-delete.json`)).toBe(false);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Template "to-delete" deleted'));
    });

    it('should fail when template does not exist', async () => {
      mockFS.set(TEMPLATES_DIR, '<directory>');

      await expect(
        program.parseAsync(['node', 'test', 'template', 'delete', 'nonexistent'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('Error handling', () => {
    it('should handle API errors when saving template', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'template', 'save', 'invalid-page', '--name', 'fail'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle API errors when using template', async () => {
      const templateData = {
        name: 'test',
        blocks: [],
        propertyTypes: { Name: 'title' },
      };
      mockFS.set(`${TEMPLATES_DIR}/test.json`, JSON.stringify(templateData));
      // getDatabaseSchema will fail
      mockClient.get.mockRejectedValue(new Error('Database not found'));
      mockClient.post.mockRejectedValue(new Error('Create failed'));

      await expect(
        program.parseAsync([
          'node', 'test', 'template', 'use', 'test',
          '--parent', 'db-123',
          '--title', 'New Page',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', expect.any(String));
    });
  });
});
