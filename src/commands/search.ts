/**
 * Search command - search pages and databases
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, formatDatabaseTitle } from '../utils/format.js';
import { withErrorHandler } from '../utils/command-handler.js';
import { getParentDatabaseId } from '../utils/notion-helpers.js';

interface SearchItem {
  object: 'page' | 'database' | 'data_source';
  id: string;
  title?: Array<{ plain_text: string }>;
  properties?: Record<string, unknown>;
  parent?: { type: string; database_id?: string; data_source_id?: string; page_id?: string };
  url?: string;
}

interface SearchResult {
  object: string;
  results: SearchItem[];
  has_more: boolean;
  next_cursor: string | null;
}

function getItemTitle(item: SearchItem): string {
  if (item.object === 'page') return formatPageTitle(item);
  return formatDatabaseTitle(item);
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search [query]')
    .description('Search pages and databases')
    .option('-t, --type <type>', 'Filter by type: page, database', '')
    .option('-s, --sort <direction>', 'Sort by last_edited_time: asc, desc', '')
    .option('-l, --limit <number>', 'Max results to return', '10')
    .option('--cursor <cursor>', 'Pagination cursor for next page')
    .option('--db <database_id>', 'Filter results to pages in this database')
    .option('--exact', 'Only show exact title matches')
    .option('--first', 'Return only the first result (exit 1 if none)')
    .option('--llm', 'Compact LLM-friendly output')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (query: string | undefined, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};
      if (query) body.query = query;
      if (options.type) {
        const apiType = options.type === 'database' ? 'data_source' : options.type;
        body.filter = { property: 'object', value: apiType };
      }
      if (options.sort) {
        body.sort = {
          direction: options.sort,
          timestamp: 'last_edited_time',
        };
      }
      if (options.limit) body.page_size = parseInt(options.limit, 10);
      if (options.cursor) body.start_cursor = options.cursor;

      const result = await client.post<SearchResult>('search', body);

      let items = result.results;

      // --db: filter to pages whose parent matches
      if (options.db) {
        items = items.filter(item => {
          if (!item.parent) return false;
          const parentId = getParentDatabaseId(item.parent as any);
          return parentId === options.db;
        });
      }

      // --exact: filter to exact title matches
      if (options.exact && query) {
        const lowerQuery = query.toLowerCase();
        items = items.filter(item => {
          const title = getItemTitle(item);
          return title.toLowerCase() === lowerQuery;
        });
      }

      // --first: return one result or exit 1
      if (options.first) {
        if (items.length === 0) {
          if (!options.json && !options.llm) console.error('No matching result found.');
          process.exit(1);
        }
        items = [items[0]];
      }

      if (options.json) {
        console.log(formatOutput(options.first ? items[0] : { ...result, results: items }));
        return;
      }

      if (items.length === 0) {
        console.log('No results found.');
        return;
      }

      // --llm: compact output
      if (options.llm) {
        for (const item of items) {
          const title = getItemTitle(item);
          const type = item.object === 'page' ? 'page' : 'db';
          console.log(`[${type}] ${item.id} ${title}`);
        }
        if (result.has_more && !options.first) {
          console.log(`(more results available)`);
        }
        return;
      }

      for (const item of items) {
        const isPage = item.object === 'page';
        const icon = isPage ? '📄' : '🗄️';
        const title = getItemTitle(item);
        console.log(`${icon} ${title}`);
        console.log(`   ID: ${item.id}`);
        if (item.url) console.log(`   URL: ${item.url}`);
        console.log('');
      }

      if (result.has_more && !options.first) {
        console.log(`More results available. Use --cursor ${result.next_cursor}`);
      }
    }));
}
