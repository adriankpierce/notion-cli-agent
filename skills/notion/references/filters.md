# Filter Reference

Full reference for `notion db query` and `notion find` filters.

## Quick syntax

```bash
notion db query <db_id> \
  --filter-prop "<PropertyName>" \
  --filter-type <operator> \
  --filter-value "<value>" \
  --filter-prop-type <type>       # required for non-text properties
```

---

## Property types × operators

### `text` / `title` / `rich_text` / `url` / `email` / `phone_number`
Default — no `--filter-prop-type` needed.

| Operator | Example |
|----------|---------|
| `equals` | `--filter-type equals --filter-value "Bug fix"` |
| `does_not_equal` | `--filter-type does_not_equal --filter-value "Draft"` |
| `contains` | `--filter-type contains --filter-value "API"` |
| `does_not_contain` | `--filter-type does_not_contain --filter-value "archived"` |
| `starts_with` | `--filter-type starts_with --filter-value "Q1"` |
| `ends_with` | `--filter-type ends_with --filter-value ".md"` |
| `is_empty` | `--filter-type is_empty` |
| `is_not_empty` | `--filter-type is_not_empty` |

---

### `status`
```bash
--filter-prop-type status
```

| Operator | Example |
|----------|---------|
| `equals` | `--filter-type equals --filter-value "Done"` |
| `does_not_equal` | `--filter-type does_not_equal --filter-value "Done"` |

⚠️ Use exact status names from the database schema. Status ≠ select.

---

### `select`
```bash
--filter-prop-type select
```

| Operator | Example |
|----------|---------|
| `equals` | `--filter-type equals --filter-value "High"` |
| `does_not_equal` | `--filter-type does_not_equal --filter-value "Low"` |
| `is_empty` | `--filter-type is_empty` |
| `is_not_empty` | `--filter-type is_not_empty` |

---

### `multi_select`
```bash
--filter-prop-type multi_select
```

| Operator | Example |
|----------|---------|
| `contains` | `--filter-type contains --filter-value "backend"` |
| `does_not_contain` | `--filter-type does_not_contain --filter-value "archived"` |
| `is_empty` | `--filter-type is_empty` |
| `is_not_empty` | `--filter-type is_not_empty` |

---

### `number`
```bash
--filter-prop-type number
```

| Operator | Example |
|----------|---------|
| `equals` | `--filter-type equals --filter-value "100"` |
| `does_not_equal` | `--filter-type does_not_equal --filter-value "0"` |
| `greater_than` | `--filter-type greater_than --filter-value "50"` |
| `less_than` | `--filter-type less_than --filter-value "10"` |
| `greater_than_or_equal_to` | `--filter-type greater_than_or_equal_to --filter-value "1"` |
| `less_than_or_equal_to` | `--filter-type less_than_or_equal_to --filter-value "100"` |
| `is_empty` | `--filter-type is_empty` |
| `is_not_empty` | `--filter-type is_not_empty` |

---

### `date` / `created_time` / `last_edited_time`
```bash
--filter-prop-type date
```

| Operator | Example value |
|----------|---------------|
| `equals` | `"2026-03-10"` |
| `before` | `"2026-01-01"` |
| `after` | `"2025-12-31"` |
| `on_or_before` | `"2026-03-31"` |
| `on_or_after` | `"2026-01-01"` |
| `is_empty` | (no value) |
| `is_not_empty` | (no value) |
| `past_week` | (no value) |
| `past_month` | (no value) |
| `next_week` | (no value) |
| `next_month` | (no value) |

Date format: `YYYY-MM-DD`

---

### `checkbox`
```bash
--filter-prop-type checkbox
```

| Operator | Example |
|----------|---------|
| `equals` | `--filter-type equals --filter-value "true"` |
| `equals` | `--filter-type equals --filter-value "false"` |

---

### `people` / `created_by` / `last_edited_by`
```bash
--filter-prop-type people
```

| Operator | Example |
|----------|---------|
| `contains` | `--filter-type contains --filter-value "<user_id>"` |
| `does_not_contain` | — |
| `is_empty` | `--filter-type is_empty` |
| `is_not_empty` | `--filter-type is_not_empty` |

Get user IDs via `notion user list --json`.

---

### `relation`
```bash
--filter-prop-type relation
```

| Operator |
|----------|
| `contains` |
| `does_not_contain` |
| `is_empty` |
| `is_not_empty` |

---

## Common filter examples

```bash
# Find all incomplete tasks
notion db query <tasks_db> \
  --filter-prop "Status" --filter-type does_not_equal \
  --filter-value "Done" --filter-prop-type status

# Find overdue items (due date in the past, not done)
notion find "overdue" -d <tasks_db> --llm

# Find unassigned items
notion db query <tasks_db> \
  --filter-prop "Assignee" --filter-type is_empty \
  --filter-prop-type people

# Find high priority items
notion db query <tasks_db> \
  --filter-prop "Priority" --filter-type equals \
  --filter-value "High" --filter-prop-type select

# Find items due this week
notion db query <tasks_db> \
  --filter-prop "Due" --filter-type next_week \
  --filter-prop-type date

# Natural language (translates to filters automatically)
notion find "high priority unassigned overdue" -d <tasks_db> --llm
notion find "in progress since last week" -d <tasks_db> --explain
```

---

## Tips

- Run `notion db schema <db_id>` to see all property names and types before filtering
- Status values are workspace-specific — always check schema for exact strings
- `notion find` handles common natural language patterns (done/hecho, overdue/vencida, unassigned/sin asignar, this week/esta semana)
