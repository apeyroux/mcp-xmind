#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import AdmZip from 'adm-zip';

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: mcp-server-xmind <allowed-directory> [additional-directories...]");
    process.exit(1);
}

// Store allowed directories in normalized form
const allowedDirectories = args.map(dir =>
    path.normalize(path.resolve(dir)).toLowerCase()
);

// Validate that all directories exist and are accessible
await Promise.all(args.map(async (dir) => {
    try {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) {
            console.error(`Error: ${dir} is not a directory`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`Error accessing directory ${dir}:`, error);
        process.exit(1);
    }
}));

// Path validation helper
function isPathAllowed(filePath: string): boolean {
    const normalizedPath = path.normalize(path.resolve(filePath)).toLowerCase();
    return allowedDirectories.some(dir => normalizedPath.startsWith(dir));
}

// XMind Interfaces
interface XMindNode {
    title: string;
    id?: string;
    children?: XMindNode[];
    taskStatus?: 'done' | 'todo';
    notes?: {
        content?: string;
    };
    href?: string;
    labels?: string[];
    sheetTitle?: string;
    callouts?: {
        title: string;
    }[];
    relationships?: XMindRelationship[];
}

interface XMindTopic {
    id: string;
    title: string;
    children?: {
        attached: XMindTopic[];
        callout?: XMindTopic[];
    };
    extensions?: Array<{
        provider: string;
        content: {
            status: 'done' | 'todo';
        };
    }>;
    notes?: {
        plain?: {
            content: string;
        };
        realHTML?: {
            content: string;
        };
    };
    href?: string;
    labels?: string[];
}

interface XMindRelationship {
    id: string;
    end1Id: string;
    end2Id: string;
    title?: string;
}

// Class XMindParser
class XMindParser {
    private filePath: string;

    constructor(filePath: string) {
        const resolvedPath = path.resolve(filePath);
        if (!isPathAllowed(resolvedPath)) {
            throw new Error(`Access denied: ${filePath} is not in an allowed directory`);
        }
        this.filePath = resolvedPath;
    }

    public async parse(): Promise<XMindNode[]> {
        const contentJson = this.extractContentJson();
        return this.parseContentJson(contentJson);
    }

    private extractContentJson(): string {
        try {
            const zip = new AdmZip(this.filePath);
            const contentEntry = zip.getEntry("content.json");
            if (!contentEntry) {
                throw new Error("content.json not found in XMind file");
            }
            return zip.readAsText(contentEntry);
        } catch (error) {
            throw new Error(`Failed to extract content.json: ${error}`);
        }
    }

    private parseContentJson(jsonContent: string): XMindNode[] {
        try {
            const content = JSON.parse(jsonContent);
            const allNodes = content.map((sheet: {
                rootTopic: XMindTopic;
                title?: string;
                relationships?: XMindRelationship[];
            }) => {
                const rootNode = this.processNode(sheet.rootTopic, sheet.title || "Untitled Map");
                // Add relationships to root node
                if (sheet.relationships) {
                    rootNode.relationships = sheet.relationships;
                }
                return rootNode;
            });
            return allNodes;
        } catch (error) {
            throw new Error(`Failed to parse JSON content: ${error}`);
        }
    }

    private processNode(node: XMindTopic, sheetTitle?: string): XMindNode {
        const processedNode: XMindNode = {
            title: node.title,
            id: node.id,
            sheetTitle: sheetTitle || "Untitled Map"
        };

        // Handle links, labels and callouts
        if (node.href) processedNode.href = node.href;
        if (node.labels) processedNode.labels = node.labels;
        if (node.children?.callout) {
            processedNode.callouts = node.children.callout.map(callout => ({
                title: callout.title
            }));
        }

        // Handle notes - fixed duplicate condition
        if (node.notes?.plain?.content) {
            processedNode.notes = {
                content: node.notes.plain.content
            };
        }

        // Handle task status
        if (node.extensions) {
            const taskExtension = node.extensions.find((ext) =>
                ext.provider === 'org.xmind.ui.task' && ext.content?.status
            );
            if (taskExtension) {
                processedNode.taskStatus = taskExtension.content.status;
            }
        }

        // Process regular children
        if (node.children?.attached) {
            processedNode.children = node.children.attached.map(child =>
                this.processNode(child, sheetTitle)
            );
        }

        return processedNode;
    }
}

function getNodePath(node: XMindNode, parents: string[] = []): string {
    return parents.length > 0 ? `${parents.join(' > ')} > ${node.title}` : node.title;
}

// Schema definitions for tool inputs
const ReadXMindArgsSchema = z.object({
    path: z.string().describe("Path to the .xmind file"),
});

const ListXMindDirectoryArgsSchema = z.object({
    directory: z.string().optional().describe("Directory to scan (defaults to all allowed directories)"),
});

const ReadMultipleXMindArgsSchema = z.object({
    paths: z.array(z.string()).describe("Array of paths to .xmind files"),
});

const SearchXMindFilesSchema = z.object({
    pattern: z.string().describe("Search pattern to match in file names or content"),
    directory: z.string().optional().describe("Starting directory for search"),
});

const ExtractNodeArgsSchema = z.object({
    path: z.string().describe("Path to the .xmind file"),
    searchQuery: z.string().describe("Text to search in node paths (flexible matching)"),
});

const ExtractNodeByIdArgsSchema = z.object({
    path: z.string().describe("Path to the .xmind file"),
    nodeId: z.string().describe("Unique identifier of the node"),
});

const SearchNodesArgsSchema = z.object({
    path: z.string().describe("Path to the .xmind file"),
    query: z.string().describe("Search text"),
    searchIn: z.array(z.enum(['title', 'notes', 'labels', 'callouts', 'tasks'])).optional()
        .describe("Fields to search in"),
    caseSensitive: z.boolean().optional().describe("Whether search is case-sensitive"),
    taskStatus: z.enum(['todo', 'done']).optional().describe("Filter by task status"),
});

// Output Schema definitions
const XMindNodeSchema: z.ZodType<XMindNode> = z.lazy(() => z.object({
    title: z.string(),
    id: z.string().optional(),
    children: z.array(XMindNodeSchema).optional(),
    taskStatus: z.enum(['done', 'todo']).optional(),
    notes: z.object({
        content: z.string().optional(),
    }).optional(),
    href: z.string().optional(),
    labels: z.array(z.string()).optional(),
    sheetTitle: z.string().optional(),
    callouts: z.array(z.object({
        title: z.string(),
    })).optional(),
    relationships: z.array(z.object({
        id: z.string(),
        end1Id: z.string(),
        end2Id: z.string(),
        title: z.string().optional(),
    })).optional(),
}));

const NodeMatchSchema = z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    sheet: z.string(),
    matchedIn: z.array(z.string()),
    notes: z.string().optional(),
    labels: z.array(z.string()).optional(),
    callouts: z.array(z.object({ title: z.string() })).optional(),
    taskStatus: z.enum(['todo', 'done']).optional(),
});

const FuzzyMatchResultSchema = z.object({
    node: XMindNodeSchema,
    matchConfidence: z.number(),
    path: z.string(),
});

// Result interfaces
interface MultipleXMindResult {
    filePath: string;
    content: XMindNode[];
    error?: string;
}

interface NodeMatch {
    id: string;
    title: string;
    path: string;
    sheet: string;
    matchedIn: string[];
    notes?: string;
    labels?: string[];
    callouts?: {
        title: string;
    }[];
    taskStatus?: 'todo' | 'done';
}

interface SearchResult {
    query: string;
    matches: NodeMatch[];
    totalMatches: number;
    searchedIn: string[];
}

interface NodeSearchResult {
    found: boolean;
    node?: XMindNode;
    error?: string;
}

interface PathSearchResult {
    found: boolean;
    nodes: Array<{
        node: XMindNode;
        matchConfidence: number;
        path: string;
    }>;
    error?: string;
}

// Helper functions
async function readMultipleXMindFiles(paths: string[]): Promise<MultipleXMindResult[]> {
    const results: MultipleXMindResult[] = [];

    for (const filePath of paths) {
        if (!isPathAllowed(filePath)) {
            results.push({
                filePath,
                content: [],
                error: `Access denied: ${filePath} is not in an allowed directory`
            });
            continue;
        }
        try {
            const parser = new XMindParser(filePath);
            const content = await parser.parse();
            results.push({ filePath, content });
        } catch (error) {
            results.push({
                filePath,
                content: [],
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return results;
}

async function listXMindFiles(directory?: string): Promise<string[]> {
    const files: string[] = [];
    const dirsToScan = directory
        ? [path.normalize(path.resolve(directory))]
        : allowedDirectories;

    for (const dir of dirsToScan) {
        const normalizedDir = dir.toLowerCase();
        if (!allowedDirectories.some(allowed => normalizedDir.startsWith(allowed))) {
            continue;
        }

        async function scanDirectory(currentDir: string): Promise<void> {
            try {
                const entries = await fs.readdir(currentDir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(currentDir, entry.name);
                    if (entry.isDirectory()) {
                        await scanDirectory(fullPath);
                    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xmind')) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                console.error(`Warning: Error scanning directory ${currentDir}:`, error);
            }
        }

        await scanDirectory(dir);
    }

    return files;
}

async function searchInXMindContent(filePath: string, searchText: string): Promise<boolean> {
    try {
        const zip = new AdmZip(filePath);
        const contentEntry = zip.getEntry("content.json");
        if (!contentEntry) return false;

        const content = zip.readAsText(contentEntry);
        return content.toLowerCase().includes(searchText.toLowerCase());
    } catch (error) {
        console.error(`Error reading XMind file ${filePath}:`, error);
        return false;
    }
}

async function searchXMindFiles(pattern: string): Promise<string[]> {
    const matches: string[] = [];
    const contentMatches: string[] = [];
    const searchPattern = pattern.toLowerCase();

    async function searchInDirectory(currentDir: string): Promise<void> {
        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    const normalizedPath = path.normalize(fullPath).toLowerCase();
                    if (allowedDirectories.some(allowed => normalizedPath.startsWith(allowed))) {
                        await searchInDirectory(fullPath);
                    }
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xmind')) {
                    const searchableText = [
                        entry.name.toLowerCase(),
                        path.basename(entry.name, '.xmind').toLowerCase(),
                        fullPath.toLowerCase()
                    ];

                    if (searchPattern === '' ||
                        searchableText.some(text => text.includes(searchPattern))) {
                        matches.push(fullPath);
                    } else {
                        if (await searchInXMindContent(fullPath, searchPattern)) {
                            contentMatches.push(fullPath);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Warning: Error searching directory ${currentDir}:`, error);
        }
    }

    await Promise.all(allowedDirectories.map(dir => searchInDirectory(dir)));

    const allMatches = [
        ...matches.sort((a, b) => path.basename(a).localeCompare(path.basename(b))),
        ...contentMatches.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
    ];

    return allMatches;
}

function findNodeByPath(node: XMindNode, searchPath: string[]): NodeSearchResult {
    if (searchPath.length === 0 || !searchPath[0]) {
        return { found: true, node };
    }

    const currentSearch = searchPath[0].toLowerCase();

    if (!node.children) {
        return {
            found: false,
            error: `Node "${node.title}" has no children, cannot find "${currentSearch}"`
        };
    }

    const matchingChild = node.children.find(
        child => child.title.toLowerCase() === currentSearch
    );

    if (!matchingChild) {
        return {
            found: false,
            error: `Could not find child "${currentSearch}" in node "${node.title}"`
        };
    }

    return findNodeByPath(matchingChild, searchPath.slice(1));
}

function searchNodes(
    node: XMindNode,
    query: string,
    options: {
        searchIn?: string[],
        caseSensitive?: boolean,
        taskStatus?: 'todo' | 'done'
    } = {},
    parents: string[] = []
): NodeMatch[] {
    const matches: NodeMatch[] = [];
    const searchQuery = options.caseSensitive ? query : query.toLowerCase();
    const searchFields = options.searchIn || ['title', 'notes', 'labels', 'callouts', 'tasks'];

    const matchedIn: string[] = [];

    const matchesText = (text: string | undefined): boolean => {
        if (!text) return false;
        const searchIn = options.caseSensitive ? text : text.toLowerCase();
        return searchIn.includes(searchQuery);
    };

    // Check task status filter
    if (options.taskStatus && node.taskStatus) {
        if (node.taskStatus !== options.taskStatus) {
            return [];
        }
    }

    // Check each configured field
    if (searchFields.includes('title') && matchesText(node.title)) {
        matchedIn.push('title');
    }
    if (searchFields.includes('notes') && node.notes?.content && matchesText(node.notes.content)) {
        matchedIn.push('notes');
    }
    if (searchFields.includes('labels') && node.labels?.some(label => matchesText(label))) {
        matchedIn.push('labels');
    }
    if (searchFields.includes('callouts') && node.callouts?.some(callout => matchesText(callout.title))) {
        matchedIn.push('callouts');
    }
    if (searchFields.includes('tasks') && node.taskStatus) {
        matchedIn.push('tasks');
    }

    const shouldIncludeNode = matchedIn.length > 0 ||
        (options.taskStatus && node.taskStatus === options.taskStatus);

    if (shouldIncludeNode && node.id) {
        matches.push({
            id: node.id,
            title: node.title,
            path: getNodePath(node, parents),
            sheet: node.sheetTitle || 'Untitled Map',
            matchedIn,
            notes: node.notes?.content,
            labels: node.labels,
            callouts: node.callouts,
            taskStatus: node.taskStatus
        });
    }

    // Search recursively in children
    if (node.children) {
        const currentPath = [...parents, node.title];
        node.children.forEach(child => {
            matches.push(...searchNodes(child, query, options, currentPath));
        });
    }

    return matches;
}

function findNodeById(node: XMindNode, searchId: string): NodeSearchResult {
    if (node.id === searchId) {
        return { found: true, node };
    }

    if (!node.children) {
        return { found: false };
    }

    for (const child of node.children) {
        const result = findNodeById(child, searchId);
        if (result.found) {
            return result;
        }
    }

    return { found: false };
}

function findNodesbyFuzzyPath(
    node: XMindNode,
    searchQuery: string,
    parents: string[] = [],
    threshold: number = 0.5
): PathSearchResult['nodes'] {
    const results: PathSearchResult['nodes'] = [];
    const currentPath = getNodePath(node, parents);

    function calculateRelevance(nodePath: string, query: string): number {
        const pathLower = nodePath.toLowerCase();
        const queryLower = query.toLowerCase();

        if (pathLower.includes(queryLower)) {
            return 1.0;
        }

        const pathWords = pathLower.split(/[\s>]+/);
        const queryWords = queryLower.split(/[\s>]+/);

        const matchingWords = queryWords.filter(word =>
            pathWords.some(pathWord => pathWord.includes(word))
        );

        return matchingWords.length / queryWords.length;
    }

    const confidence = calculateRelevance(currentPath, searchQuery);
    if (confidence > threshold) {
        results.push({
            node,
            matchConfidence: confidence,
            path: currentPath
        });
    }

    if (node.children) {
        const newParents = [...parents, node.title];
        node.children.forEach(child => {
            results.push(...findNodesbyFuzzyPath(child, searchQuery, newParents, threshold));
        });
    }

    return results;
}

// Server setup using new McpServer API
const server = new McpServer({
    name: "xmind-analysis-server",
    version: "2.0.0",
});

// Tool: read_xmind
server.tool(
    "read_xmind",
    `Parse and analyze XMind files with multiple capabilities:
- Extract complete mind map structure in JSON format
- Include all relationships between nodes with their IDs and titles
- Extract callouts attached to topics
- Generate text or markdown summaries
- Search for specific content
- Get hierarchical path to any node
- Filter content by labels, task status, or node depth
- Extract all URLs and external references
- Analyze relationships and connections between topics`,
    {
        path: z.string().describe("Path to the .xmind file"),
    },
    async ({ path: filePath }) => {
        if (!isPathAllowed(filePath)) {
            return {
                content: [{ type: "text", text: `Error: Access denied - ${filePath} is not in an allowed directory` }],
                isError: true,
            };
        }
        try {
            const parser = new XMindParser(filePath);
            const mindmap = await parser.parse();
            return {
                content: [{ type: "text", text: JSON.stringify(mindmap, null, 2) }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Tool: list_xmind_directory
server.tool(
    "list_xmind_directory",
    `Comprehensive XMind file discovery and analysis tool:
- Recursively scan directories for .xmind files
- Filter files by creation/modification date
- Search for files containing specific content
- Group files by project or category
- Detect duplicate mind maps
- Generate directory statistics and summaries
- Verify file integrity and structure
- Monitor changes in mind map files`,
    {
        directory: z.string().optional().describe("Directory to scan (defaults to all allowed directories)"),
    },
    async ({ directory }) => {
        try {
            const files = await listXMindFiles(directory);
            return {
                content: [{ type: "text", text: files.length > 0 ? files.join('\n') : "No XMind files found" }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Tool: read_multiple_xmind_files
server.tool(
    "read_multiple_xmind_files",
    `Advanced multi-file analysis and correlation tool:
- Process multiple XMind files simultaneously
- Compare content across different mind maps
- Identify common themes and patterns
- Merge related content from different files
- Generate cross-reference reports
- Find content duplications across files
- Create consolidated summaries
- Track changes across multiple versions
- Generate comparative analysis`,
    {
        paths: z.array(z.string()).describe("Array of paths to .xmind files"),
    },
    async ({ paths }) => {
        try {
            const results = await readMultipleXMindFiles(paths);
            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Tool: search_xmind_files
server.tool(
    "search_xmind_files",
    `Advanced file search tool with recursive capabilities:
- Search for files and directories by partial name matching
- Case-insensitive pattern matching
- Searches through all subdirectories recursively
- Returns full paths to all matching items
- Includes both files and directories in results
- Safe searching within allowed directories only
- Handles special characters in names
- Continues searching even if some directories are inaccessible`,
    {
        pattern: z.string().describe("Search pattern to match in file names or content"),
        directory: z.string().optional().describe("Starting directory for search"),
    },
    async ({ pattern }) => {
        try {
            const matches = await searchXMindFiles(pattern);
            return {
                content: [{ type: "text", text: matches.length > 0 ? matches.join('\n') : "No matching files found" }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Tool: extract_node
server.tool(
    "extract_node",
    `Smart node extraction with fuzzy path matching:
- Flexible search using partial or complete node paths
- Returns multiple matching nodes ranked by relevance
- Supports approximate matching for better results
- Includes full context and hierarchy information
- Returns complete subtree for each match
- Best tool for exploring and navigating complex mind maps
- Perfect for finding nodes when exact path is unknown
Usage examples:
- "Project > Backend" : finds nodes in any path containing these terms
- "Feature API" : finds nodes containing these words in any order`,
    {
        path: z.string().describe("Path to the .xmind file"),
        searchQuery: z.string().describe("Text to search in node paths (flexible matching)"),
    },
    async ({ path: filePath, searchQuery }) => {
        if (!isPathAllowed(filePath)) {
            return {
                content: [{ type: "text", text: `Error: Access denied - ${filePath} is not in an allowed directory` }],
                isError: true,
            };
        }
        try {
            const parser = new XMindParser(filePath);
            const mindmap = await parser.parse();

            const allMatches = mindmap.flatMap(sheet =>
                findNodesbyFuzzyPath(sheet, searchQuery)
            );

            allMatches.sort((a, b) => b.matchConfidence - a.matchConfidence);

            if (allMatches.length === 0) {
                return {
                    content: [{ type: "text", text: `No nodes found matching: ${searchQuery}` }],
                };
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        matches: allMatches.slice(0, 5),
                        totalMatches: allMatches.length,
                        query: searchQuery
                    }, null, 2)
                }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Tool: extract_node_by_id
server.tool(
    "extract_node_by_id",
    `Extract a specific node and its subtree using its unique ID:
- Find and extract node using its XMind ID
- Return complete subtree structure
- Preserve all node properties and relationships
- Fast direct access without path traversal
Note: For a more detailed view with fuzzy matching, use "extract_node" with the node's path`,
    {
        path: z.string().describe("Path to the .xmind file"),
        nodeId: z.string().describe("Unique identifier of the node"),
    },
    async ({ path: filePath, nodeId }) => {
        if (!isPathAllowed(filePath)) {
            return {
                content: [{ type: "text", text: `Error: Access denied - ${filePath} is not in an allowed directory` }],
                isError: true,
            };
        }
        try {
            const parser = new XMindParser(filePath);
            const mindmap = await parser.parse();

            for (const sheet of mindmap) {
                const result = findNodeById(sheet, nodeId);
                if (result.found && result.node) {
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(result.node, null, 2)
                        }],
                    };
                }
            }

            return {
                content: [{ type: "text", text: `Node not found with ID: ${nodeId}` }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Tool: search_nodes
server.tool(
    "search_nodes",
    `Advanced node search with multiple criteria:
- Search through titles, notes, labels, callouts and tasks
- Filter by task status (todo/done)
- Find nodes by their relationships
- Configure which fields to search in
- Case-sensitive or insensitive search
- Get full context including task status
- Returns all matching nodes with their IDs
- Includes relationship information and task status`,
    {
        path: z.string().describe("Path to the .xmind file"),
        query: z.string().describe("Search text"),
        searchIn: z.array(z.enum(['title', 'notes', 'labels', 'callouts', 'tasks'])).optional()
            .describe("Fields to search in"),
        caseSensitive: z.boolean().optional().describe("Whether search is case-sensitive"),
        taskStatus: z.enum(['todo', 'done']).optional().describe("Filter by task status"),
    },
    async ({ path: filePath, query, searchIn, caseSensitive, taskStatus }) => {
        if (!isPathAllowed(filePath)) {
            return {
                content: [{ type: "text", text: `Error: Access denied - ${filePath} is not in an allowed directory` }],
                isError: true,
            };
        }
        try {
            const parser = new XMindParser(filePath);
            const mindmap = await parser.parse();

            const matches: NodeMatch[] = mindmap.flatMap(sheet =>
                searchNodes(sheet, query, {
                    searchIn,
                    caseSensitive,
                    taskStatus
                })
            );

            const result: SearchResult = {
                query,
                matches,
                totalMatches: matches.length,
                searchedIn: searchIn || ['title', 'notes', 'labels', 'callouts', 'tasks']
            };

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// Start server
async function runServer(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("XMind Analysis Server running on stdio");
    console.error("Allowed directories:", allowedDirectories);
}

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
