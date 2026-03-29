# Agent Workflow Recipes

Common Notion workflows for AI agents. Use `notion inspect ws --compact` to discover database IDs.

---

## Daily task triage

Review and organize today's tasks.

```bash
# 1. Load task DB from state
TASKS=$(notion inspect ws --compact   # find your tasks DB id)

# 2. What's overdue?
notion find "overdue" -d $TASKS --llm

# 3. What's due today or this week?
notion find "due this week" -d $TASKS --llm

# 4. What's unassigned?
notion db query $TASKS \
  --filter-prop "Assignee" --filter-type is_empty \
  --filter-prop-type people --llm

# 5. Mark done items
notion page update <page_id> --prop "Status=Done"
# or bulk:
notion bulk update $TASKS --where "Status=In Review" --set "Status=Done" --dry-run
```

---

## Weekly review

Summarize the week and prep for the next.

```bash
TASKS=$(notion inspect ws --compact   # find your tasks DB id)
PROJECTS=$(notion inspect ws --compact   # find your projects DB id)

# What was completed this week?
notion stats timeline $TASKS --days 7

# Health check — any stale items?
notion validate check $TASKS --check-stale 7

# Project status overview
notion db query $PROJECTS --filter-prop "Status" \
  --filter-type does_not_equal --filter-value "Completed" \
  --filter-prop-type status --llm
```

---

## Create a new project + first tasks

```bash
PROJECTS=$(notion inspect ws --compact   # find your projects DB id)
TASKS=$(notion inspect ws --compact   # find your tasks DB id)

# Create project
notion page create --parent $PROJECTS \
  --title "Project Name" \
  --prop "Status=In progress"

# Create first tasks in batch
notion batch --llm --data '[
  {"op":"create","type":"page","parent":"'$TASKS'","data":{"title":"Define scope","Status":"Todo","Priority":"High"}},
  {"op":"create","type":"page","parent":"'$TASKS'","data":{"title":"Set up repo","Status":"Todo","Priority":"High"}},
  {"op":"create","type":"page","parent":"'$TASKS'","data":{"title":"Write first draft","Status":"Todo","Priority":"Medium"}}
]'
```

---

## Summarize a database for a report

```bash
DB_ID="<db_id>"

# Stats overview
notion stats overview $DB_ID

# Get all in-progress items
notion db query $DB_ID \
  --filter-prop "Status" --filter-type equals \
  --filter-value "In Progress" --filter-prop-type status --llm

# Summarize key pages
notion ai summarize <page_id>
```

---

## Sync tasks from an external source (e.g., GitHub issues)

```bash
TASKS=$(notion inspect ws --compact   # find your tasks DB id)

# For each issue, create a task
notion page create --parent $TASKS \
  --title "[GH-42] Fix authentication bug" \
  --prop "Status=Todo" \
  --prop "Priority=High"

# Or batch-create multiple
notion batch --llm --data '[
  {"op":"create","type":"page","parent":"'$TASKS'","data":{"title":"[GH-42] Fix auth","Status":"Todo"}},
  {"op":"create","type":"page","parent":"'$TASKS'","data":{"title":"[GH-43] Update deps","Status":"Todo"}}
]'
```

---

## OKR/Goals check-in

```bash
GOALS=$(notion inspect ws --compact   # find your goals DB id)

# List active goals
notion db query $GOALS \
  --filter-prop "Status" --filter-type does_not_equal \
  --filter-value "Done" --filter-prop-type status --llm

# Summarize a specific goal page
notion ai summarize <goal_page_id>

# Update progress
notion page update <goal_page_id> --prop "Status=On track"
```

---

## Bulk cleanup — archive completed old tasks

```bash
TASKS=$(notion inspect ws --compact   # find your tasks DB id)

# Preview first
notion bulk archive $TASKS --where "Status=Done" --dry-run

# Health check to find stale items
notion validate check $TASKS --check-stale 30 --check-dates

# Execute archive (requires explicit confirmation)
notion bulk archive $TASKS --where "Status=Done" --yes
```

---

## Export to Obsidian / backup

```bash
TASKS=$(notion inspect ws --compact   # find your tasks DB id)

# Export to Obsidian vault
notion export db $TASKS --vault ~/obsidian-vault --folder notion-tasks --content

# Full JSON backup
notion backup $TASKS -o ./backups/tasks-$(date +%Y%m%d) --content
```

---

## Tips

- Run `notion inspect ws --compact` to find database IDs
- Run `notion find "..." --explain` to see what filter was generated before committing
- Use `notion ai prompt <db_id>` to get a DB-specific prompt if you're unsure of the schema
- For multi-step workflows involving many pages, write intermediate results to a temp file rather than keeping them in memory across tool calls
