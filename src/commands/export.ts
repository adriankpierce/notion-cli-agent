/**
 * Export commands - export pages and databases to Markdown/Obsidian
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as fs from 'fs';
import * as path from 'path';
import { queryAllPages } from '../utils/database-resolver.js';
import { readPageMarkdown, getPageTitle, getPropertyRawValue } from '../utils/notion-helpers.js';
import { withErrorHandler } from '../utils/command-handler.js';
import type { Page } from '../types/notion.js';

function generateFrontmatter(page: Page, includeId = true): string {
  const lines: string[] = ['---'];
  
  if (includeId) {
    lines.push(`notion_id: "${page.id}"`);
  }
  
  if (page.url) {
    lines.push(`notion_url: "${page.url}"`);
  }
  
  if (page.created_time) {
    lines.push(`created: ${page.created_time.split('T')[0]}`);
  }
  
  if (page.last_edited_time) {
    lines.push(`updated: ${page.last_edited_time.split('T')[0]}`);
  }
  
  // Add all properties
  for (const [name, value] of Object.entries(page.properties)) {
    const prop = value as Record<string, unknown>;
    if (prop.type === 'title') continue; // Title is the filename
    
    const val = getPropertyRawValue(prop);
    if (val === null || val === undefined || val === '') continue;
    
    // Sanitize property name for YAML
    const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${safeName}:`);
      val.forEach(v => lines.push(`  - "${String(v).replace(/"/g, '\\"')}"`));
    } else if (typeof val === 'string') {
      lines.push(`${safeName}: "${val.replace(/"/g, '\\"')}"`);
    } else if (typeof val === 'boolean') {
      lines.push(`${safeName}: ${val}`);
    } else if (typeof val === 'number') {
      lines.push(`${safeName}: ${val}`);
    }
  }
  
  lines.push('---\n');
  return lines.join('\n');
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200); // Limit length
}

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('Export pages and databases to Markdown/Obsidian');

  // Export single page
  exportCmd
    .command('page <page_id>')
    .description('Export a page to Markdown')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--obsidian', 'Include Obsidian-compatible frontmatter')
    .option('--no-content', 'Export only frontmatter, no content')
    .option('--no-frontmatter', 'Export only content, no frontmatter')
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();

      // Fetch page
      const page = await client.get(`pages/${pageId}`) as Page;
      const title = getPageTitle(page);

      let output = '';

      // Add frontmatter
      if (options.frontmatter !== false && options.obsidian) {
        output += generateFrontmatter(page);
      }

      // Add title
      output += `# ${title}\n\n`;

      // Add content via native markdown API
      if (options.content !== false) {
        const response = await readPageMarkdown(client, pageId);
        output += response.markdown;
        if (response.truncated) {
          console.error('Warning: Page content was truncated (very large page)');
        }
      }

      // Output
      if (options.output) {
        fs.writeFileSync(options.output, output);
        console.log(`Exported to ${options.output}`);
      } else {
        console.log(output);
      }
    }));

  // Export database to Obsidian vault
  exportCmd
    .command('database <database_id>')
    .alias('db')
    .description('Export database entries to Obsidian vault')
    .requiredOption('--vault <path>', 'Obsidian vault path')
    .option('--folder <name>', 'Subfolder in vault', '')
    .option('--content', 'Also export page content (slower)')
    .option('--limit <number>', 'Max entries to export')
    .option('--filter <json>', 'Filter as JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();
        
        // Determine output folder
        const vaultPath = path.resolve(options.vault);
        const outputFolder = options.folder 
          ? path.join(vaultPath, options.folder)
          : vaultPath;
        
        // Create folder if needed
        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }
        
        // Query all pages from database
        const pages = await queryAllPages(client, databaseId, {
          filter: options.filter ? JSON.parse(options.filter) : undefined,
          limit: options.limit ? parseInt(options.limit, 10) : undefined,
          onProgress: (n) => process.stdout.write(`\rFetching ${n} pages...`),
        });

        let exported = 0;
        for (const page of pages) {
          const title = getPageTitle(page);
          const filename = sanitizeFilename(title) + '.md';
          const filepath = path.join(outputFolder, filename);

          let content = generateFrontmatter(page);
          content += `# ${title}\n\n`;

          if (options.content) {
            try {
              const response = await readPageMarkdown(client, page.id);
              content += response.markdown;
            } catch {
              content += `<!-- Failed to fetch content -->\n`;
            }
          }

          fs.writeFileSync(filepath, content);
          exported++;
          process.stdout.write(`\rExported ${exported}/${pages.length} pages...`);
        }

        console.log(`\nExported ${exported} pages to ${outputFolder}`);
    }));
}
