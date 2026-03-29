/**
 * Pages commands - get, create, update, archive, read, write, edit pages
 */
import { Command } from 'commander';
import * as fs from 'fs';
import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, parseProperties } from '../utils/format.js';
import { readPageMarkdown, updatePageMarkdown, fetchAllBlocks, getPageTitle, isParentDatabase, getParentDatabaseId, resolvePropertyName, buildClearPayload, buildTrashPayload } from '../utils/notion-helpers.js';
import { getDatabaseSchema } from '../utils/database-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
import type { Page } from '../types/notion.js';

export function registerPagesCommand(program: Command): void {
  const pages = program
    .command('page')
    .alias('pages')
    .alias('p')
    .description('Manage Notion pages');

  // Get page
  pages
    .command('get <page_id>')
    .description('Retrieve a page by ID')
    .option('-j, --json', 'Output raw JSON')
    .option('--content', 'Also fetch page content (blocks)')
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();
      const page = await client.get(`pages/${pageId}`);

      if (options.content) {
        const blocks = await fetchAllBlocks(client, pageId);
        if (options.json) {
          console.log(formatOutput({ page, blocks }));
        } else {
          console.log('Page:', formatPageTitle(page));
          console.log('ID:', (page as { id: string }).id);
          console.log('\nContent:');
          console.log(formatOutput(blocks));
        }
      } else {
        console.log(options.json ? formatOutput(page) : formatPageTitle(page));
        if (!options.json) {
          console.log('ID:', (page as { id: string }).id);
          console.log('\nProperties:');
          console.log(formatOutput((page as { properties: unknown }).properties));
        }
      }
    }));

  // Create page
  pages
    .command('create')
    .description('Create a new page with optional markdown content (from file or stdin)')
    .requiredOption('--parent <id>', 'Parent page ID or database ID')
    .option('--parent-type <type>', 'Parent type: page, database', 'database')
    .option('-t, --title <title>', 'Page title (or use # h1 in markdown)')
    .option('--title-prop <name>', 'Name of title property (auto-detected if not set)')
    .option('-p, --prop <key=value...>', 'Set property (can be used multiple times)')
    .option('-f, --file <path>', 'Markdown content from file')
    .option('--icon <emoji>', 'Set page icon (emoji character)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      // Detect whether the ID is a database_id or data_source_id.
      // Users may pass either (inspect ws shows data_source IDs, URLs contain database IDs).
      let parent: Record<string, string>;
      if (options.parentType === 'page') {
        parent = { page_id: options.parent };
      } else {
        // Try data_source_id first (what search/inspect return), fall back to database_id
        parent = { data_source_id: options.parent };
      }

        const properties: Record<string, unknown> = {};

        // Handle title - auto-detect title property name from database schema
        if (options.title) {
          let titlePropName = options.titleProp;

          // If not specified and parent is database, fetch schema to find title property
          if (!titlePropName && options.parentType === 'database') {
            try {
              const db = await getDatabaseSchema(client, options.parent) as {
                properties: Record<string, { type: string }>;
              };
              // Find the property with type "title"
              for (const [name, prop] of Object.entries(db.properties)) {
                if (prop.type === 'title') {
                  titlePropName = name;
                  break;
                }
              }
            } catch {
              // Fall back to common defaults
            }
          }

          // Use detected name or fall back based on parent type
          // Non-DB pages (page/workspace parent) use 'title'; DB pages default to 'Name'
          titlePropName = titlePropName || (options.parentType === 'page' ? 'title' : 'Name');
          properties[titlePropName] = {
            title: [{ text: { content: options.title } }],
          };
        }

        // Handle additional properties
        if (options.prop) {
          const parsed = parseProperties(options.prop);
          Object.assign(properties, parsed);
        }

        const body: Record<string, unknown> = { parent, properties };

        if (options.icon) {
          body.icon = { type: 'emoji', emoji: options.icon };
        }

        // Read markdown content from file or stdin
        if (options.file) {
          if (!fs.existsSync(options.file)) {
            console.error(`Error: File not found: ${options.file}`);
            process.exit(1);
          }
          body.markdown = fs.readFileSync(options.file, 'utf-8');
        }

        let page;
        try {
          page = await client.post('pages', body);
        } catch (err) {
          // If data_source_id failed, retry with database_id
          if (options.parentType !== 'page' && (err as Error).message.includes('404')) {
            body.parent = { database_id: options.parent };
            page = await client.post('pages', body);
          } else {
            throw err;
          }
        }

        if (options.json) {
          console.log(formatOutput(page));
        } else {
          console.log('Page created');
          console.log('ID:', (page as { id: string }).id);
          console.log('URL:', (page as { url: string }).url);
        }
    }));

  // Update page
  pages
    .command('update <page_id>')
    .description('Update page properties')
    .option('-t, --title <title>', 'Rename the page title')
    .option('--title-prop <name>', 'Name of title property (auto-detected if not set)')
    .option('-p, --prop <key=value...>', 'Set property (can be used multiple times)')
    .option('--clear-prop <name...>', 'Clear a property (type-aware, e.g., --clear-prop "Assignee")')
    .option('--archive', 'Archive the page')
    .option('--unarchive', 'Unarchive the page')
    .option('--icon <emoji>', 'Set page icon (emoji character)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};
      const properties: Record<string, unknown> = {};

      if (options.title) {
        let titlePropName = options.titleProp;

          // parentType: 'database' | 'page' | null (null = unknown, page fetch failed)
          let detectedParentType: 'database' | 'page' | null = null;
          if (!titlePropName) {
            try {
              const page = await client.get(`pages/${pageId}`) as Page;
              const parentDbId = getParentDatabaseId(page.parent);
              if (isParentDatabase(page.parent) && parentDbId) {
                detectedParentType = 'database';
                const db = await getDatabaseSchema(client, parentDbId) as {
                  properties: Record<string, { type: string }>;
                };
                for (const [name, prop] of Object.entries(db.properties)) {
                  if (prop.type === 'title') {
                    titlePropName = name;
                    break;
                  }
                }
              } else {
                detectedParentType = 'page';
              }
            } catch {
              // Fall back to common default
            }
          }

          // Non-DB pages use 'title'; DB pages default to 'Name'; unknown (fetch failed) → 'title'
          // Note: if fetch failed entirely we can't know parent type — 'title' is Notion's universal key
          titlePropName = titlePropName || (detectedParentType === 'database' ? 'Name' : 'title');
          properties[titlePropName] = {
            title: [{ text: { content: options.title } }],
          };
        }

        if (options.prop) {
          const parsed = parseProperties(options.prop);
          Object.assign(properties, parsed);
        }

        // Handle --clear-prop: fetch schema to determine property type
        if (options.clearProp && options.clearProp.length > 0) {
          const page = await client.get(`pages/${pageId}`) as Page;
          const parentDbId = getParentDatabaseId(page.parent);
          if (!parentDbId) {
            console.error('Error: --clear-prop requires a database-backed page');
            process.exit(1);
          }
          const db = await getDatabaseSchema(client, parentDbId);
          for (const rawName of options.clearProp) {
            const resolved = resolvePropertyName(db.properties, rawName);
            if (!resolved) {
              console.error(`Error: Property "${rawName}" not found in database schema`);
              process.exit(1);
            }
            const propSchema = db.properties[resolved];
            properties[resolved] = buildClearPayload(propSchema.type);
          }
        }

        if (Object.keys(properties).length > 0) {
          body.properties = properties;
        }

        if (options.archive) {
          Object.assign(body, buildTrashPayload(true));
        } else if (options.unarchive) {
          Object.assign(body, buildTrashPayload(false));
        }

        if (options.icon) {
          body.icon = { type: 'emoji', emoji: options.icon };
        }

        const page = await client.patch(`pages/${pageId}`, body);

        if (options.json) {
          console.log(formatOutput(page));
        } else {
          console.log('Page updated');
          console.log('ID:', (page as { id: string }).id);
        }
    }));

  // Archive page (convenience)
  pages
    .command('archive <page_id>')
    .description('Archive a page')
    .action(withErrorHandler(async (pageId: string) => {
      const client = getClient();
      await client.patch(`pages/${pageId}`, buildTrashPayload(true));
      console.log('Page archived');
    }));

  // Get page property
  pages
    .command('property <page_id> <property_id>')
    .description('Get a specific page property (for paginated properties like rollups)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (pageId: string, propertyId: string, options) => {
      const client = getClient();
      const property = await client.get(`pages/${pageId}/properties/${propertyId}`);
      console.log(options.json ? formatOutput(property) : property);
    }));

  // Read page content as Markdown
  pages
    .command('read <page_id>')
    .description('Read page content as Markdown (outputs to stdout)')
    .option('-j, --json', 'Output raw JSON blocks instead of Markdown')
    .option('--no-title', 'Omit the page title heading')
    .option('-o, --output <path>', 'Write to file instead of stdout')
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();

      if (options.json) {
        // Raw JSON mode — return all blocks
        const blocks = await fetchAllBlocks(client, pageId);
        const output = formatOutput(blocks);
        if (options.output) {
          fs.writeFileSync(options.output, output);
          console.error(`Written to ${options.output}`);
        } else {
          console.log(output);
        }
        return;
      }

      let output = '';

      // Include title by default
      if (options.title !== false) {
        const page = await client.get(`pages/${pageId}`) as Page;
        const title = getPageTitle(page);
        output += `# ${title}\n\n`;
      }

      // Read content via native markdown API
      const response = await readPageMarkdown(client, pageId);
      if (response.truncated) {
        console.error('Warning: Page content was truncated (very large page)');
      }
      if (response.unknown_block_ids.length > 0) {
        console.error(`Note: ${response.unknown_block_ids.length} block(s) could not be represented as markdown`);
      }
      output += response.markdown;

      if (options.output) {
        fs.writeFileSync(options.output, output);
        console.error(`Written to ${options.output}`);
      } else {
        process.stdout.write(output);
      }
    }));

  // Edit page content via Notion's update_content (search-and-replace)
  pages
    .command('edit <page_id>')
    .description('Edit page content using search-and-replace on the markdown. Uses Notion\'s update_content API.')
    .requiredOption('-s, --search <text>', 'Text to find in the page markdown (exact, case-sensitive)')
    .requiredOption('-r, --replace <text>', 'Replacement text')
    .option('--all', 'Replace all matches (default: must match exactly once)')
    .option('--allow-deleting-content', 'Allow deletion of child pages/databases')
    .option('--dry-run', 'Show what would change without making changes')
    .option('-j, --json', 'Output raw JSON response')
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();

        if (options.dryRun) {
          // Read current content to show what would match
          const current = await readPageMarkdown(client, pageId);
          const matches = current.markdown.split(options.search).length - 1;
          console.log(`Found ${matches} match(es) for search text`);
          if (matches > 0) {
            console.log(`  Search:  "${options.search.slice(0, 80)}${options.search.length > 80 ? '...' : ''}"`);
            console.log(`  Replace: "${options.replace.slice(0, 80)}${options.replace.length > 80 ? '...' : ''}"`);
            if (matches > 1 && !options.all) {
              console.log(`  Warning: Multiple matches found — use --all to replace all, or be more specific`);
            }
          }
          console.log('\nDry run - no changes made');
          return;
        }

        const response = await updatePageMarkdown(client, pageId, [{
          old_str: options.search,
          new_str: options.replace,
          replace_all_matches: options.all ?? false,
        }], {
          allowDeletingContent: options.allowDeletingContent ?? false,
        });

        if (options.json) {
          console.log(formatOutput(response));
        } else {
          console.log('Page updated');
        }
    }));
}

