---
name: xmind
description: >
  Create XMind mind map files (.xmind). Use this skill when the user asks to create a mind map,
  mindmap, XMind file, or brainstorming diagram. Produces native .xmind files that open directly
  in the XMind application.
---

# XMind Mind Map Creator

Create `.xmind` files by building a JSON structure and piping it to the bundled script.

## How to create an XMind file

1. Build a JSON object with `path` and `sheets` fields (see format below)
2. Write it to a temp file, then run:

```bash
node <skill-dir>/scripts/create_xmind.mjs < /tmp/xmind_input.json
```

Where `<skill-dir>` is the directory containing this SKILL.md file.

## JSON Input Format

```json
{
  "path": "/Users/user/Desktop/my_mindmap.xmind",
  "sheets": [
    {
      "title": "Sheet 1",
      "rootTopic": {
        "title": "Central Topic",
        "children": [
          {
            "title": "Branch 1",
            "notes": "Plain text note",
            "children": [
              { "title": "Sub-topic A" },
              { "title": "Sub-topic B" }
            ]
          }
        ]
      },
      "relationships": [
        { "sourceTitle": "Sub-topic A", "targetTitle": "Sub-topic B", "title": "related" }
      ]
    }
  ]
}
```

## Topic Properties

Each topic object supports:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string (required) | Topic title |
| `children` | array of topics | Child topics |
| `notes` | string or `{plain?, html?}` | Notes. HTML supports: `<strong>`, `<u>`, `<ul>`, `<ol>`, `<li>`, `<br>`. NOT `<code>`. |
| `href` | string | External URL link |
| `attachment` | string | Absolute path to a file to attach (embedded in the .xmind). Mutually exclusive with `href`. |
| `linkToTopic` | string | Title of another topic to link to (internal `xmind:#id` link, works across sheets) |
| `labels` | string[] | Tags/labels |
| `markers` | string[] | Marker IDs: `task-done`, `task-start`, `priority-1` to `priority-9` |
| `callouts` | string[] | Callout text bubbles |
| `boundaries` | `{range, title?}[]` | Visual grouping of children. Range: `"(start,end)"` |
| `summaryTopics` | `{range, title}[]` | Summary topics spanning children ranges |
| `structureClass` | string | Layout (see below) |

### Layout structures

- `org.xmind.ui.map.clockwise` — balanced map
- `org.xmind.ui.map.unbalanced` — unbalanced map
- `org.xmind.ui.logic.right` — logic chart (right)
- `org.xmind.ui.org-chart.down` — org chart (down)
- `org.xmind.ui.tree.right` — tree (right)
- `org.xmind.ui.fishbone.leftHeaded` — fishbone
- `org.xmind.ui.timeline.horizontal` — timeline

### Task properties

**Simple checkbox** (no dates needed):
- `taskStatus`: `"todo"` or `"done"`

**Planned tasks** (for Gantt/timeline view in XMind):

| Field | Type | Description |
|-------|------|-------------|
| `progress` | number 0.0-1.0 | Completion progress |
| `priority` | number 1-9 | Priority (1=highest) |
| `startDate` | ISO 8601 string | Start date, e.g. `"2026-02-01T00:00:00Z"` |
| `dueDate` | ISO 8601 string | Due date |
| `durationDays` | number | Duration in days (preferred for relative planning) |
| `dependencies` | array | `{targetTitle, type, lag?}` — type: `FS`, `FF`, `SS`, `SF` |

**Two approaches for planned tasks:**

1. **Relative (preferred):** Use `durationDays` + `dependencies`. XMind auto-calculates dates.
2. **Absolute:** Use `startDate` + `dueDate` for fixed dates.

When the user mentions "planning", "schedule", "timeline", "Gantt", "project", "phases", use RELATIVE planned tasks unless specific dates are given.

## Sheet properties

| Field | Type | Description |
|-------|------|-------------|
| `title` | string (required) | Sheet title |
| `rootTopic` | topic (required) | Root topic |
| `relationships` | array | `{sourceTitle, targetTitle, title?}` — connects topics by title |

## Important rules

- The output path MUST end with `.xmind`
- Always write the file where the user requests (e.g. ~/Downloads, ~/Desktop)
- IDs are generated automatically
- Topic references in relationships and dependencies are resolved by title
- HTML notes: only `<strong>`, `<u>`, `<ul>`, `<ol>`, `<li>`, `<br>` are supported. `<code>` is NOT supported by XMind.
- Internal links (`linkToTopic`) work across sheets
- **Notes should be substantial and detailed** — don't just repeat the topic title. Use notes to add explanations, context, definitions, examples, key points, or reasoning. Aim for 2-5 sentences minimum per note. Use HTML notes with `<strong>`, `<ul>`/`<li>`, `<br>` for well-structured content. Most topics should have notes unless they are self-explanatory leaf nodes.
