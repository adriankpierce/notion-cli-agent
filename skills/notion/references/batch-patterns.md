# Batch Operation Patterns

Use `notion batch` to run multiple operations in a single command, minimizing tool calls.

## Syntax

```bash
notion batch --llm --data '<json_array>'
notion batch --dry-run --data '<json_array>'   # preview first
notion batch -f operations.json                 # from file
```

Operations array: `[{ "op": "...", "type": "...", ... }]`

---

## Operation reference

| `op` | `type` | Required fields | Optional |
|------|--------|-----------------|----------|
| `get` | `page` / `database` / `block` | `id` | — |
| `create` | `page` | `parent`, `data.title` | `data.*` for props |
| `create` | `database` | `parent`, `data.title`, `data.properties` | — |
| `update` | `page` / `database` / `block` | `id`, `data` | — |
| `delete` | `page` / `block` | `id` | — |
| `query` | `database` | `id` | `data.filter`, `data.limit` |
| `append` | `block` | `id`, `data.children` | — |

---

## Patterns

### Multi-get (fetch several pages at once)

```json
[
  {"op": "get", "type": "page", "id": "<page1_id>"},
  {"op": "get", "type": "page", "id": "<page2_id>"},
  {"op": "get", "type": "page", "id": "<page3_id>"}
]
```

```bash
notion batch --llm --data '[
  {"op":"get","type":"page","id":"abc-111"},
  {"op":"get","type":"page","id":"abc-222"},
  {"op":"get","type":"page","id":"abc-333"}
]'
```

---

### Create multiple tasks

`data.properties` must use Notion API property format. Use `notion inspect schema <db_id> --llm` to discover property names and types.

```bash
notion batch --llm --data '[
  {"op":"create","type":"page","parent":"<tasks_db_id>","data":{"properties":{"Name":{"title":[{"text":{"content":"Fix login bug"}}]},"Status":{"status":{"name":"Todo"}},"Priority":{"select":{"name":"High"}}}}},
  {"op":"create","type":"page","parent":"<tasks_db_id>","data":{"properties":{"Name":{"title":[{"text":{"content":"Write tests"}}]},"Status":{"status":{"name":"Todo"}}}}},
  {"op":"create","type":"page","parent":"<tasks_db_id>","data":{"properties":{"Name":{"title":[{"text":{"content":"Update docs"}}]}}}}
]'
```

---

### Update several pages at once

`data` is passed directly to the Notion PATCH /pages endpoint — use `properties` key:

```bash
notion batch --llm --data '[
  {"op":"update","type":"page","id":"<id1>","data":{"properties":{"Status":{"status":{"name":"Done"}}}}},
  {"op":"update","type":"page","id":"<id2>","data":{"properties":{"Status":{"status":{"name":"Done"}}}}},
  {"op":"update","type":"page","id":"<id3>","data":{"properties":{"Assignee":{"people":[{"id":"<user_id>"}]}}}}
]'
```

---

### Query + create in one call

Useful when you need context before creating:

```bash
notion batch --llm --data '[
  {"op":"query","type":"database","id":"<projects_db>","data":{"page_size":5}},
  {"op":"create","type":"page","parent":"<tasks_db>","data":{"properties":{"Name":{"title":[{"text":{"content":"New task"}}]},"Status":{"status":{"name":"Todo"}}}}}
]'
```

---

### Triage sweep (query, then batch-update results)

```bash
# Step 1 — find items to triage
notion find "todo unassigned" -d <tasks_db> --json | jq '.[].id'

# Step 2 — batch update them
notion batch --llm --data '[
  {"op":"update","type":"page","id":"<id1>","data":{"properties":{"Assignee":{"people":[{"id":"<user_id>"}]}}}},
  {"op":"update","type":"page","id":"<id2>","data":{"properties":{"Assignee":{"people":[{"id":"<user_id>"}]}}}}
]'
```

---

### Append content blocks to multiple pages

```bash
notion batch --llm --data '[
  {"op":"append","type":"block","id":"<page1>","data":{"children":[{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Updated via batch"}}]}}]}},
  {"op":"append","type":"block","id":"<page2>","data":{"children":[{"object":"block","type":"to_do","to_do":{"rich_text":[{"type":"text","text":{"content":"Follow up"}}],"checked":false}}]}}
]'
```

---

## Tips

- Always `--dry-run` before executing writes: `notion batch --dry-run --data '[...]'`
- Operations run in parallel by default (configurable concurrency)
- Use `--stop-on-error` when operations are dependent on each other
- For large sweeps (>20 items), prefer `notion bulk update` over batch
- Batch output with `--llm` is compact and parseable per-operation
