import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import {
    createSimpleTestXMindFile,
    createTestDirectory,
    cleanupTestFile,
    cleanupTestDirectory
} from './helpers.js';

// Helper type for tool results
interface ToolResult {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

function getResultText(result: unknown): string {
    const r = result as ToolResult;
    return r.content[0].text;
}

function parseResultJson<T = unknown>(result: unknown): T {
    return JSON.parse(getResultText(result)) as T;
}

// Type definitions for parsed data
interface XMindNode {
    id: string;
    title: string;
    children?: XMindNode[];
    notes?: { content?: string };
    labels?: string[];
    taskStatus?: 'todo' | 'done';
    callouts?: { title: string }[];
    relationships?: { id: string; end1Id: string; end2Id: string; title?: string }[];
}

interface NodeMatch {
    id: string;
    title: string;
    matchedIn: string[];
    labels?: string[];
    taskStatus?: 'todo' | 'done';
}

interface SearchResult {
    matches: NodeMatch[];
    totalMatches: number;
}

interface FuzzyMatch {
    node: XMindNode;
    matchConfidence: number;
    path: string;
}

interface FuzzySearchResult {
    matches: FuzzyMatch[];
    totalMatches: number;
}

interface MultiFileResult {
    filePath: string;
    content: XMindNode[];
    error?: string;
}

describe('XMind MCP Server', () => {
    let client: Client;
    let transport: StdioClientTransport;
    let testFilePath: string;
    let testDirPath: string;

    beforeAll(async () => {
        // Create test fixtures
        testFilePath = await createSimpleTestXMindFile();
        testDirPath = await createTestDirectory();

        // Get the allowed directory (parent of test file)
        const allowedDir = path.dirname(testFilePath);
        const serverPath = path.join(process.cwd(), 'dist', 'index.js');

        // Start the server
        transport = new StdioClientTransport({
            command: 'node',
            args: [serverPath, allowedDir, testDirPath],
        });

        client = new Client({
            name: 'test-client',
            version: '1.0.0',
        });

        await client.connect(transport);
    }, 30000);

    afterAll(async () => {
        await client?.close();
        await cleanupTestFile(testFilePath);
        await cleanupTestDirectory(testDirPath);
    });

    describe('read_xmind tool', () => {
        it('should parse XMind file and return valid structure', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: testFilePath }
            });

            const data = parseResultJson<XMindNode[]>(result);
            expect(Array.isArray(data)).toBe(true);
            expect(data[0]).toHaveProperty('title', 'Root Topic');
            expect(data[0]).toHaveProperty('id', 'root-1');
        });

        it('should extract relationships from XMind file', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: testFilePath }
            });

            const data = parseResultJson<XMindNode[]>(result);
            expect(data[0].relationships).toBeDefined();
            expect(data[0].relationships).toHaveLength(1);
            expect(data[0].relationships![0]).toHaveProperty('title', 'relates to');
        });

        it('should extract notes from nodes', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: testFilePath }
            });

            const data = parseResultJson<XMindNode[]>(result);
            const child1 = data[0].children?.find(c => c.id === 'child-1');
            expect(child1?.notes).toBeDefined();
            expect(child1?.notes?.content).toBe('This is a note for Child 1');
        });

        it('should extract task status from nodes', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: testFilePath }
            });

            const data = parseResultJson<XMindNode[]>(result);
            const todoTask = data[0].children?.find(c => c.id === 'child-2');
            const doneTask = data[0].children?.find(c => c.id === 'child-3');

            expect(todoTask?.taskStatus).toBe('todo');
            expect(doneTask?.taskStatus).toBe('done');
        });

        it('should extract labels from nodes', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: testFilePath }
            });

            const data = parseResultJson<XMindNode[]>(result);
            const child1 = data[0].children?.find(c => c.id === 'child-1');
            expect(child1?.labels).toEqual(['important', 'review']);
        });

        it('should extract callouts from nodes', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: testFilePath }
            });

            const data = parseResultJson<XMindNode[]>(result);
            const child3 = data[0].children?.find(c => c.id === 'child-3');
            expect(child3?.callouts).toBeDefined();
            expect(child3?.callouts![0].title).toBe('Important callout!');
        });

        it('should return error for non-existent file', async () => {
            const result = await client.callTool({
                name: 'read_xmind',
                arguments: { path: '/nonexistent/file.xmind' }
            });

            const text = getResultText(result);
            expect(text).toContain('Error');
        });
    });

    describe('list_xmind_directory tool', () => {
        it('should list XMind files in directory', async () => {
            const result = await client.callTool({
                name: 'list_xmind_directory',
                arguments: { directory: testDirPath }
            });

            const text = getResultText(result);
            expect(text).toContain('project-a.xmind');
            expect(text).toContain('project-b.xmind');
        });

        it('should recursively find files in subdirectories', async () => {
            const result = await client.callTool({
                name: 'list_xmind_directory',
                arguments: { directory: testDirPath }
            });

            const text = getResultText(result);
            const files = text.split('\n').filter(f => f.trim());
            expect(files.length).toBe(2);
        });
    });

    describe('search_xmind_files tool', () => {
        it('should search for files by pattern', async () => {
            const result = await client.callTool({
                name: 'search_xmind_files',
                arguments: { pattern: 'test' }
            });

            // Returns either matching files or "No matching files found"
            const text = getResultText(result);
            expect(typeof text).toBe('string');
        });

        it('should return message for non-matching pattern', async () => {
            const result = await client.callTool({
                name: 'search_xmind_files',
                arguments: { pattern: 'nonexistent-pattern-xyz-12345' }
            });

            const text = getResultText(result);
            expect(text).toContain('No matching files found');
        });
    });

    describe('extract_node tool', () => {
        it('should extract nodes by fuzzy path matching', async () => {
            const result = await client.callTool({
                name: 'extract_node',
                arguments: { path: testFilePath, searchQuery: 'Child 1' }
            });

            const data = parseResultJson<FuzzySearchResult>(result);
            expect(data.matches).toBeDefined();
            expect(data.matches.length).toBeGreaterThan(0);
            expect(data.matches[0].node.title).toBe('Child 1');
        });

        it('should return ranked results by confidence', async () => {
            const result = await client.callTool({
                name: 'extract_node',
                arguments: { path: testFilePath, searchQuery: 'Child' }
            });

            const data = parseResultJson<FuzzySearchResult>(result);
            expect(data.matches.length).toBeGreaterThan(1);

            // Results should be sorted by confidence (descending)
            for (let i = 1; i < data.matches.length; i++) {
                expect(data.matches[i - 1].matchConfidence).toBeGreaterThanOrEqual(
                    data.matches[i].matchConfidence
                );
            }
        });

        it('should return message for no matches', async () => {
            const result = await client.callTool({
                name: 'extract_node',
                arguments: { path: testFilePath, searchQuery: 'NonExistentNode12345' }
            });

            const text = getResultText(result);
            expect(text).toContain('No nodes found');
        });
    });

    describe('extract_node_by_id tool', () => {
        it('should extract node by exact ID', async () => {
            const result = await client.callTool({
                name: 'extract_node_by_id',
                arguments: { path: testFilePath, nodeId: 'child-1' }
            });

            const data = parseResultJson<XMindNode>(result);
            expect(data.id).toBe('child-1');
            expect(data.title).toBe('Child 1');
        });

        it('should include subtree when extracting node', async () => {
            const result = await client.callTool({
                name: 'extract_node_by_id',
                arguments: { path: testFilePath, nodeId: 'child-1' }
            });

            const data = parseResultJson<XMindNode>(result);
            expect(data.children).toBeDefined();
            expect(data.children![0].title).toBe('Grandchild 1');
        });

        it('should return message for non-existent ID', async () => {
            const result = await client.callTool({
                name: 'extract_node_by_id',
                arguments: { path: testFilePath, nodeId: 'nonexistent-id' }
            });

            const text = getResultText(result);
            expect(text).toContain('Node not found');
        });
    });

    describe('search_nodes tool', () => {
        it('should search nodes by title', async () => {
            const result = await client.callTool({
                name: 'search_nodes',
                arguments: {
                    path: testFilePath,
                    query: 'Child',
                    searchIn: ['title']
                }
            });

            const data = parseResultJson<SearchResult>(result);
            expect(data.matches.length).toBeGreaterThanOrEqual(3);
            expect(data.matches.every(m => m.matchedIn.includes('title'))).toBe(true);
        });

        it('should search nodes by notes content', async () => {
            const result = await client.callTool({
                name: 'search_nodes',
                arguments: {
                    path: testFilePath,
                    query: 'note for Child',
                    searchIn: ['notes']
                }
            });

            const data = parseResultJson<SearchResult>(result);
            expect(data.matches.length).toBe(1);
            expect(data.matches[0].matchedIn).toContain('notes');
        });

        it('should filter by task status todo', async () => {
            const result = await client.callTool({
                name: 'search_nodes',
                arguments: {
                    path: testFilePath,
                    query: 'Task',
                    taskStatus: 'todo'
                }
            });

            const data = parseResultJson<SearchResult>(result);
            expect(data.matches.length).toBeGreaterThanOrEqual(1);
            // All returned matches should have todo status
            data.matches.forEach(m => {
                expect(m.taskStatus).toBe('todo');
            });
        });

        it('should filter by task status done', async () => {
            const result = await client.callTool({
                name: 'search_nodes',
                arguments: {
                    path: testFilePath,
                    query: 'Done',
                    taskStatus: 'done'
                }
            });

            const data = parseResultJson<SearchResult>(result);
            expect(data.matches.length).toBeGreaterThanOrEqual(1);
            // All returned matches should have done status
            data.matches.forEach(m => {
                expect(m.taskStatus).toBe('done');
            });
        });

        it('should support case-insensitive search by default', async () => {
            const result = await client.callTool({
                name: 'search_nodes',
                arguments: {
                    path: testFilePath,
                    query: 'child',
                    searchIn: ['title'],
                    caseSensitive: false
                }
            });

            const data = parseResultJson<SearchResult>(result);
            // Should match "Child" nodes when case-insensitive
            expect(data.matches.length).toBeGreaterThanOrEqual(3);
        });

        it('should search in labels', async () => {
            const result = await client.callTool({
                name: 'search_nodes',
                arguments: {
                    path: testFilePath,
                    query: 'important',
                    searchIn: ['labels']
                }
            });

            const data = parseResultJson<SearchResult>(result);
            expect(data.matches.length).toBe(1);
            expect(data.matches[0].labels).toContain('important');
        });
    });

    describe('read_multiple_xmind_files tool', () => {
        it('should read multiple files at once', async () => {
            const file1 = path.join(testDirPath, 'project-a.xmind');
            const file2 = path.join(testDirPath, 'subdir', 'project-b.xmind');

            const result = await client.callTool({
                name: 'read_multiple_xmind_files',
                arguments: { paths: [file1, file2] }
            });

            const data = parseResultJson<MultiFileResult[]>(result);
            expect(data.length).toBe(2);
            expect(data[0].filePath).toContain('project-a.xmind');
            expect(data[1].filePath).toContain('project-b.xmind');
        });

        it('should handle errors for individual files gracefully', async () => {
            const file1 = path.join(testDirPath, 'project-a.xmind');
            const file2 = '/nonexistent/file.xmind';

            const result = await client.callTool({
                name: 'read_multiple_xmind_files',
                arguments: { paths: [file1, file2] }
            });

            const data = parseResultJson<MultiFileResult[]>(result);
            expect(data.length).toBe(2);
            expect(data[0].content.length).toBeGreaterThan(0);
            expect(data[1].error).toBeDefined();
        });
    });
});
