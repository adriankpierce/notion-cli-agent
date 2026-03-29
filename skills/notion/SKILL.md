---
name: notion
description: Use the local Notion CLI to query, create, read, edit, and manage Notion pages and databases via shell. Use when interacting with Notion workspaces, querying databases, creating or updating pages, managing tasks, or running bulk/batch operations on Notion data. Prefer over Notion MCP or API calls.
---

# notion

Local CLI for full Notion access.

## Binary

```bash
notion <args>   # globally installed via npm
```

Auth: `NOTION_TOKEN` env var, or `~/.config/notion/api_key`.

## Core Markdown Operations

Three commands map 1:1 to Notion's native markdown API:

| Operation | Command | API |
|-----------|---------|-----|
| **Create** | `notion page create --parent <id> --file content.md` | `POST /v1/pages` with `markdown` body |
| **Read** | `notion page read <page_id>` | `GET /v1/pages/{id}/markdown` |
| **Update** | `notion page edit <page_id> --search "old" --replace "new"` | `PATCH /v1/pages/{id}/markdown` (`update_content`) |

### Create a page with markdown

```bash
notion page create --parent <db_id> --title "Meeting Notes" --file notes.md
notion page create --parent <db_id> --title "Task" --prop "Status:status=Todo" --prop "Priority:select=High"
notion page create --parent <page_id> --parent-type page --title "Subpage" --file doc.md
```

If `--title` is omitted, Notion extracts the first `# h1` heading as the page title.

### Read page content as markdown

```bash
notion page read <page_id>                # markdown to stdout
notion page read <page_id> -o page.md     # save to file
notion page read <page_id> --no-title     # omit the # Title heading
notion page read <page_id> --json         # raw block JSON instead
```

### Edit page content (search-and-replace)

```bash
notion page edit <page_id> --search "old text" --replace "new text"
notion page edit <page_id> --search "typo" --replace "fixed" --all    # replace all matches
notion page edit <page_id> --search "old" --replace "new" --dry-run   # preview
```

Search is exact and case-sensitive. Must match exactly once unless `--all` is used.

## Discover

```bash
notion inspect ws --compact                     # all databases, names + ids
notion inspect ws --json                        # full raw inventory
notion inspect schema <db_id> --llm             # property types + valid values
notion inspect context <db_id>                  # workflow context + examples
notion ai prompt <db_id>                        # DB-specific agent instructions
```

## Query

```bash
# Exact lookup in a known DB (deterministic — uses database query API)
notion db query <db_id> --title "Known Page" --json
notion db query <db_id> --limit 20 --llm                   # compact output
notion db query <db_id> --sort "Created time" --sort-dir desc --limit 5 --llm  # recent first

# Fuzzy search (workspace-wide, best-effort — Notion may miss long titles)
notion search "keyword" --limit 10
notion search "keyword" --db <db_id> --llm                 # filter by parent DB
notion search "short title" --exact --first --json         # best-effort exact match

# Natural language
notion find "overdue tasks unassigned" -d <db_id> --llm
notion find "high priority" -d <db_id> --explain           # preview filter, don't run
```

**For exact lookup by title in a known DB, always use `db query --title` — not `search --exact`.** Notion's search API is fuzzy and may miss pages with long or common-word titles.

## Read page metadata

```bash
notion page get <page_id>                       # properties
notion page get <page_id> --content             # + content blocks
notion page get <page_id> --json                # raw JSON
notion ai summarize <page_id>                   # concise summary
notion ai extract <page_id> --schema "email,phone,date"
```

## Upload files to pages

```bash
notion file upload <page_id> photo.jpg                          # local file
notion file upload <page_id> --url https://example.com/doc.pdf  # from URL
notion file upload <page_id> photo.jpg --caption "Vacation"     # with caption
notion file upload <page_id> photo.jpg --position top           # attach at top
```

Block type is auto-detected from extension (image, video, audio, pdf, or generic file). After upload, the file appears in `page read` markdown output and can be moved with `page edit`.

## Update page properties

```bash
notion page update <page_id> --prop "Status:status=Done"
notion page update <page_id> --title "New Title"
notion page update <page_id> --clear-prop "Assignee"       # type-aware clear
notion page update <page_id> --icon 🚀
```

## Batch (minimize tool calls)

```bash
notion batch --dry-run --data '[
  {"op":"get","type":"page","id":"<page_id>"},
  {"op":"create","type":"page","parent":"<db_id>","data":{"title":"New"}},
  {"op":"update","type":"page","id":"<page_id2>","data":{"Status":"Done"}}
]'
notion batch --llm --data '[...]'               # execute
```

## Bulk & maintenance

```bash
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
notion stats overview <db_id>
notion validate check <db_id> --check-dates --check-stale 30
```

## Output flags

| Flag | Use for |
|------|---------|
| `--llm` | Compact, structured output for agents |
| `--json` / `-j` | Raw JSON for parsing |
| (default) | Human-readable |

## Property type hints for --prop

Auto-detection treats plain strings as `select`. Use `Key:type=Value` to force a type:

```bash
notion page update <id> --prop "Status:status=Done"    # status, not select
notion page update <id> --prop "Notes:rich_text=Text"   # rich_text, not select
notion page update <id> --prop "Owner:people=<user_id>" # people
```

## Property type filters

`--filter-prop-type` is required for non-text properties:

```bash
notion db query <db_id> \
  --filter-prop "Status" --filter-type equals \
  --filter-value "Done" --filter-prop-type status
```

Types: `status` · `select` · `multi_select` · `number` · `date` · `checkbox` · `people` · `relation`

See `references/filters.md` for full operator reference.

## Rules

- Property values are usually **case-sensitive** — verify exact status/select values with `inspect context`
- Title property name varies per DB (`"Name"`, `"Título"`, `"Task"` — check schema)
- Use `--clear-prop` instead of fake empty values like `Owner:people=` or `Tags=`
- `--dry-run` before any bulk/batch write
- Confirm with user before destructive bulk operations

## References

- `references/filters.md` — all property types × filter operators with examples
- `references/batch-patterns.md` — batch workflows (multi-update, bulk status sweep, multi-get)
- `references/workflows.md` — agent workflow recipes (task triage, weekly review, project sync)

## Self-help

```bash
notion quickstart          # full quick reference
notion <command> --help    # per-command help
notion ai suggest <db_id> "what I want to do"
```
