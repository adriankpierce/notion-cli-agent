---
name: notion
description: Use the local Notion CLI to query, create, read, edit, and manage Notion pages and databases via shell. Use when interacting with Notion workspaces, querying databases, creating or updating pages, managing tasks, or running bulk/batch operations on Notion data. Prefer over Notion MCP or API calls.
---

# notion

Local CLI for full Notion access.

```bash
notion <command> [options]   # globally installed via npm
```

Auth: `NOTION_TOKEN` env var or `~/.config/notion/api_key`.

## Discover

Before anything, find databases and understand their schemas.

```bash
notion db list                                  # all databases with IDs, descriptions, and property summaries
notion db list --compact                        # just database names + IDs (one line each)
notion db schema <db_id>                        # full schema: property names, types, valid select/status values
```

## Query & Search

**`db query`** — precise filtering on a known database:

```bash
notion db query <db_id> --limit 10
notion db query <db_id> --title "Exact Page Name"
notion db query <db_id> --sort "Created time" --sort-dir desc --limit 5
notion db query <db_id> \
  --filter-prop "Status" --filter-type equals \
  --filter-value "Done" --filter-prop-type status
```

`--filter-prop-type` is required for non-text properties: `status` · `select` · `multi_select` · `number` · `date` · `checkbox` · `people` · `relation`. See `references/filters.md` for all operators.

**`search`** — workspace-wide keyword search (powered by Notion's search API, may miss long/common titles):

```bash
notion search "keyword" --limit 10
notion search "keyword" --db <db_id>            # filter results to one database
notion search "exact title" --exact --first     # client-side exact title match
```

**Use `db query --title` for exact lookups in a known database, not `search --exact`.**

## Read

```bash
notion page read <page_id>                      # page content as markdown
notion page read <page_id> -o page.md           # save to file
notion page get <page_id>                       # page properties only
notion page get <page_id> --content             # properties + content blocks
```

## Create

```bash
notion page create --parent <db_id> --title "Meeting Notes" --file notes.md
notion page create --parent <db_id> --title "Task" \
  --prop "Status:status=Todo" --prop "Priority:select=High"
notion page create --parent <page_id> --parent-type page --title "Subpage"
```

If `--title` is omitted, Notion extracts the first `# h1` heading as the title.

## Update

**Properties:**

```bash
notion page update <page_id> --prop "Status:status=Done"
notion page update <page_id> --title "New Title"
notion page update <page_id> --clear-prop "Assignee"
notion page update <page_id> --icon 🚀
```

**Content (search-and-replace):**

```bash
notion page edit <page_id> --search "old text" --replace "new text"
notion page edit <page_id> --search "typo" --replace "fixed" --all    # all matches
notion page edit <page_id> --search "old" --replace "new" --dry-run   # preview
```

Search is exact and case-sensitive. Must match exactly once unless `--all` is used.

## Files

```bash
notion file upload <page_id> photo.jpg                          # local file
notion file upload <page_id> --url https://example.com/doc.pdf  # from URL
notion file upload <page_id> photo.jpg --caption "Vacation" --position top
```

Block type auto-detected from extension (image, video, audio, pdf, or generic file).

## Batch & Bulk

**`batch`** — multiple operations in one command. Uses raw Notion API property format:

```bash
notion batch --dry-run --data '[
  {"op":"get","type":"page","id":"<page_id>"},
  {"op":"create","type":"page","parent":"<db_id>","data":{"properties":{"Name":{"title":[{"text":{"content":"New"}}]}}}},
  {"op":"update","type":"page","id":"<id>","data":{"properties":{"Status":{"status":{"name":"Done"}}}}}
]'
notion batch --data '[...]'                     # execute (remove --dry-run)
```

See `references/batch-patterns.md` for all operation types and patterns.

**`bulk`** — mass updates with simple filter syntax:

```bash
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
notion bulk archive <db_id> --where "Status=Done" --dry-run
```

## Property syntax

`--prop` auto-detects plain strings as `select`. Use `Key:type=Value` to force a type:

```bash
--prop "Status:status=Done"        # status (not select)
--prop "Notes:rich_text=Some text" # rich_text (not select)
--prop "Owner:people=<user_id>"    # people
```

## Output

Default output is compact and structured. Use `--json` for raw Notion API JSON.

## Rules

- Property values are **case-sensitive** — verify exact values with `db schema`
- Title property name varies per database (`"Name"`, `"Task"`, etc. — check schema)
- Use `--clear-prop` to clear properties, not empty values like `Owner:people=`
- Always `--dry-run` before any bulk/batch write
- Confirm with user before destructive bulk operations

## References

- `references/filters.md` — all property types × filter operators with examples
- `references/batch-patterns.md` — batch operation types and patterns
