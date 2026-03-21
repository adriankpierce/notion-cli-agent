import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mockDatabase,
  mockDataSource,
  mockPage,
  createPaginatedResult,
  createMockDataSource,
  createMockDatabase,
  MULTI_DS_ERROR_MESSAGE,
  mockMultiDsDatabase,
} from '../fixtures/notion-data';

describe('DatabaseResolver', () => {
  let mockClient: any;
  let resolver: typeof import('../../src/utils/database-resolver');

  beforeEach(async () => {
    vi.resetModules();
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    };
    resolver = await import('../../src/utils/database-resolver');
    resolver.clearResolverCache();
    resolver.setGlobalDataSourceId(undefined);
  });

  /**
   * Helper: set up mock chain for multi-DS discovery flow.
   * 1. Legacy GET → 400 multi-DS error
   * 2. Discovery request (with version) → data_sources array
   * 3. Data source schema request (with version) → schema
   *
   * Both steps 2 and 3 use client.request (version-aware), not client.get.
   */
  function setupMultiDsMocks(dataSourceId = 'ds-456') {
    // Step 1: legacy GET fails
    mockClient.get
      .mockRejectedValueOnce(new Error(`Notion API Error (400): ${MULTI_DS_ERROR_MESSAGE}`));
    // Steps 2+3: discovery + schema fetch via client.request
    mockClient.request = vi.fn()
      .mockResolvedValueOnce({
        data_sources: [{ id: dataSourceId, name: 'Test Data Source' }],
      })
      .mockResolvedValueOnce({ ...mockDataSource, id: dataSourceId });
  }

  /**
   * Helper: set up mock for explicit data-source-id path.
   * Only step 3 (schema fetch via client.request).
   */
  function setupExplicitDsMock(dataSourceId = 'ds-456') {
    mockClient.request = vi.fn()
      .mockResolvedValueOnce({ ...mockDataSource, id: dataSourceId });
  }

  // ─── resolveDatabase ──────────────────────────────────────────────────────

  describe('resolveDatabase()', () => {
    it('should resolve a classic database via /databases/ endpoint', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      const result = await resolver.resolveDatabase(mockClient, 'db-123');

      expect(result.type).toBe('classic');
      expect(result.schemaPath).toBe('databases/db-123');
      expect(result.queryPath).toBe('databases/db-123/query');
      expect(result.updatePath).toBe('databases/db-123');
      expect(result.schema).toEqual(mockDatabase);
      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
    });

    it('should detect multi-DS error, discover data_source_id, and resolve', async () => {
      setupMultiDsMocks();

      const result = await resolver.resolveDatabase(mockClient, 'multi-ds-db-123');

      expect(result.type).toBe('data_source');
      expect(result.schemaPath).toBe('data_sources/ds-456');
      expect(result.queryPath).toBe('data_sources/ds-456/query');
      expect(result.updatePath).toBe('data_sources/ds-456');
      expect(result.schema.properties).toBeDefined();
      // Discovery call uses version override
      expect(mockClient.request).toHaveBeenCalledWith(
        'databases/multi-ds-db-123',
        { version: '2025-09-03' },
      );
    });

    it('should error with helpful message when multiple data sources exist', async () => {
      mockClient.get
        .mockRejectedValueOnce(new Error(`Notion API Error (400): ${MULTI_DS_ERROR_MESSAGE}`));
      mockClient.request = vi.fn().mockResolvedValueOnce({
        ...mockMultiDsDatabase,
        data_sources: [
          { id: 'ds-1', name: 'Source A' },
          { id: 'ds-2', name: 'Source B' },
        ],
      });

      await expect(resolver.resolveDatabase(mockClient, 'multi-ds-db-123'))
        .rejects.toThrow('--data-source-id');
    });

    it('should use explicit dataSourceId without trying legacy endpoint', async () => {
      setupExplicitDsMock('ds-explicit');

      const result = await resolver.resolveDatabase(mockClient, 'any-db-id', 'ds-explicit');

      expect(result.type).toBe('data_source');
      expect(result.schemaPath).toBe('data_sources/ds-explicit');
      expect(result.queryPath).toBe('data_sources/ds-explicit/query');
      expect(result.updatePath).toBe('data_sources/ds-explicit');
      // Should NOT have tried the legacy databases/ endpoint
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-explicit', { version: '2025-09-03' });
      expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    it('should cache resolution results for same database ID', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      const result1 = await resolver.resolveDatabase(mockClient, 'db-123');
      const result2 = await resolver.resolveDatabase(mockClient, 'db-123');

      expect(result1).toBe(result2);
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });

    it('should cache resolution with explicit dataSourceId using composite key', async () => {
      setupExplicitDsMock('ds-1');

      const result1 = await resolver.resolveDatabase(mockClient, 'db-x', 'ds-1');
      const result2 = await resolver.resolveDatabase(mockClient, 'db-x', 'ds-1');

      expect(result1).toBe(result2);
      expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    it('should not share cache between different database IDs', async () => {
      const db1 = createMockDatabase('db-1', 'DB One');
      const db2 = createMockDatabase('db-2', 'DB Two');
      mockClient.get.mockResolvedValueOnce(db1).mockResolvedValueOnce(db2);

      const result1 = await resolver.resolveDatabase(mockClient, 'db-1');
      const result2 = await resolver.resolveDatabase(mockClient, 'db-2');

      expect(result1.schema).toEqual(db1);
      expect(result2.schema).toEqual(db2);
      expect(mockClient.get).toHaveBeenCalledTimes(2);
    });

    it('should propagate non-multi-DS errors without fallback', async () => {
      mockClient.get.mockRejectedValue(new Error('Notion API Error (404): Resource not found'));

      await expect(resolver.resolveDatabase(mockClient, 'bad-id'))
        .rejects.toThrow('Notion API Error (404)');
    });

    it('should propagate network errors without fallback', async () => {
      mockClient.get.mockRejectedValue(new Error('fetch failed'));

      await expect(resolver.resolveDatabase(mockClient, 'db-123'))
        .rejects.toThrow('fetch failed');
    });

    it('should handle discovery failing', async () => {
      mockClient.get
        .mockRejectedValueOnce(new Error(`Notion API Error (400): ${MULTI_DS_ERROR_MESSAGE}`));
      mockClient.request = vi.fn().mockRejectedValueOnce(
        new Error('Notion API Error (404): Resource not found'),
      );

      await expect(resolver.resolveDatabase(mockClient, 'multi-ds-db-123'))
        .rejects.toThrow('Notion API Error (404)');
    });

    it('should clear cache when clearResolverCache is called', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await resolver.resolveDatabase(mockClient, 'db-123');
      resolver.clearResolverCache();

      mockClient.get.mockResolvedValue(mockDatabase);
      await resolver.resolveDatabase(mockClient, 'db-123');

      expect(mockClient.get).toHaveBeenCalledTimes(2);
    });

    it('should normalize data_source response to Database shape', async () => {
      setupMultiDsMocks();

      const result = await resolver.resolveDatabase(mockClient, 'multi-ds-db-123');

      expect(result.schema.id).toBeDefined();
      expect(result.schema.properties).toBeDefined();
      expect(result.schema.title).toBeDefined();
    });
  });

  // ─── isMultiDataSourceError ────────────────────────────────────────────────

  describe('isMultiDataSourceError()', () => {
    it('should detect the multi-data-source error message', () => {
      const error = new Error(`Notion API Error (400): ${MULTI_DS_ERROR_MESSAGE}`);
      expect(resolver.isMultiDataSourceError(error)).toBe(true);
    });

    it('should not match other 400 errors', () => {
      const error = new Error('Notion API Error (400): Invalid property');
      expect(resolver.isMultiDataSourceError(error)).toBe(false);
    });

    it('should not match non-Error values', () => {
      expect(resolver.isMultiDataSourceError('string error')).toBe(false);
      expect(resolver.isMultiDataSourceError(null)).toBe(false);
      expect(resolver.isMultiDataSourceError(undefined)).toBe(false);
    });
  });

  // ─── getDatabaseSchema ─────────────────────────────────────────────────────

  describe('getDatabaseSchema()', () => {
    it('should return schema for classic database', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      const schema = await resolver.getDatabaseSchema(mockClient, 'db-123');

      expect(schema).toEqual(mockDatabase);
      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
    });

    it('should return schema for multi-DS database via auto-detection', async () => {
      setupMultiDsMocks();

      const schema = await resolver.getDatabaseSchema(mockClient, 'multi-ds-db-123');

      expect(schema.properties).toBeDefined();
    });

    it('should return schema for explicit data source ID', async () => {
      setupExplicitDsMock('ds-456');

      const schema = await resolver.getDatabaseSchema(mockClient, 'any-id', { dataSourceId: 'ds-456' });

      expect(schema.properties).toBeDefined();
      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456', { version: '2025-09-03' });
    });

    it('should use cached resolution on repeated calls', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await resolver.getDatabaseSchema(mockClient, 'db-123');
      await resolver.getDatabaseSchema(mockClient, 'db-123');

      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });
  });

  // ─── queryDatabase ─────────────────────────────────────────────────────────

  describe('queryDatabase()', () => {
    it('should query classic database with correct path', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      const result = await resolver.queryDatabase(mockClient, 'db-123', { page_size: 10 });

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', { page_size: 10 });
      expect(result).toEqual(queryResult);
    });

    it('should query multi-DS database via data_sources path', async () => {
      setupMultiDsMocks();
      const queryResult = createPaginatedResult([mockPage]);
      // Query also goes through client.request for data_source type
      mockClient.request.mockResolvedValueOnce(queryResult);

      const result = await resolver.queryDatabase(mockClient, 'multi-ds-db-123', { page_size: 5 });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456/query', {
        method: 'POST', body: { page_size: 5 }, version: '2025-09-03',
      });
      expect(result).toEqual(queryResult);
    });

    it('should query with explicit data source ID', async () => {
      setupExplicitDsMock('ds-456');
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.request.mockResolvedValueOnce(queryResult);

      const result = await resolver.queryDatabase(mockClient, 'any-id', { page_size: 20 }, { dataSourceId: 'ds-456' });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456/query', {
        method: 'POST', body: { page_size: 20 }, version: '2025-09-03',
      });
    });

    it('should pass empty body when none provided', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      await resolver.queryDatabase(mockClient, 'db-123');

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {});
    });

    it('should pass complex filter bodies through unchanged', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      const complexBody = {
        filter: { and: [{ property: 'Status', status: { equals: 'Done' } }] },
        sorts: [{ property: 'Name', direction: 'ascending' }],
        page_size: 50,
        start_cursor: 'cursor-abc',
      };

      await resolver.queryDatabase(mockClient, 'db-123', complexBody);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', complexBody);
    });

    it('should use cached resolution for subsequent queries', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      await resolver.queryDatabase(mockClient, 'db-123', {});
      await resolver.queryDatabase(mockClient, 'db-123', { page_size: 5 });

      // get called once for resolution, post called twice for queries
      expect(mockClient.get).toHaveBeenCalledTimes(1);
      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });
  });

  // ─── updateDatabase ────────────────────────────────────────────────────────

  describe('updateDatabase()', () => {
    it('should update classic database with correct path', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.patch.mockResolvedValue({ ...mockDatabase, title: 'Updated' });

      const body = { title: [{ type: 'text', text: { content: 'Updated' } }] };
      await resolver.updateDatabase(mockClient, 'db-123', body);

      expect(mockClient.patch).toHaveBeenCalledWith('databases/db-123', body);
    });

    it('should update multi-DS database via data_sources path', async () => {
      setupMultiDsMocks();
      // Update also goes through client.request for data_source type
      mockClient.request.mockResolvedValueOnce(mockDataSource);

      const body = { properties: { NewProp: { number: {} } } };
      await resolver.updateDatabase(mockClient, 'multi-ds-db-123', body);

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456', {
        method: 'PATCH', body, version: '2025-09-03',
      });
    });

    it('should update with explicit data source ID', async () => {
      setupExplicitDsMock('ds-456');
      // Update also goes through client.request for data_source type
      mockClient.request.mockResolvedValueOnce(mockDataSource);

      const body = { title: [{ type: 'text', text: { content: 'New Title' } }] };
      await resolver.updateDatabase(mockClient, 'any-id', body, { dataSourceId: 'ds-456' });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456', {
        method: 'PATCH', body, version: '2025-09-03',
      });
    });
  });

  // ─── queryDatabaseDirect (no schema resolution needed) ─────────────────────

  describe('queryDatabaseDirect()', () => {
    it('should query using pre-resolved path for classic DB', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      // First resolve, then use direct query
      const resolved = await resolver.resolveDatabase(mockClient, 'db-123');
      const result = await resolver.queryDatabaseDirect(mockClient, resolved, { page_size: 10 });

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', { page_size: 10 });
      expect(result).toEqual(queryResult);
    });

    it('should query using pre-resolved path for data_source', async () => {
      setupMultiDsMocks();
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.request.mockResolvedValueOnce(queryResult);

      const resolved = await resolver.resolveDatabase(mockClient, 'multi-ds-db-123');
      await resolver.queryDatabaseDirect(mockClient, resolved, { page_size: 10 });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456/query', {
        method: 'POST', body: { page_size: 10 }, version: '2025-09-03',
      });
    });
  });

  // ─── queryAllPages ──────────────────────────────────────────────────────────

  describe('queryAllPages()', () => {
    it('should fetch all pages with automatic pagination', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const page1 = { ...mockPage, id: 'page-1' };
      const page2 = { ...mockPage, id: 'page-2' };
      const page3 = { ...mockPage, id: 'page-3' };

      mockClient.post
        .mockResolvedValueOnce(createPaginatedResult([page1, page2], 'cursor-2', true))
        .mockResolvedValueOnce(createPaginatedResult([page3]));

      const pages = await resolver.queryAllPages(mockClient, 'db-123');

      expect(pages).toHaveLength(3);
      expect(pages.map(p => p.id)).toEqual(['page-1', 'page-2', 'page-3']);
      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });

    it('should pass filter and sorts to every query call', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      const filter = { property: 'Status', status: { equals: 'Done' } };
      const sorts = [{ property: 'Name', direction: 'ascending' }];

      await resolver.queryAllPages(mockClient, 'db-123', { filter, sorts: sorts as any });

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        page_size: 100,
        filter,
        sorts,
      });
    });

    it('should respect limit and truncate results', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const pages = Array.from({ length: 5 }, (_, i) => ({ ...mockPage, id: `page-${i}` }));
      mockClient.post.mockResolvedValue(createPaginatedResult(pages, 'cursor-next', true));

      const result = await resolver.queryAllPages(mockClient, 'db-123', { limit: 3 });

      expect(result).toHaveLength(3);
      // Should not continue paginating after limit reached
      expect(mockClient.post).toHaveBeenCalledTimes(1);
    });

    it('should use custom pageSize', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await resolver.queryAllPages(mockClient, 'db-123', { pageSize: 50 });

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        page_size: 50,
      });
    });

    it('should call onProgress callback with running count', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      const page1 = { ...mockPage, id: 'page-1' };
      const page2 = { ...mockPage, id: 'page-2' };

      mockClient.post
        .mockResolvedValueOnce(createPaginatedResult([page1], 'cursor-2', true))
        .mockResolvedValueOnce(createPaginatedResult([page2]));

      const progressCalls: number[] = [];
      await resolver.queryAllPages(mockClient, 'db-123', {
        onProgress: (n) => progressCalls.push(n),
      });

      expect(progressCalls).toEqual([1, 2]);
    });

    it('should handle empty results', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      const pages = await resolver.queryAllPages(mockClient, 'db-123');

      expect(pages).toHaveLength(0);
    });

    it('should work with multi-DS databases', async () => {
      setupMultiDsMocks();
      mockClient.request.mockResolvedValueOnce(createPaginatedResult([mockPage]));

      const pages = await resolver.queryAllPages(mockClient, 'multi-ds-db-123');

      expect(pages).toHaveLength(1);
      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-456/query', {
        method: 'POST', body: { page_size: 100 }, version: '2025-09-03',
      });
    });

    it('should pass start_cursor on subsequent pages', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post
        .mockResolvedValueOnce(createPaginatedResult([mockPage], 'cursor-xyz', true))
        .mockResolvedValueOnce(createPaginatedResult([mockPage]));

      await resolver.queryAllPages(mockClient, 'db-123');

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        page_size: 100,
        start_cursor: 'cursor-xyz',
      });
    });
  });

  // ─── Global data-source-id fallback ─────────────────────────────────────────

  describe('setGlobalDataSourceId()', () => {
    it('should use global data-source-id when no explicit option is provided', async () => {
      setupExplicitDsMock('ds-global');

      resolver.setGlobalDataSourceId('ds-global');
      const schema = await resolver.getDatabaseSchema(mockClient, 'any-db');

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-global', { version: '2025-09-03' });
    });

    it('should prefer explicit dataSourceId over global', async () => {
      setupExplicitDsMock('ds-explicit');

      resolver.setGlobalDataSourceId('ds-global');
      const schema = await resolver.getDatabaseSchema(mockClient, 'any-db', { dataSourceId: 'ds-explicit' });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-explicit', { version: '2025-09-03' });
    });

    it('should not use global when cleared', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      resolver.setGlobalDataSourceId('ds-global');
      resolver.setGlobalDataSourceId(undefined);
      await resolver.getDatabaseSchema(mockClient, 'db-123');

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
    });

    it('should flow through to queryDatabase', async () => {
      setupExplicitDsMock('ds-global');
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.request.mockResolvedValueOnce(queryResult);

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.queryDatabase(mockClient, 'any-db', { page_size: 10 });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-global/query', {
        method: 'POST', body: { page_size: 10 }, version: '2025-09-03',
      });
    });

    it('should flow through to queryAllPages', async () => {
      setupExplicitDsMock('ds-global');
      mockClient.request.mockResolvedValueOnce(createPaginatedResult([mockPage]));

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.queryAllPages(mockClient, 'any-db');

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-global/query', {
        method: 'POST', body: { page_size: 100 }, version: '2025-09-03',
      });
    });

    it('should flow through to updateDatabase', async () => {
      setupExplicitDsMock('ds-global');
      mockClient.request.mockResolvedValueOnce(mockDataSource);

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.updateDatabase(mockClient, 'any-db', { title: 'test' });

      expect(mockClient.request).toHaveBeenCalledWith('data_sources/ds-global', {
        method: 'PATCH', body: { title: 'test' }, version: '2025-09-03',
      });
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle database ID with dashes (UUID format)', async () => {
      const uuidId = '2c98284a-8643-8140-9380-deaf158a1077';
      mockClient.get.mockResolvedValue(createMockDatabase(uuidId, 'UUID DB'));

      const result = await resolver.resolveDatabase(mockClient, uuidId);

      expect(result.schemaPath).toBe(`databases/${uuidId}`);
    });

    it('should handle database ID without dashes', async () => {
      const noDashId = '2c98284a864381409380deaf158a1077';
      mockClient.get.mockResolvedValue(createMockDatabase(noDashId, 'No Dash DB'));

      const result = await resolver.resolveDatabase(mockClient, noDashId);

      expect(result.schemaPath).toBe(`databases/${noDashId}`);
    });

    it('should handle data_source with minimal properties', async () => {
      const minimalDs = {
        object: 'data_source',
        id: 'ds-minimal',
        properties: {},
      };

      // Step 1: legacy GET fails with multi-DS error
      mockClient.get
        .mockRejectedValueOnce(new Error(`Notion API Error (400): ${MULTI_DS_ERROR_MESSAGE}`));
      // Steps 2+3: discovery + schema fetch both via client.request
      mockClient.request = vi.fn()
        .mockResolvedValueOnce({
          data_sources: [{ id: 'ds-minimal', name: 'Minimal' }],
        })
        .mockResolvedValueOnce(minimalDs);

      const result = await resolver.resolveDatabase(mockClient, 'db-minimal');

      expect(result.schema.properties).toEqual({});
      expect(result.type).toBe('data_source');
    });

    it('should handle concurrent resolutions for same ID without duplicate calls', async () => {
      let resolveGet: (value: any) => void;
      const pendingGet = new Promise((resolve) => { resolveGet = resolve; });
      mockClient.get.mockReturnValue(pendingGet);

      const promise1 = resolver.resolveDatabase(mockClient, 'db-concurrent');
      const promise2 = resolver.resolveDatabase(mockClient, 'db-concurrent');

      resolveGet!(mockDatabase);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe(result2);
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });
  });
});
