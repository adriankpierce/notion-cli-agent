import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase, mockBlockChildren, mockBlock, mockHeadingBlock, mockCodeBlock, setupDatabaseResolution, mockMultiDsDatabase, mockDataSource } from '../fixtures/notion-data';

describe('Pages Command', () => {
  let program: Command;
  let mockClient: any;
  let mockFS: Map<string, string>;

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

    // Mock fs module (needed for page write/edit commands)
    vi.doMock('fs', () => ({
      readFileSync: vi.fn((path: string) => {
        if (mockFS.has(path)) {
          return mockFS.get(path);
        }
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }),
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      writeFileSync: vi.fn(),
    }));

    // Import command and register it
    const { registerPagesCommand } = await import('../../src/commands/pages');
    program = new Command();
    registerPagesCommand(program);
  });

  describe('page get', () => {
    it('should get page by ID', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(console.log).toHaveBeenCalledWith('Test Page');
      expect(console.log).toHaveBeenCalledWith('ID:', 'page-123');
    });

    it('should get page with content', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage).mockResolvedValueOnce(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123', '--content']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(console.log).toHaveBeenCalledWith('Page:', 'Test Page');
      expect(console.log).toHaveBeenCalledWith('ID:', 'page-123');
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "page"'));
    });

    it('should output JSON with content when both --json and --content are used', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage).mockResolvedValueOnce(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123', '--content', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"page"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"blocks"'));
    });
  });

  describe('page create', () => {
    it('should create page in database with title', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { data_source_id: 'db-123' },
        properties: {
          Name: {
            title: [{ text: { content: 'New Page' } }],
          },
        },
      });

      expect(console.log).toHaveBeenCalledWith('Page created');
      expect(console.log).toHaveBeenCalledWith('ID:', 'new-page-123');
      expect(console.log).toHaveBeenCalledWith('URL:', 'https://notion.so/new-page-123');
    });

    it('should create page under parent page using "title" property key', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'page-456',
        '--parent-type', 'page',
        '--title', 'Subpage',
      ]);

      // Non-DB pages use 'title' as property key, not 'Name'
      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { page_id: 'page-456' },
        properties: {
          title: {
            title: [{ text: { content: 'Subpage' } }],
          },
        },
      });
    });

    it('should auto-detect title property from database schema', async () => {
      const customDb = {
        ...mockDatabase,
        properties: {
          'Task Name': { id: 'task-name', type: 'title', title: {} },
          Status: { id: 'status', type: 'status', status: {} },
        },
      };
      setupDatabaseResolution(mockClient, customDb);

      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Task',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('data_sources/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { data_source_id: 'db-123' },
        properties: {
          'Task Name': {
            title: [{ text: { content: 'New Task' } }],
          },
        },
      });
    });

    it('should use custom title property name', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--title-prop', 'Title',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { data_source_id: 'db-123' },
        properties: {
          Title: {
            title: [{ text: { content: 'New Page' } }],
          },
        },
      });
    });

    it('should create page with additional properties', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--prop', 'Status=Done',
        '--prop', 'Priority=High',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { data_source_id: 'db-123' },
        properties: {
          Name: {
            title: [{ text: { content: 'New Page' } }],
          },
          Status: {
            select: { name: 'Done' },
          },
          Priority: {
            select: { name: 'High' },
          },
        },
      });
    });

    it('should create page with markdown content from file', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);
      mockFS.set('content.md', '# Hello\n\nThis is content.');

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--file', 'content.md',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { data_source_id: 'db-123' },
        properties: {
          Name: {
            title: [{ text: { content: 'New Page' } }],
          },
        },
        markdown: '# Hello\n\nThis is content.',
      });
    });

    it('should output JSON when --json flag is used', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "page"'));
    });

    it('should create page with emoji icon', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--icon', '📝',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        icon: { type: 'emoji', emoji: '📝' },
      }));
    });
  });

  describe('page update', () => {
    it('should update page properties', async () => {
      const updatedPage = { ...mockPage, id: 'page-123' };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--prop', 'Priority=High',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          Status: {
            select: { name: 'Done' },
          },
          Priority: {
            select: { name: 'High' },
          },
        },
      });

      expect(console.log).toHaveBeenCalledWith('Page updated');
      expect(console.log).toHaveBeenCalledWith('ID:', 'page-123');
    });

    it('should archive page with --archive flag', async () => {
      const updatedPage = { ...mockPage, id: 'page-123', archived: true };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--archive',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        in_trash: true,
      });
    });

    it('should unarchive page with --unarchive flag', async () => {
      const updatedPage = { ...mockPage, id: 'page-123', in_trash: false };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--unarchive',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        in_trash: false,
      });
    });

    it('should update properties and archive together', async () => {
      const updatedPage = { ...mockPage, id: 'page-123', in_trash: true };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--archive',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          Status: {
            select: { name: 'Done' },
          },
        },
        in_trash: true,
      });
    });

    it('should output JSON when --json flag is used', async () => {
      const updatedPage = { ...mockPage, id: 'page-123' };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "page"'));
    });

    it('should update page icon', async () => {
      mockClient.patch.mockResolvedValue({ ...mockPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--icon', '🚀',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        icon: { type: 'emoji', emoji: '🚀' },
      });
    });

    it('should update icon together with properties', async () => {
      mockClient.patch.mockResolvedValue({ ...mockPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--icon', '✅',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: { Status: { select: { name: 'Done' } } },
        icon: { type: 'emoji', emoji: '✅' },
      });
    });

    it('should rename title by auto-detecting title property from parent database', async () => {
      // First call: get page (to find parent DB), then resolver: discovery + schema
      mockClient.get.mockResolvedValueOnce(mockPage);
      setupDatabaseResolution(mockClient);
      mockClient.patch.mockResolvedValue({ ...mockPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--title', 'Renamed Page',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/db-123');
      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          Name: { title: [{ text: { content: 'Renamed Page' } }] },
        },
      });
    });

    it('should rename title using "title" property key when page has non-DB parent', async () => {
      // Page whose parent is another page, not a database
      const nonDbPage = { ...mockPage, parent: { type: 'page_id', page_id: 'parent-page-456' } };
      mockClient.get.mockResolvedValueOnce(nonDbPage);
      mockClient.patch.mockResolvedValue({ ...nonDbPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--title', 'Renamed Subpage',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      // Should NOT fetch DB schema (no database_id to resolve)
      expect(mockClient.get).toHaveBeenCalledTimes(1);
      // Non-DB pages use 'title' as property key, not 'Name'
      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          title: { title: [{ text: { content: 'Renamed Subpage' } }] },
        },
      });
    });

    it('should fall back to "title" prop key when page fetch fails', async () => {
      // If get pages/{id} throws (network error, bad ID), we cannot detect parent type.
      // 'title' is Notion's universal built-in key — safer fallback than 'Name'.
      mockClient.get.mockRejectedValueOnce(new Error('Network error'));
      mockClient.patch.mockResolvedValue({ ...mockPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--title', 'Renamed Page',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          title: { title: [{ text: { content: 'Renamed Page' } }] },
        },
      });
    });

    it('should rename title using explicit --title-prop without fetching schema', async () => {
      mockClient.patch.mockResolvedValue({ ...mockPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--title', 'Renamed Page',
        '--title-prop', 'Task Name',
      ]);

      // Should NOT fetch page or DB when --title-prop is provided
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          'Task Name': { title: [{ text: { content: 'Renamed Page' } }] },
        },
      });
    });

    it('should rename title together with other properties', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage);
      setupDatabaseResolution(mockClient);
      mockClient.patch.mockResolvedValue({ ...mockPage, id: 'page-123' });

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--title', 'Renamed Page',
        '--prop', 'Status=Done',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          Name: { title: [{ text: { content: 'Renamed Page' } }] },
          Status: { select: { name: 'Done' } },
        },
      });
    });
  });

  describe('page archive', () => {
    it('should archive page', async () => {
      mockClient.patch.mockResolvedValue({ ...mockPage, in_trash: true });

      await program.parseAsync(['node', 'test', 'page', 'archive', 'page-123']);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        in_trash: true,
      });

      expect(console.log).toHaveBeenCalledWith('Page archived');
    });
  });

  describe('page property', () => {
    it('should get specific page property', async () => {
      const property = {
        object: 'property_item',
        id: 'prop-123',
        type: 'rollup',
        rollup: { type: 'array', array: [{ type: 'number', number: 42 }] },
      };

      mockClient.get.mockResolvedValue(property);

      await program.parseAsync(['node', 'test', 'page', 'property', 'page-123', 'prop-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123/properties/prop-123');
      expect(console.log).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const property = { object: 'property_item', id: 'prop-123', type: 'title' };

      mockClient.get.mockResolvedValue(property);

      await program.parseAsync(['node', 'test', 'page', 'property', 'page-123', 'prop-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "property_item"'));
    });
  });

  describe('Error handling', () => {
    it('should handle get errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'get', 'invalid-id'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle create errors', async () => {
      mockClient.post.mockRejectedValue(new Error('Invalid parent'));

      await expect(
        program.parseAsync([
          'node', 'test', 'page', 'create',
          '--parent', 'invalid-id',
          '--title', 'New Page',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Invalid parent');
    });

    it('should handle update errors', async () => {
      mockClient.patch.mockRejectedValue(new Error('Permission denied'));

      await expect(
        program.parseAsync([
          'node', 'test', 'page', 'update', 'page-123',
          '--prop', 'Status=Done',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Permission denied');
    });

    it('should handle archive errors', async () => {
      mockClient.patch.mockRejectedValue(new Error('Already archived'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'archive', 'page-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Already archived');
    });

    it('should handle property errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Property not found'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'property', 'page-123', 'invalid-prop'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Property not found');
    });
  });

  describe('page read', () => {
    const mockMarkdownResponse = {
      object: 'page_markdown',
      id: 'page-123',
      markdown: 'This is a test paragraph.\n\n# Test Heading\n',
      truncated: false,
      unknown_block_ids: [],
    };

    it('should read page content as markdown to stdout', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // First call: get page for title, second call: get markdown
      mockClient.get
        .mockResolvedValueOnce(mockPage) // pages/{id}
        .mockResolvedValueOnce(mockMarkdownResponse); // pages/{id}/markdown

      await program.parseAsync(['node', 'test', 'page', 'read', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123/markdown', {});

      // Should output markdown via stdout.write
      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('# Test Page');
      expect(output).toContain('This is a test paragraph.');

      stdoutSpy.mockRestore();
    });

    it('should omit title with --no-title', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      mockClient.get.mockResolvedValueOnce(mockMarkdownResponse); // pages/{id}/markdown

      await program.parseAsync(['node', 'test', 'page', 'read', 'page-123', '--no-title']);

      // Should NOT have fetched the page (no title needed)
      expect(mockClient.get).not.toHaveBeenCalledWith('pages/page-123');

      const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
      expect(output).not.toContain('# Test Page');
      expect(output).toContain('This is a test paragraph.');

      stdoutSpy.mockRestore();
    });

    it('should output raw JSON with --json', async () => {
      mockClient.get.mockResolvedValueOnce(mockBlockChildren); // blocks/{id}/children

      await program.parseAsync(['node', 'test', 'page', 'read', 'page-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('"id": "block-123"')
      );
    });

    it('should handle read errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'read', 'page-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });
  });


  describe('page edit', () => {
    const existingMarkdown = {
      object: 'page_markdown',
      id: 'page-123',
      markdown: '# Title\nPara 1\nPara 2\nPara 3',
      truncated: false,
      unknown_block_ids: [],
    };

    const mockUpdateResponse = {
      object: 'page_markdown',
      id: 'page-123',
      markdown: '# Title\nReplaced\nPara 2\nPara 3',
      truncated: false,
      unknown_block_ids: [],
    };

    it('should search and replace text via update_content', async () => {
      mockClient.patch.mockResolvedValue(mockUpdateResponse);

      await program.parseAsync([
        'node', 'test', 'page', 'edit', 'page-123',
        '--search', 'Para 1',
        '--replace', 'Replaced',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123/markdown', {
        type: 'update_content',
        update_content: {
          content_updates: [{
            old_str: 'Para 1',
            new_str: 'Replaced',
            replace_all_matches: false,
          }],
          allow_deleting_content: false,
        },
      });
      expect(console.log).toHaveBeenCalledWith('Page updated');
    });

    it('should replace all matches with --all', async () => {
      mockClient.patch.mockResolvedValue(mockUpdateResponse);

      await program.parseAsync([
        'node', 'test', 'page', 'edit', 'page-123',
        '--search', 'Para',
        '--replace', 'Line',
        '--all',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123/markdown', {
        type: 'update_content',
        update_content: {
          content_updates: [{
            old_str: 'Para',
            new_str: 'Line',
            replace_all_matches: true,
          }],
          allow_deleting_content: false,
        },
      });
    });

    it('should show dry run for edit', async () => {
      mockClient.get.mockResolvedValueOnce(existingMarkdown);

      await program.parseAsync([
        'node', 'test', 'page', 'edit', 'page-123',
        '--search', 'Para 1',
        '--replace', 'New content',
        '--dry-run',
      ]);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 match'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });

    it('should output JSON with --json', async () => {
      mockClient.patch.mockResolvedValue(mockUpdateResponse);

      await program.parseAsync([
        'node', 'test', 'page', 'edit', 'page-123',
        '--search', 'Para 1',
        '--replace', 'Replaced',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('"page_markdown"')
      );
    });
  });
});
