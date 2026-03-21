/**
 * Database Resolver — detect-and-redirect for multi-data-source databases
 *
 * Abstracts the difference between classic databases (/v1/databases/{id})
 * and multi-data-source databases (/v1/data_sources/{id}).
 *
 * Design: This module is the ONLY place that knows about endpoint routing.
 * When Notion API version is upgraded, only this file needs to change.
 */

import type { NotionClient } from '../client.js';
import type { Database, PaginatedResponse, Page } from '../types/notion.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolvedDatabase {
  type: 'classic' | 'data_source';
  schemaPath: string;
  queryPath: string;
  updatePath: string;
  schema: Database;
}

export interface ResolverOptions {
  dataSourceId?: string;
}

export interface QueryAllOptions extends ResolverOptions {
  filter?: Record<string, unknown>;
  sorts?: Record<string, unknown>[];
  pageSize?: number;
  limit?: number;
  onProgress?: (fetched: number) => void;
}

// ─── Global data-source-id fallback ─────────────────────────────────────────

let globalDataSourceId: string | undefined;

/**
 * Set the global data-source-id fallback from CLI's --data-source-id option.
 * Called once from cli.ts preAction hook. Commands don't need to thread
 * this option — the resolver picks it up automatically.
 */
export function setGlobalDataSourceId(id?: string): void {
  globalDataSourceId = id;
}

function effectiveDataSourceId(explicit?: string): string | undefined {
  return explicit ?? globalDataSourceId;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MULTI_DS_ERROR_PATTERN = /multiple data sources/i;
const DISCOVERY_VERSION = '2025-09-03';

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache = new Map<string, Promise<ResolvedDatabase>>();

function cacheKey(databaseId: string, dataSourceId?: string): string {
  return dataSourceId ? `${databaseId}::${dataSourceId}` : databaseId;
}

export function clearResolverCache(): void {
  cache.clear();
}

// ─── Error detection ────────────────────────────────────────────────────────

export function isMultiDataSourceError(error: unknown): boolean {
  return error instanceof Error && MULTI_DS_ERROR_PATTERN.test(error.message);
}

// ─── Core resolution ────────────────────────────────────────────────────────

function buildPaths(prefix: string, id: string) {
  return {
    schemaPath: `${prefix}/${id}`,
    queryPath: `${prefix}/${id}/query`,
    updatePath: `${prefix}/${id}`,
  };
}

async function resolveViaDataSource(
  client: NotionClient,
  dataSourceId: string,
): Promise<ResolvedDatabase> {
  // data_sources endpoints require Notion-Version >= 2025-09-03
  const ds = await client.request<Record<string, unknown>>(
    `data_sources/${dataSourceId}`,
    { version: DISCOVERY_VERSION },
  );
  return {
    type: 'data_source',
    ...buildPaths('data_sources', dataSourceId),
    schema: normalizeToDatabase(ds, dataSourceId),
  };
}

/**
 * Discover the primary data_source_id for a multi-DS database.
 * Uses Notion-Version: 2025-09-03 to get the data_sources array,
 * then picks the first data source. If there are multiple, the user
 * must specify --data-source-id explicitly.
 */
async function discoverDataSourceId(
  client: NotionClient,
  databaseId: string,
): Promise<string> {
  const db = await client.request<{ data_sources?: { id: string; name: string }[] }>(
    `databases/${databaseId}`,
    { version: DISCOVERY_VERSION },
  );

  const sources = db.data_sources;
  if (!sources || sources.length === 0) {
    throw new Error(
      `Database ${databaseId} has no data sources. Use --data-source-id to specify one.`,
    );
  }

  if (sources.length > 1) {
    const list = sources.map(s => `  - ${s.id} (${s.name})`).join('\n');
    throw new Error(
      `Database ${databaseId} has ${sources.length} data sources:\n${list}\n` +
      `Use --data-source-id <id> to specify which one.`,
    );
  }

  return sources[0].id;
}

async function resolveViaLegacy(
  client: NotionClient,
  databaseId: string,
): Promise<ResolvedDatabase> {
  try {
    const db = await client.get<Database>(`databases/${databaseId}`);
    return {
      type: 'classic',
      ...buildPaths('databases', databaseId),
      schema: db,
    };
  } catch (error) {
    if (!isMultiDataSourceError(error)) throw error;
    // Discover the real data_source_id via version-upgraded GET
    const dataSourceId = await discoverDataSourceId(client, databaseId);
    return resolveViaDataSource(client, dataSourceId);
  }
}

/**
 * Resolve a database ID to the correct API endpoints.
 *
 * Resolution strategy:
 * 1. If explicit dataSourceId is provided, use /data_sources/ directly
 * 2. Try /databases/ (legacy); on multi-DS error, fallback to /data_sources/
 * 3. Cache the result for the lifetime of the process
 */
export function resolveDatabase(
  client: NotionClient,
  databaseId: string,
  dataSourceId?: string,
): Promise<ResolvedDatabase> {
  const key = cacheKey(databaseId, dataSourceId);

  if (!cache.has(key)) {
    const promise = dataSourceId
      ? resolveViaDataSource(client, dataSourceId)
      : resolveViaLegacy(client, databaseId);

    cache.set(key, promise);

    // Remove from cache on failure so retries work
    promise.catch(() => cache.delete(key));
  }

  return cache.get(key)!;
}

// ─── High-level helpers ─────────────────────────────────────────────────────

/**
 * Get the schema (properties, title, etc.) for a database.
 * Handles classic and multi-data-source databases transparently.
 */
export async function getDatabaseSchema(
  client: NotionClient,
  databaseId: string,
  opts?: ResolverOptions,
): Promise<Database> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts?.dataSourceId));
  return resolved.schema;
}

/**
 * Post to a resolved path, using the right API version for data_sources.
 */
function postResolved<T>(client: NotionClient, resolved: ResolvedDatabase, path: string, body: Record<string, unknown>): Promise<T> {
  if (resolved.type === 'data_source') {
    return client.request<T>(path, { method: 'POST', body, version: DISCOVERY_VERSION });
  }
  return client.post<T>(path, body);
}

function patchResolved<T>(client: NotionClient, resolved: ResolvedDatabase, path: string, body: Record<string, unknown>): Promise<T> {
  if (resolved.type === 'data_source') {
    return client.request<T>(path, { method: 'PATCH', body, version: DISCOVERY_VERSION });
  }
  return client.patch<T>(path, body);
}

/**
 * Query a database. Resolves endpoint automatically.
 */
export async function queryDatabase<T = unknown>(
  client: NotionClient,
  databaseId: string,
  body: Record<string, unknown> = {},
  opts?: ResolverOptions,
): Promise<T> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts?.dataSourceId));
  return postResolved<T>(client, resolved, resolved.queryPath, body);
}

/**
 * Query using an already-resolved database (avoids re-resolution).
 * Useful in loops/pagination where resolution already happened.
 */
export async function queryDatabaseDirect<T = unknown>(
  client: NotionClient,
  resolved: ResolvedDatabase,
  body: Record<string, unknown> = {},
): Promise<T> {
  return postResolved<T>(client, resolved, resolved.queryPath, body);
}

/**
 * Update a database schema. Resolves endpoint automatically.
 */
export async function updateDatabase<T = unknown>(
  client: NotionClient,
  databaseId: string,
  body: Record<string, unknown>,
  opts?: ResolverOptions,
): Promise<T> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts?.dataSourceId));
  return patchResolved<T>(client, resolved, resolved.updatePath, body);
}

// ─── Pagination helper ──────────────────────────────────────────────────────

/**
 * Fetch all pages from a database, handling pagination automatically.
 * Replaces the 7+ duplicated do/while pagination loops across commands.
 */
export async function queryAllPages(
  client: NotionClient,
  databaseId: string,
  opts: QueryAllOptions = {},
): Promise<Page[]> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts.dataSourceId));
  const pages: Page[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: opts.pageSize ?? 100,
    };
    if (opts.filter) body.filter = opts.filter;
    if (opts.sorts) body.sorts = opts.sorts;
    if (cursor) body.start_cursor = cursor;

    const result = await queryDatabaseDirect<PaginatedResponse<Page>>(
      client, resolved, body,
    );

    pages.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;

    opts.onProgress?.(pages.length);

    if (opts.limit && pages.length >= opts.limit) {
      pages.splice(opts.limit);
      break;
    }
  } while (cursor);

  return pages;
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize a data_source API response to the Database shape
 * that all command files expect. This is the seam for future migration:
 * when we upgrade to 2025-09-03+, this function adapts the new response
 * format to the existing internal model.
 */
function normalizeToDatabase(
  ds: Record<string, unknown>,
  id: string,
): Database {
  return {
    object: 'database' as const,
    id: (ds.id as string) || id,
    title: ds.title as Database['title'],
    description: ds.description as Database['description'],
    url: ds.url as string | undefined,
    properties: (ds.properties as Database['properties']) || {},
  };
}
