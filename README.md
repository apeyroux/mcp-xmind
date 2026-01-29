# MCP XMind Server

A Model Context Protocol server for reading, creating and querying XMind mind maps. This tool provides powerful capabilities for searching, extracting, analyzing and generating XMind files.

## Features

### Reading
- Parse complete mind map structure (multi-sheet)
- Smart fuzzy search across mind maps
- Task management and tracking (to-do + planned tasks)
- Hierarchical content navigation
- Link and reference extraction (external URLs + internal xmind:# links)
- Multi-file analysis
- Label, callout, boundary and summary support
- Directory scanning

### Writing
- Create XMind files from structured JSON
- Nested topics with notes (plain text + HTML formatting)
- Labels, markers, callouts, boundaries, summaries
- Relationships between topics (by title)
- Internal links between topics across sheets (`linkToTopic`)
- Simple to-do tasks (checkbox)
- Planned tasks with Gantt support (dates, progress, priority, duration, dependencies)
- Predefined themes (default, business, dark, simple)
- Layout structures (clockwise, logic.right, org-chart, fishbone, timeline, etc.)
- Overwrite protection

### Security
- Only allows access to specified directories
- Path normalization and validation
- Error handling for invalid access attempts

## Installation
```bash
npm install @modelcontextprotocol/sdk adm-zip zod
npm install --save-dev typescript @types/node
```

## Usage

### Starting the Server

```bash
node dist/index.js <allowed-directory> [additional-directories...]
```

### Available Tools

#### Reading Tools

1. **read_xmind** - Parse and extract complete mind map structure
2. **list_xmind_directory** - Recursively scan for XMind files
3. **read_multiple_xmind_files** - Process multiple files simultaneously
4. **search_xmind_files** - Search files by name or content
5. **extract_node** - Smart fuzzy path matching with ranked results
6. **extract_node_by_id** - Direct node access by ID
7. **search_nodes** - Multi-criteria search (title, notes, labels, callouts, tasks)

#### Writing Tools

8. **create_xmind** - Create XMind files from structured data

## Examples

### Read a Mind Map
```json
{
    "name": "read_xmind",
    "arguments": {
        "path": "/path/to/file.xmind"
    }
}
```

### Search for Nodes
```json
{
    "name": "search_nodes",
    "arguments": {
        "path": "/path/to/file.xmind",
        "query": "project",
        "searchIn": ["title", "notes"],
        "caseSensitive": false
    }
}
```

### Create a Mind Map with Planned Tasks
```json
{
    "name": "create_xmind",
    "arguments": {
        "path": "/path/to/output.xmind",
        "sheets": [{
            "title": "Project Plan",
            "theme": "business",
            "rootTopic": {
                "title": "Deployment",
                "children": [
                    {
                        "title": "Analysis",
                        "durationDays": 3,
                        "progress": 0,
                        "priority": 1
                    },
                    {
                        "title": "Development",
                        "durationDays": 5,
                        "progress": 0,
                        "dependencies": [{"targetTitle": "Analysis", "type": "FS"}]
                    }
                ]
            }
        }]
    }
}
```

### Create Multi-Sheet with Internal Links
```json
{
    "name": "create_xmind",
    "arguments": {
        "path": "/path/to/output.xmind",
        "sheets": [
            {
                "title": "Overview",
                "rootTopic": {
                    "title": "Project",
                    "linkToTopic": "Details Root",
                    "children": [{"title": "Phase 1"}, {"title": "Phase 2"}]
                }
            },
            {
                "title": "Details",
                "rootTopic": {
                    "title": "Details Root",
                    "linkToTopic": "Project",
                    "notes": {"plain": "Detailed view", "html": "<p><strong>Detailed</strong> view</p>"}
                }
            }
        ]
    }
}
```

## Configuration

### Claude Desktop

Add the following to your `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

#### Using npx (recommended)

```json
{
  "mcpServers": {
    "xmind": {
      "command": "npx",
      "args": [
        "-y",
        "@41px/mcp-xmind",
        "/path/to/your/xmind/files"
      ]
    }
  }
}
```

#### Using a local build

```json
{
  "mcpServers": {
    "xmind": {
      "command": "node",
      "args": [
        "/path/to/mcp-xmind/dist/index.js",
        "/path/to/your/xmind/files"
      ]
    }
  }
}
```

Restart Claude Desktop after editing the configuration.

### Claude Code (CLI)

```bash
claude mcp add xmind -- npx -y @41px/mcp-xmind /path/to/your/xmind/files
```

## Development

### Building
```bash
npm run build
```

### Testing
```bash
npm test
```

### MCP Inspector
```bash
npx @modelcontextprotocol/inspector node dist/index.js /path/to/xmind/files
```
