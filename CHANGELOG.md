# Changelog

## [2.0.0] - 2025-01-18

### Breaking Changes
- Upgraded to MCP SDK v1.11.0 (from v0.5.0)
- Migrated from deprecated `Server` class to new `McpServer` API
- Removed `zod-to-json-schema` and `diff` dependencies (no longer needed)

### Added
- Output schemas (Zod) for structured tool responses
- Explicit type annotations for all async functions
- Better schema descriptions for tool parameters

### Changed
- Refactored all tool registrations to use `server.tool()` method
- Improved error handling with consistent error response format
- Simplified notes handling (removed duplicate condition)
- Updated `parseContentJson` to use native throw instead of Promise.reject
- Upgraded Zod to v3.25.0 for SDK compatibility

### Fixed
- Fixed duplicate condition check in notes processing
- Added missing return type `Promise<void>` to `scanDirectory` and `searchInDirectory` functions
- Fixed `runServer` return type annotation

## [1.1.1] - 2024-01-20

### Added
- Support for node relationships
- Enhanced search with task status filtering
- Improved callouts support

### Changed
- Removed get_todo_tasks in favor of search_nodes with status filter
- Optimized file searching
- Improved tool descriptions

### Fixed
- Fixed relationship parsing in content.json
- Better file path handling

## [1.0.0] - 2024-01-19

### Added
- Initial release
- Basic XMind file support
- Node and task extraction
- File searching capabilities
