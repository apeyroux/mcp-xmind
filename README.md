# MCP XMind Server
[![smithery badge](https://smithery.ai/badge/@41px/mcp-xmind)](https://smithery.ai/server/@41px/mcp-xmind)

A Model Context Protocol server for analyzing and querying XMind mind maps. This tool provides powerful capabilities for searching, extracting, and analyzing content from XMind files.

## Features

- 🔍 Smart fuzzy search across mind maps
- 📝 Task management and tracking
- 🌲 Hierarchical content navigation
- 🔗 Link and reference extraction
- 📊 Multi-file analysis
- 🏷️ Label and tag support
- 📂 Directory scanning
- 🔒 Secure directory access

## Installation

### Installing via Smithery

To install XMind Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@41px/mcp-xmind):

```bash
npx -y @smithery/cli install @41px/mcp-xmind --client claude
```

### Manual Installation
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

1. **read_xmind**
   - Parse and analyze XMind files
   - Extract complete mind map structure

2. **get_todo_tasks**
   - Extract and analyze TODO tasks
   - Include task context and hierarchy

3. **list_xmind_directory**
   - Recursively scan for XMind files
   - Filter and organize results

4. **read_multiple_xmind_files**
   - Process multiple files simultaneously
   - Compare and analyze across files

5. **search_xmind_files**
   - Search files by name patterns
   - Recursive directory scanning

6. **extract_node**
   - Smart fuzzy path matching
   - Ranked search results
   - Complete subtree extraction

7. **extract_node_by_id**
   - Direct node access by ID
   - Fast and precise retrieval

8. **search_nodes**
   - Multi-criteria content search
   - Configurable search fields

## Examples

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

### Extract Node
```json
{
    "name": "extract_node",
    "arguments": {
        "path": "/path/to/file.xmind",
        "searchQuery": "Feature > API"
    }
}
```

### List Tasks
```json
{
    "name": "get_todo_tasks",
    "arguments": {
        "path": "/path/to/file.xmind"
    }
}
```



## Running evals

The evals package loads an mcp client that then runs the index.ts file, so there is no need to rebuild between tests. You can load environment variables by prefixing the npx command. Full documentation can be found [here](https://www.mcpevals.io/docs).

```bash
OPENAI_API_KEY=your-key  npx mcp-eval evals.ts index.ts
```
## Configuration

### Development Configuration

Example `claude_desktop_config.json` for development:

```json
{
  "xmind": {
    "command": "node",
    "args": [
      "/Users/alex/Src/mcp-xmind/dist/index.js",
      "/Users/alex/XMind"
    ]
  }
}
```

### Production Configuration

Example `claude_desktop_config.json` for production using npmjs:

```json
{
  "xmind": {
    "command": "npx",
    "args": [
      "-y",
      "@41px/mcp-xmind",
      "/Users/alex/XMind"
    ]
  }
}
```

## Security

- Only allows access to specified directories
- Path normalization and validation
- Error handling for invalid access attempts

## Development

### Building
```bash
npm run build
```

### Type Checking
```bash
npm run type-check
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js /Users/alex/XMind
```
