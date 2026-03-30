# notion-cli-agent

> A command-line interface for Notion — built for AI agents and humans.

[![npm version](https://img.shields.io/npm/v/notion-cli-agent.svg)](https://www.npmjs.com/package/notion-cli-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Uses Notion's native markdown API (`v2026-03-11`) for reading and writing page content. No hand-rolled block conversion — markdown goes straight to and from the Notion API.

---

## Install

```bash
npm install -g notion-cli-agent
```

Requires Node.js 20+ and a [Notion integration token](https://www.notion.so/my-integrations).

## Configure

```bash
# Option 1: Environment variable
export NOTION_TOKEN="ntn_your_token_here"

# Option 2: Config file (persists across sessions)
mkdir -p ~/.config/notion
echo "ntn_your_token_here" > ~/.config/notion/api_key
chmod 600 ~/.config/notion/api_key

# Option 3: Pass directly
notion --token "ntn_xxx" search "query"
```

Then share your pages/databases with the integration in Notion (... menu > Connect to).

---

## Core Markdown Operations

Three commands map 1:1 to Notion's native markdown API:

| Operation | Command | API endpoint |
|-----------|---------|-------------|
| **Create** | `notion page create` | `POST /v1/pages` with `markdown` body |
| **Read** | `notion page read` | `GET /v1/pages/{id}/markdown` |
| **Update** | `notion page edit` | `PATCH /v1/pages/{id}/markdown` |

### Create a page

```bash
# With title only
notion page create --parent <db_id> --title "Meeting Notes"

# With markdown content from file
notion page create --parent <db_id> --title "Design Doc" --file doc.md

# With properties
notion page create --parent <db_id> --title "Bug Fix" \
  --prop "Status:status=Todo" --prop "Priority:select=High"
```

If `--title` is omitted, Notion extracts the first `# h1` heading from the markdown.

### Read a page

```bash
notion page read <page_id>                # markdown to stdout
notion page read <page_id> -o page.md     # save to file
notion page read <page_id> --no-title     # omit the title heading
notion page read <page_id> --json         # raw block JSON
```

### Edit a page (search-and-replace)

```bash
notion page edit <page_id> --search "old text" --replace "new text"
notion page edit <page_id> --search "typo" --replace "fixed" --all
notion page edit <page_id> --search "old" --replace "new" --dry-run
```

Uses Notion's `update_content` operation. Search is exact and case-sensitive. Must match exactly once unless `--all` is used.

---

## File Uploads

Upload files to pages. Block type is auto-detected from the file extension (image, video, audio, pdf, or generic file).

```bash
# Local file
notion file upload <page_id> photo.jpg

# From URL (Notion fetches it)
notion file upload <page_id> --url https://example.com/doc.pdf

# With caption, at top of page
notion file upload <page_id> photo.jpg --caption "Vacation" --position top
```

After upload, the file appears in `page read` markdown output and can be repositioned with `page edit`.

---

## Search and Query

```bash
# Search across workspace
notion search "project plan"
notion search "meeting" --type page

# Query a specific database
notion db query <db_id> --title "Known Page" --json
notion db query <db_id> --limit 20 --llm
notion db query <db_id> --sort "Created time" --sort-dir desc --limit 5 --llm

# Natural language filters
notion find "overdue tasks unassigned" -d <db_id> --llm
notion find "high priority" -d <db_id> --explain
```

For exact lookup by title in a known database, use `db query --title` — not `search`. Notion's search API is fuzzy.

---

## Page Properties

```bash
# Update properties
notion page update <page_id> --prop "Status:status=Done"
notion page update <page_id> --title "New Title"
notion page update <page_id> --clear-prop "Assignee"
notion page update <page_id> --icon emoji_character

# Archive
notion page archive <page_id>
```

Property type hints — auto-detection treats plain strings as `select`. Use `Key:type=Value` to force a type:

```bash
notion page update <id> --prop "Status:status=Done"
notion page update <id> --prop "Notes:rich_text=Some text"
notion page update <id> --prop "Owner:people=<user_id>"
```

---

## Workspace Discovery

```bash
notion db list                           # all databases with properties
notion db list --compact                 # all databases: name + ID
notion db schema <db_id>                 # property types + valid values
```

---

## Import and Export

### Obsidian

```bash
# Export database to vault
notion export db <db_id> --vault ~/obsidian-vault --folder notion-tasks --content

# Import vault to database
notion import obsidian ~/my-vault --to <db_id> --content
```

### Markdown and CSV

```bash
# Import markdown to existing page (replaces content)
notion import markdown doc.md --to <page_id>

# Import CSV to database
notion import csv data.csv --to <db_id>
```

---

## Batch and Bulk Operations

```bash
# Batch: multiple operations in one command
notion batch --dry-run --data '[
  {"op":"get","type":"page","id":"<page_id>"},
  {"op":"create","type":"page","parent":"<db_id>","data":{"title":"New"}},
  {"op":"update","type":"page","id":"<id>","data":{"Status":"Done"}}
]'

# Bulk: update/archive matching entries
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
notion bulk archive <db_id> --where "Status=Done" --yes
```

---

## Other Commands

| Category | Commands |
|----------|----------|
| **Search** | `search` |
| **Pages** | `page get`, `page create`, `page read`, `page edit`, `page update`, `page archive`, `page property` |
| **Files** | `file upload` |
| **Databases** | `db list`, `db schema`, `db get`, `db query`, `db create`, `db update` |
| **Blocks** | `block get`, `block list`, `block append`, `block update`, `block delete` |
| **Comments** | `comment list`, `comment get`, `comment create` |
| **Users** | `user me`, `user list`, `user get` |
| **Export** | `export page`, `export db` |
| **Import** | `import obsidian`, `import csv`, `import markdown` |
| **Find** | `find` |
| **Bulk** | `bulk update`, `bulk archive` |
| **Validate** | `validate check`, `validate lint`, `validate health` |
| **Stats** | `stats overview`, `stats timeline` |
| **Backup** | `backup` |
| **Templates** | `template list`, `template save`, `template use`, `template show`, `template delete` |
| **Duplicate** | `duplicate page`, `duplicate schema`, `duplicate db` |
| **Relations** | `relations backlinks`, `relations link`, `relations unlink`, `relations graph` |
| **Batch** | `batch` |
| **Skill** | `skill install` |
| **API** | `api` |

---

## Agent Skill

Install the CLI skill into any repo for use with Claude Code, Cursor, or other agent frameworks:

```bash
notion skill install              # installs to current repo's .claude/skills/
notion skill install /path/to/repo
```

The skill teaches agents how to use the CLI with progressive disclosure — core commands in `SKILL.md`, detailed references loaded on demand.

---

## Raw API Access

```bash
notion api GET "pages/<page_id>"
notion api POST "search" --data '{"query": "test"}'
notion api GET "users" --query "page_size=5"
```

---

## License

MIT
