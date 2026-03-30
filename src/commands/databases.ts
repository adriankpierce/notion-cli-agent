/**
 * Databases commands - list, schema, get, create, update, query databases
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput, formatDatabaseTitle, parseFilter } from '../utils/format.js';
import { getDatabaseSchema, queryDatabase, updateDatabase } from '../utils/database-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
import { getPageTitle, getDbTitle, getDbDescription } from '../utils/notion-helpers.js';
import type { Database, PaginatedResponse, Page, PropertySchema } from '../types/notion.js';

interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

interface StatusGroup {
  id: string;
  name: string;
  option_ids: string[];
}

interface DatabaseWithDataSources extends Database {
  data_sources?: { id: string; name: string }[];
}

function isMultiDataSource(db: DatabaseWithDataSources): boolean {
  return Array.isArray(db.data_sources) && db.data_sources.length > 1;
}

function formatPropertyType(prop: PropertySchema): string {
  const type = prop.type;
  const data = prop[type] as Record<string, unknown> | undefined;

  switch (type) {
    case 'select':
    case 'multi_select': {
      const options = (data?.options as SelectOption[]) || [];
      if (options.length === 0) return type;
      const optionNames = options.map(o => o.name).slice(0, 5);
      const more = options.length > 5 ? ` +${options.length - 5} more` : '';
      return `${type} [${optionNames.join(', ')}${more}]`;
    }

    case 'status': {
      const options = (data?.options as SelectOption[]) || [];
      const groups = (data?.groups as StatusGroup[]) || [];
      if (options.length === 0) return type;

      const groupedOptions: string[] = [];
      for (const group of groups) {
        const groupOptions = options
          .filter(o => group.option_ids.includes(o.id))
          .map(o => o.name);
        if (groupOptions.length > 0) {
          groupedOptions.push(`${group.name}: ${groupOptions.join(', ')}`);
        }
      }
      return `status {${groupedOptions.join(' | ')}}`;
    }

    case 'relation': {
      const relatedDb = (data?.data_source_id as string) || (data?.database_id as string) || 'unknown';
      return `relation → ${relatedDb.slice(0, 8)}...`;
    }

    case 'rollup': {
      const rollupProp = (data?.rollup_property_name as string) || '';
      const relationProp = (data?.relation_property_name as string) || '';
      return `rollup(${relationProp}.${rollupProp})`;
    }

    case 'formula': {
      return 'formula';
    }

    default:
      return type;
  }
}

export function registerDatabasesCommand(program: Command): void {
  const databases = program
    .command('database')
    .alias('databases')
    .alias('db')
    .description('Manage Notion databases');

  // List all accessible databases
  databases
    .command('list')
    .alias('ls')
    .description('List all accessible databases')
    .option('-l, --limit <number>', 'Max databases to show', '20')
    .option('-j, --json', 'Output raw JSON')
    .option('--compact', 'Compact output (names and IDs only)')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      const result = await client.post('search', {
        filter: { property: 'object', value: 'data_source' },
        page_size: parseInt(options.limit, 10),
      }) as { results: DatabaseWithDataSources[] };

      if (options.json) {
        console.log(formatOutput(result.results));
        return;
      }

      console.log(`Found ${result.results.length} accessible database(s):\n`);

      for (const db of result.results) {
        try {
          const title = getDbTitle(db);
          const multiSource = isMultiDataSource(db);
          const multiTag = multiSource ? ' [multi-source]' : '';
          const desc = getDbDescription(db);

          if (options.compact) {
            console.log(`${title}  ${db.id}`);
            continue;
          }

          console.log(`${title}${multiTag}`);
          console.log(`   ID: ${db.id}`);
          if (desc) console.log(`   Description: ${desc}`);

          if (multiSource && db.data_sources) {
            console.log(`   Data sources: ${db.data_sources.map(ds => ds.id).join(', ')}`);
          }

          const properties = db.properties || {};
          const props = Object.entries(properties)
            .filter(([, p]) => p.type !== 'title')
            .slice(0, 8);

          if (props.length > 0) {
            console.log('   Properties:');
            for (const [name, prop] of props) {
              console.log(`     - ${name}: ${formatPropertyType(prop)}`);
            }

            const totalProps = Object.keys(properties).length;
            if (totalProps > 9) {
              console.log(`     ... and ${totalProps - 9} more`);
            }
          }
          console.log('');
        } catch (dbError) {
          console.warn(`   Warning: could not read database ${db?.id || 'unknown'}: ${(dbError as Error).message}`);
          console.log('');
        }
      }
    }));

  // Get detailed schema for a database
  databases
    .command('schema <database_id>')
    .description('Get detailed schema for a database')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();
      const db = await getDatabaseSchema(client, databaseId);

      if (options.json) {
        console.log(formatOutput(db));
        return;
      }

      const title = getDbTitle(db);
      const desc = getDbDescription(db);

      console.log(`# Database: ${title}\n`);
      console.log(`ID: ${db.id}`);
      if (desc) console.log(`Description: ${desc}`);
      console.log(`\n## Properties\n`);

      for (const [name, prop] of Object.entries(db.properties)) {
        const typeInfo = formatPropertyType(prop);
        console.log(`- **${name}** (${typeInfo})`);

        if (prop.type === 'select' || prop.type === 'multi_select') {
          const data = prop[prop.type] as { options?: SelectOption[] };
          const opts = data?.options || [];
          if (opts.length > 0) {
            console.log(`  Options: ${opts.map(o => `"${o.name}"`).join(', ')}`);
          }
        } else if (prop.type === 'status') {
          const data = prop.status as { options?: SelectOption[]; groups?: StatusGroup[] };
          const opts = data?.options || [];
          const groups = data?.groups || [];

          for (const group of groups) {
            const groupOpts = opts.filter(o => group.option_ids.includes(o.id));
            if (groupOpts.length > 0) {
              console.log(`  ${group.name}: ${groupOpts.map(o => `"${o.name}"`).join(', ')}`);
            }
          }
        }
      }

      console.log(`\n## Usage Examples\n`);
      console.log('```bash');
      console.log(`# Query this database`);
      console.log(`notion db query ${databaseId.slice(0, 8)}... --limit 10`);
      console.log('');
      console.log(`# Create a new entry`);
      console.log(`notion page create --parent ${databaseId.slice(0, 8)}... --title "New Item"`);
      console.log('```');
    }));

  // Get database
  databases
    .command('get <database_id>')
    .description('Retrieve a database by ID')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();
      const db = await getDatabaseSchema(client, databaseId) as Database & Record<string, unknown>;

      if (options.json) {
        console.log(formatOutput(db));
      } else {
        console.log('Database:', formatDatabaseTitle(db));
        console.log('ID:', db.id);
        console.log('\nProperties:');
        for (const [name, prop] of Object.entries(db.properties)) {
          console.log(`  - ${name}: ${prop.type}`);
        }
      }
    }));

  // Query database
  databases
    .command('query <database_id>')
    .description('Query a database')
    .option('-f, --filter <json>', 'Filter as JSON string')
    .option('--filter-prop <property>', 'Property to filter on (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('--filter-type <type>', 'Filter type: equals, contains, etc. (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('--filter-value <value>', 'Filter value (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('--filter-prop-type <propType>', 'Property type: select, status, text, number, date, checkbox (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('-s, --sort <property>', 'Sort by property')
    .option('--sort-dir <direction>', 'Sort direction: asc, desc', 'desc')
    .option('--title <value>', 'Filter by exact title (auto-detects title property)')
    .option('-l, --limit <number>', 'Max results', '100')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};

      // Handle --title shortcut (auto-detects title property from schema)
      if (options.title) {
        const db = await getDatabaseSchema(client, databaseId);
        const titlePropName = Object.entries(db.properties)
          .find(([, p]) => p.type === 'title')?.[0] || 'Name';
        body.filter = {
          property: titlePropName,
          title: { equals: options.title },
        };
      }

      // Handle filter
      if (!body.filter && options.filter) {
        body.filter = JSON.parse(options.filter);
      } else if (!body.filter && options.filterProp.length > 0) {
        const props: string[] = options.filterProp;
        const types: string[] = options.filterType;
        const values: string[] = options.filterValue;
        const propTypes: string[] = options.filterPropType;

        if (props.length !== types.length || props.length !== values.length) {
          console.error('Error: --filter-prop, --filter-type, and --filter-value must be provided the same number of times');
          process.exit(1);
        }

        if (propTypes.length !== 0 && propTypes.length !== props.length) {
          console.error('Error: --filter-prop-type must be provided either for all filter groups or for none');
          process.exit(1);
        }

        const filters = props.map((prop, i) =>
          parseFilter(prop, types[i], values[i], propTypes[i])
        );

        body.filter = filters.length > 1 ? { and: filters } : filters[0];
      }

      // Handle sort
      if (options.sort) {
        body.sorts = [{
          property: options.sort,
          direction: options.sortDir === 'asc' ? 'ascending' : 'descending',
        }];
      }

      if (options.limit) body.page_size = parseInt(options.limit, 10);
      if (options.cursor) body.start_cursor = options.cursor;

      const result = await queryDatabase<PaginatedResponse<{ id: string; properties: Record<string, unknown> }>>(client, databaseId, body);

      if (options.json) {
        console.log(formatOutput(result));
        return;
      }

      for (const item of result.results) {
        const title = getItemTitle(item);
        console.log(`${item.id} ${title}`);
      }
      if (result.has_more) {
        console.log(`(more results, cursor: ${result.next_cursor})`);
      }
    }));

  // Create database
  databases
    .command('create')
    .description('Create a new database')
    .requiredOption('--parent <page_id>', 'Parent page ID')
    .requiredOption('-t, --title <title>', 'Database title')
    .option('--inline', 'Create as inline database')
    .option('-p, --property <name:type...>', 'Add property (e.g., Status:select, Date:date)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      const properties: Record<string, { type?: string; title?: object; [key: string]: unknown }> = {
        Name: { title: {} }, // Default title property
      };

      // Parse additional properties
      if (options.property) {
        for (const prop of options.property) {
          const [name, type] = prop.split(':');
          if (name && type) {
            properties[name] = { [type]: {} };
          }
        }
      }

      const body: Record<string, unknown> = {
        parent: { page_id: options.parent },
        title: [{ type: 'text', text: { content: options.title } }],
        properties,
      };

      if (options.inline) {
        body.is_inline = true;
      }

      const db = await client.post('databases', body);

      if (options.json) {
        console.log(formatOutput(db));
      } else {
        console.log('Database created');
        console.log('ID:', (db as { id: string }).id);
        console.log('URL:', (db as { url: string }).url);
      }
    }));

  // Update database
  databases
    .command('update <database_id>')
    .description('Update database properties')
    .option('-t, --title <title>', 'New title')
    .option('--add-prop <name:type>', 'Add a property')
    .option('--remove-prop <name>', 'Remove a property')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};

      if (options.title) {
        body.title = [{ type: 'text', text: { content: options.title } }];
      }

      const properties: Record<string, unknown> = {};

      if (options.addProp) {
        const [name, type] = options.addProp.split(':');
        if (name && type) {
          properties[name] = { [type]: {} };
        }
      }

      if (options.removeProp) {
        properties[options.removeProp] = null;
      }

      if (Object.keys(properties).length > 0) {
        body.properties = properties;
      }

      const db = await updateDatabase(client, databaseId, body);

      if (options.json) {
        console.log(formatOutput(db));
      } else {
        console.log('Database updated');
      }
    }));
}

function getItemTitle(item: { properties: Record<string, unknown> }): string {
  for (const prop of Object.values(item.properties)) {
    const typedProp = prop as { type: string; title?: Array<{ plain_text: string }> };
    if (typedProp.type === 'title' && typedProp.title) {
      return typedProp.title.map(t => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}
