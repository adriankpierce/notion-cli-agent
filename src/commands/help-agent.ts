/**
 * Help for AI agents - comprehensive quick reference
 */
import { Command } from 'commander';

export function registerHelpAgentCommand(program: Command): void {
  program
    .command('quickstart')
    .alias('qs')
    .description('Quick reference guide for AI agents')
    .action(() => {
      console.log(`
# notion-cli Quick Reference

## Setup
Export your token: export NOTION_TOKEN="ntn_xxx"

## 1. Discover workspace structure
\`\`\`bash
notion db list                       # All databases with properties
notion db list --compact             # Just names + IDs
notion db schema <db_id>             # Full schema with valid values
\`\`\`

## 2. Search and query
\`\`\`bash
notion search "keyword"              # Workspace-wide keyword search
notion db query <db_id> --limit 10   # Query database entries
notion db query <db_id> --title "Exact Name"  # Exact title lookup
\`\`\`

## 3. Read pages
\`\`\`bash
notion page read <page_id>           # Page content as markdown
notion page get <page_id>            # Page properties
notion page get <page_id> --content  # Properties + content blocks
\`\`\`

## 4. Create entries
\`\`\`bash
notion page create --parent <db_id> --title "New Entry"
notion page create --parent <db_id> --title "Task" --prop "Status:status=Todo" --prop "Priority:select=High"
\`\`\`

## 5. Update entries
\`\`\`bash
notion page update <page_id> --prop "Status:status=Done"
notion page edit <page_id> --search "old text" --replace "new text"
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
\`\`\`

## 6. Add content to pages
\`\`\`bash
notion block append <page_id> --text "Hello world"
notion block append <page_id> --heading2 "Section" --bullet "Item 1" --bullet "Item 2"
\`\`\`

## Property type filters

When filtering, specify --filter-prop-type for non-text properties:
- status, select, multi_select, number, date, checkbox, people, relation

Example:
\`\`\`bash
notion db query <db_id> --filter-prop "Status" --filter-type equals --filter-value "Done" --filter-prop-type status
\`\`\`

## Batch operations (reduce tool calls)

\`\`\`bash
notion batch --dry-run --data '[
  {"op":"get","type":"page","id":"xxx"},
  {"op":"create","type":"page","parent":"db_id","data":{...}},
  {"op":"update","type":"page","id":"yyy","data":{...}}
]'
\`\`\`

## Output formats

- Default: compact structured output
- --json or -j: raw Notion API JSON

## Tips

1. Property names and values are case-sensitive — check with \`notion db schema\`
2. Use --dry-run on bulk/batch operations before executing
3. Status properties use "status" type, not "select"
4. Title property name varies per database ("Name", "Task", etc.)
5. Use --clear-prop to clear properties, not empty values

## Help

\`\`\`bash
notion --help                        # List all commands
notion <command> --help              # Help for specific command
\`\`\`
`);
    });
}
