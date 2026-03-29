# Notion CLI Skills

Agent skills for the Notion CLI, following the [AgentSkills](https://agentskills.dev) progressive disclosure spec.

## Structure

```
skills/
└── notion/                  # Core CLI skill
    ├── SKILL.md
    └── references/
        ├── filters.md           # All property types × operators
        ├── batch-patterns.md    # Multi-op patterns for minimal tool calls
        └── workflows.md         # Common agent workflow recipes
```

## Skill loading

| Level | Content | Loaded |
|-------|---------|--------|
| `name` + `description` | Trigger metadata | Always in context |
| `SKILL.md` body | Core workflow + commands | When skill triggers |
| `references/*.md` | Deep reference material | On demand as needed |

The main SKILL.md stays small. Agents only pull in filters/workflows/batch docs when those topics arise.

## Installation

### Claude Code / Cursor / other agents

Add the skill path to your agent's context or system prompt. The `SKILL.md` files are self-contained.

### OpenClaw

```bash
cp -r skills/notion ~/.local/share/openclaw/skills/
# or symlink:
ln -s $(pwd)/skills/notion ~/.local/share/openclaw/skills/
```

## Getting started

1. Install the CLI: `npm install -g notion-cli-agent`
2. Set token: `export NOTION_TOKEN="ntn_..."` or save to `~/.config/notion/api_key`
3. Discover your workspace: `notion inspect ws --compact`
4. Start working: `notion page read <page_id>`, `notion page create --parent <db_id> --file doc.md`, etc.
