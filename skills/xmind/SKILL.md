---
name: xmind
description: >
  Create and read XMind mind map files (.xmind), supporting both modern (XMind Zen/2020+) and legacy (XMind 8) formats.
  Use this skill whenever the user mentions mind maps,
  brain maps, XMind, brainstorming diagrams, flowcharts, Gantt charts, project planning with visual maps,
  or wants to analyze/search existing .xmind files. Trigger on both English and Chinese expressions:
  "思维导图", "脑图", "脑图文件", "xmind", "mind map", "mindmap", "画个脑图", "做个思维导图",
  "创建脑图", "打开脑图", "分析思维导图", "看看这个xmind", "甘特图", "流程图", "逻辑图",
  "项目计划图", "鱼骨图", "时间线". Also trigger when the user asks to read, open, search, compare,
  or extract nodes from .xmind files, even if they don't explicitly say "XMind" — e.g. "帮我看看这个文件",
  "找一下脑图", "哪些任务没完成", "对比这几个文件".
---

# XMind Mind Map Skill

Create, read, and analyze `.xmind` mind map files. Supports natural Chinese and English interaction.

## Natural language routing

This skill supports both Chinese and English. When the user makes a request, identify the intent and route to the correct script and action. Respond in the same language the user uses.

### Creation intents → `create_xmind.mjs`

| User says (Chinese) | User says (English) | Route to |
|---------------------|---------------------|----------|
| "帮我做个思维导图" / "创建脑图" / "画个脑图" / "生成xmind" / "做个脑图" | "create a mind map" / "make an xmind" / "build a brainstorm" | `create_xmind.mjs` — standard mind map |
| "做个项目计划" / "甘特图" / "排期" / "时间线" / "项目排期" / "里程碑" | "project plan" / "Gantt chart" / "timeline" / "schedule" / "milestones" | `create_xmind.mjs` — use planned tasks with `durationDays` + `dependencies` |
| "画个流程图" / "逻辑图" / "算法图" / "画个程序流程" | "flowchart" / "logic diagram" / "algorithm diagram" | `create_xmind.mjs` — use `freePositioning: true` + `detachedTopics` + straight relationships |
| "组织架构图" / "组织结构" / "人员架构" | "org chart" / "organization structure" | `create_xmind.mjs` — use `org.xmind.ui.org-chart.down` layout |
| "鱼骨图" / "因果分析" / "根因分析" | "fishbone" / "cause and effect" / "root cause" | `create_xmind.mjs` — use `org.xmind.ui.fishbone.leftHeaded` layout |
| "待办清单" / "任务清单" / "todo" | "todo list" / "checklist" / "task list" | `create_xmind.mjs` — use `taskStatus: "todo"/"done"` |
| "把这个PDF/文档/内容整理成脑图" / "总结成思维导图" | "summarize as mind map" / "turn this into a mind map" | Read the source content first, then `create_xmind.mjs` |

### Read/analysis intents → `read_xmind.mjs`

| User says (Chinese) | User says (English) | Action | Extra params |
|---------------------|---------------------|--------|-------------|
| "打开这个xmind" / "看看这个脑图" / "分析一下这个思维导图" / "读取这个文件" | "open this xmind" / "read this mind map" / "analyze this file" | `read` | `path` |
| "找一下xmind文件" / "有哪些脑图" / "列出所有思维导图" | "find xmind files" / "list mind maps" / "what xmind files are there" | `list` | `directory` |
| "搜索脑图" / "找包含xxx的脑图" / "哪个xmind里有xxx" | "search mind maps for..." / "find the xmind with..." | `search_files` | `pattern`, `directory` |
| "对比这几个脑图" / "同时打开这些文件" / "比较这两个思维导图" | "compare these maps" / "read multiple files" | `read_multiple` | `paths` |
| "找到xxx节点" / "定位到xxx" / "xxx在哪个位置" | "find the node about..." / "locate..." / "where is..." | `extract_node` | `path`, `searchQuery` |
| "查找所有待办" / "哪些任务没完成" / "还有什么没做的" / "看看做完了哪些" | "find all todos" / "what tasks are incomplete" / "show done tasks" | `search_nodes` | `taskStatus: "todo"` or `"done"` |
| "搜索笔记内容" / "在备注里找xxx" / "哪个节点的笔记提到了xxx" | "search in notes for..." / "find notes mentioning..." | `search_nodes` | `searchIn: ["notes"]`, `query` |
| "搜索标签" / "找带xxx标签的" | "find nodes with label..." / "search labels" | `search_nodes` | `searchIn: ["labels"]`, `query` |
| "搜索xxx" / "在脑图里找xxx" / "全文搜索" | "search for..." / "find in map..." | `search_nodes` | `query` (searches all fields) |

### Routing tips

- When the user provides a `.xmind` file path and asks to "look at" / "check" / "看看" / "打开" it, use `read` action
- When the user says "这个脑图里有什么关于xxx的" (what does this map say about xxx), use `search_nodes`
- When the user asks about task progress ("进度怎么样" / "完成了多少"), use `search_nodes` with `searchIn: ["tasks"]`
- When the user mentions multiple files, use `read_multiple`
- When the request is vague about location ("找到那个关于后端的节点"), use `extract_node` for fuzzy matching
- Always respond in the language the user used — if they speak Chinese, reply in Chinese

## How to create an XMind file

1. Build a JSON object with `path` and `sheets` fields (see format below)
2. Write it to a temp file, then run:

```bash
node <skill-dir>/scripts/create_xmind.mjs < /tmp/xmind_input.json
```

Where `<skill-dir>` is the directory containing this SKILL.md file.

### Updating an existing file (theme/style preservation)

If `path` points to a file that already exists (e.g. you're adding/editing a branch in a mind map someone already styled), `create_xmind.mjs` automatically preserves that file's visual theme, layout extensions, and embedded resources (like `Thumbnails/thumbnail.png`) — matched per-sheet by `title`. You do NOT need to read the old theme, back up the file, or manually merge anything yourself; just include the unchanged sheets/branches in your input JSON (with the same sheet `title`s) alongside the new/edited content, and the script carries the styling forward.

This only applies to the modern `zen` format. If you rewrite a sheet under a **different** title than it had before, it's treated as a brand-new sheet and gets a fresh default theme — keep sheet titles stable across updates when you want styling preserved.

## Format compatibility

Both scripts handle two XMind format families:

| Format | Files inside ZIP | XMind version | Default |
|--------|-----------------|---------------|---------|
| `zen` (modern) | `content.json`, `metadata.json`, `manifest.json` | XMind Zen, XMind 2020+ | Yes |
| `legacy` (XML) | `content.xml`, `meta.xml`, `META-INF/manifest.xml` | XMind 3–8 (2008–2019) | No |

**Reading:** Auto-detects format — no configuration needed. Checks for `content.json` first (zen), then `content.xml` (legacy). All 8 actions work identically on both formats.

**Creating:** Add `"format"` to the input JSON. Accepts many version aliases:

```json
{
  "path": "/tmp/old_format.xmind",
  "format": "xmind8",
  "sheets": [...]
}
```

| Alias examples | Resolved format |
|---------------|----------------|
| `"zen"`, `"json"`, `"latest"`, `"modern"`, `"new"` | Modern (JSON) |
| `"xmind2024"`, `"2024"`, `"xmind2020"`, `"2020"` | Modern (JSON) |
| `"legacy"`, `"xml"`, `"old"` | Legacy (XML) |
| `"xmind8"`, `"xmind7"`, `"xmind6"`, `"8"`, `"7"` | Legacy (XML) |
| `"2013"`, `"2012"`, `"2008"` | Legacy (XML) |
| `"pro8"`, `"pro7"` | Legacy (XML) |

**Heuristic for numeric values:** version ≤ 9 → legacy (XMind 3–8), version ≥ 10 → zen (XMind 10+), year ≤ 2019 → legacy, year ≥ 2020 → zen.

**Checking format:** Use `format_info` action to inspect an existing file:
```bash
echo '{"action": "format_info", "path": "/path/to/file.xmind"}' | node <skill-dir>/scripts/read_xmind.mjs
```

When the user says "兼容旧版" / "XMind 8格式" / "旧版本格式" / "old format" / "XMind 8 compatible" / "兼容其他编辑器", use `"format": "legacy"`. Otherwise use the default zen format.

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
| `shape` | string | Topic shape (see shapes below) |
| `position` | `{x, y}` | Absolute position (only for detached topics in free-positioning sheets) |

### Topic shapes

- `org.xmind.topicShape.roundedRect` — rounded rectangle (default)
- `org.xmind.topicShape.diamond` — diamond (use for conditions/decisions)
- `org.xmind.topicShape.ellipserect` — ellipse (use for start/end)
- `org.xmind.topicShape.rect` — rectangle
- `org.xmind.topicShape.underline` — underline only
- `org.xmind.topicShape.circle` — circle
- `org.xmind.topicShape.parallelogram` — parallelogram (use for I/O)

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

When the user mentions "planning", "schedule", "timeline", "Gantt", "project", "phases", "排期", "甘特图", "项目计划", "时间线", "里程碑", use RELATIVE planned tasks unless specific dates are given.

## Sheet properties

| Field | Type | Description |
|-------|------|-------------|
| `title` | string (required) | Sheet title |
| `rootTopic` | topic (required) | Root topic |
| `relationships` | array | `{sourceTitle, targetTitle, title?, shape?}` — connects topics by title. `shape`: `"org.xmind.relationshipShape.curved"` (default) or `"org.xmind.relationshipShape.straight"` |
| `detachedTopics` | array of topics | Free-floating topics (require `freePositioning: true` and `position` on each topic) |
| `freePositioning` | boolean | Enable free topic positioning (for logic/flow diagrams) |

## Logic / Flow diagrams

For flowcharts, logic diagrams, or algorithmic diagrams, use **free positioning** with **detached topics** and **straight relationships**:

```json
{
  "path": "/tmp/flowchart.xmind",
  "sheets": [{
    "title": "Algorithm",
    "freePositioning": true,
    "rootTopic": {
      "title": "START",
      "shape": "org.xmind.topicShape.ellipserect",
      "structureClass": "org.xmind.ui.map.clockwise"
    },
    "detachedTopics": [
      {"title": "IS X > 0?", "position": {"x": 0, "y": 130}, "shape": "org.xmind.topicShape.diamond"},
      {"title": "PRINT YES", "position": {"x": 200, "y": 130}},
      {"title": "PRINT NO", "position": {"x": -200, "y": 130}},
      {"title": "END", "position": {"x": 0, "y": 260}, "shape": "org.xmind.topicShape.ellipserect"}
    ],
    "relationships": [
      {"sourceTitle": "START", "targetTitle": "IS X > 0?", "shape": "org.xmind.relationshipShape.straight"},
      {"sourceTitle": "IS X > 0?", "targetTitle": "PRINT YES", "title": "YES", "shape": "org.xmind.relationshipShape.straight"},
      {"sourceTitle": "IS X > 0?", "targetTitle": "PRINT NO", "title": "NO", "shape": "org.xmind.relationshipShape.straight"},
      {"sourceTitle": "PRINT YES", "targetTitle": "END", "shape": "org.xmind.relationshipShape.straight"},
      {"sourceTitle": "PRINT NO", "targetTitle": "END", "shape": "org.xmind.relationshipShape.straight"}
    ]
  }]
}
```

**Conventions:** Use **ellipse** for start/end, **diamond** for conditions, **rectangle** (default) for actions, **parallelogram** for I/O. Use `"org.xmind.relationshipShape.straight"` for all connectors. Position topics on a grid (y increments of ~130px, x offsets of ~200px for branches).

When the user mentions "flowchart", "algorithm", "logic diagram", "流程图", "逻辑图", "算法图", "程序流程", use this pattern.

## Working with large files

When reading a PDF or other large file fails (e.g. "PDF too large"), extract text using CLI tools before building the mind map:

```bash
# Preferred: pdftotext (install: apt install poppler-utils)
pdftotext input.pdf /tmp/extracted.txt

# Fallback if pdftotext unavailable:
python3 -c "
import subprocess, pathlib, sys
p = sys.argv[1]
try:
    subprocess.run(['pdftotext', p, '/tmp/extracted.txt'], check=True)
except FileNotFoundError:
    subprocess.run(['pip', 'install', 'pymupdf'], check=True, capture_output=True)
    import importlib; fitz = importlib.import_module('fitz')
    doc = fitz.open(p)
    pathlib.Path('/tmp/extracted.txt').write_text('\n'.join(page.get_text() for page in doc))
" input.pdf
```

Then read `/tmp/extracted.txt` to build the mind map.

## How to read and analyze XMind files

Pipe a JSON object with an `action` field to the read script:

```bash
echo '{"action": "read", "path": "/path/to/file.xmind"}' | node <skill-dir>/scripts/read_xmind.mjs
```

### Available actions

| Action | Input fields | Description |
|--------|-------------|-------------|
| `read` | `path` | Parse a .xmind file and return full mind map structure as JSON |
| `list` | `directory` | Recursively scan a directory for .xmind files |
| `search_files` | `pattern`, `directory` | Search for .xmind files by name or content |
| `read_multiple` | `paths` (array) | Read multiple .xmind files at once |
| `extract_node` | `path`, `searchQuery` | Fuzzy path search — returns top 5 matches ranked by confidence |
| `extract_node_by_id` | `path`, `nodeId` | Extract a specific node by its XMind ID |
| `search_nodes` | `path`, `query`, `searchIn?`, `caseSensitive?`, `taskStatus?` | Advanced multi-field search |
| `format_info` | `path` | Detect XMind format version (zen/legacy) and list internal files |

### Action details

**`read`** — Parse a complete mind map:
```bash
echo '{"action": "read", "path": "/path/to/file.xmind"}' | node <skill-dir>/scripts/read_xmind.mjs
```
Returns an array of sheets, each with a root topic containing the full tree structure including notes, labels, markers, task status, relationships, etc.

**`list`** — Find .xmind files in a directory:
```bash
echo '{"action": "list", "directory": "/Users/user/Documents"}' | node <skill-dir>/scripts/read_xmind.mjs
```

**`search_files`** — Search by filename or content:
```bash
echo '{"action": "search_files", "pattern": "project", "directory": "/Users/user"}' | node <skill-dir>/scripts/read_xmind.mjs
```
Filename matches are returned first, then content matches.

**`extract_node`** — Fuzzy search when you don't know the exact path:
```bash
echo '{"action": "extract_node", "path": "/path/to/file.xmind", "searchQuery": "Backend API"}' | node <skill-dir>/scripts/read_xmind.mjs
```
Returns top 5 matches with confidence scores. Use when exploring complex maps.

**`extract_node_by_id`** — Direct ID lookup (fastest):
```bash
echo '{"action": "extract_node_by_id", "path": "/path/to/file.xmind", "nodeId": "abc123def456"}' | node <skill-dir>/scripts/read_xmind.mjs
```

**`search_nodes`** — Advanced search with filters:
```bash
echo '{"action": "search_nodes", "path": "/path/to/file.xmind", "query": "auth", "searchIn": ["title", "notes"], "taskStatus": "todo"}' | node <skill-dir>/scripts/read_xmind.mjs
```
`searchIn` options: `title`, `notes`, `labels`, `callouts`, `tasks`. Default: all fields.

### When to use each action

- **Browsing/understanding a map**: Use `read` to get the full structure
- **Finding .xmind files**: Use `list` or `search_files`
- **Navigating to a specific topic**: Use `extract_node` (fuzzy) or `extract_node_by_id` (exact)
- **Finding content across a map**: Use `search_nodes` with appropriate `searchIn` filters
- **Filtering tasks**: Use `search_nodes` with `taskStatus: "todo"` or `"done"`
- **Comparing maps**: Use `read_multiple` to load several files at once

## Important rules

- **NEVER use `unzip`, `zipinfo`, or any external ZIP tool on .xmind files.** Both scripts handle ZIP internally — `create_xmind.mjs` writes ZIP with built-in code, `read_xmind.mjs` reads ZIP with built-in code. Just pipe JSON to the script and it handles everything. There is no need to extract, decompress, or inspect the .xmind file yourself.
- **When editing/adding to an existing .xmind file, always include every sheet with its original `title`** — even sheets you aren't changing — so `create_xmind.mjs` can match them up and preserve their theme/styling/thumbnail (see "Updating an existing file" above). Only omit or retitle a sheet when you intentionally want it reset to default styling.
- The output path MUST end with `.xmind`
- Always write the file where the user requests (e.g. ~/Downloads, ~/Desktop)
- IDs are generated automatically
- Topic references in relationships and dependencies are resolved by title
- HTML notes: only `<strong>`, `<u>`, `<ul>`, `<ol>`, `<li>`, `<br>` are supported. `<code>` is NOT supported by XMind.
- Internal links (`linkToTopic`) work across sheets
- **Notes should be substantial and detailed** — don't just repeat the topic title. Use notes to add explanations, context, definitions, examples, key points, or reasoning. Aim for 2-5 sentences minimum per note. Use HTML notes with `<strong>`, `<ul>`/`<li>`, `<br>` for well-structured content. Most topics should have notes unless they are self-explanatory leaf nodes.
- The read script outputs JSON to stdout — pipe or redirect as needed
- All read actions require the `action` field in the input JSON
