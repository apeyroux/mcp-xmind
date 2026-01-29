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

    describe('create_xmind tool', () => {
        it('should create a simple XMind file and read it back', async () => {
            const outputPath = path.join(testDirPath, 'created-simple.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'My Sheet',
                        rootTopic: {
                            title: 'Central Topic',
                            children: [
                                { title: 'Branch A', notes: 'Note on A' },
                                { title: 'Branch B', labels: ['urgent'] },
                            ],
                        },
                    }],
                },
            });

            const text = getResultText(result);
            expect(text).toContain('created');

            // Read back with read_xmind
            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            expect(data[0].title).toBe('Central Topic');
            expect(data[0].children).toHaveLength(2);
            expect(data[0].children![0].title).toBe('Branch A');
            expect(data[0].children![0].notes?.content).toBe('Note on A');
            expect(data[0].children![1].labels).toEqual(['urgent']);
        });

        it('should create multi-sheet file with relationships', async () => {
            const outputPath = path.join(testDirPath, 'created-multi.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [
                        {
                            title: 'Sheet 1',
                            rootTopic: {
                                title: 'Root 1',
                                children: [
                                    { title: 'Topic A' },
                                    { title: 'Topic B' },
                                ],
                            },
                            relationships: [
                                { sourceTitle: 'Topic A', targetTitle: 'Topic B', title: 'depends on' },
                            ],
                        },
                        {
                            title: 'Sheet 2',
                            rootTopic: {
                                title: 'Root 2',
                                children: [
                                    { title: 'Topic C', taskStatus: 'todo' },
                                ],
                            },
                        },
                    ],
                },
            });

            const text = getResultText(result);
            expect(text).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            expect(data).toHaveLength(2);
            expect(data[0].relationships).toHaveLength(1);
            expect(data[0].relationships![0].title).toBe('depends on');
            expect(data[1].children![0].taskStatus).toBe('todo');
        });

        it('should reject path outside allowed directories', async () => {
            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: '/tmp/not-allowed/test.xmind',
                    sheets: [{
                        title: 'Sheet',
                        rootTopic: { title: 'Root' },
                    }],
                },
            });

            const text = getResultText(result);
            expect(text).toContain('Error');
            expect(text).toContain('Access denied');
        });

        it('should reject overwrite when overwrite is false', async () => {
            const outputPath = path.join(testDirPath, 'created-simple.xmind');

            // File was already created by a previous test
            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Sheet',
                        rootTopic: { title: 'Root' },
                    }],
                },
            });

            const text = getResultText(result);
            expect(text).toContain('already exists');
        });

        it('should allow overwrite when overwrite is true', async () => {
            const outputPath = path.join(testDirPath, 'created-simple.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Overwritten',
                        rootTopic: { title: 'New Root' },
                    }],
                    overwrite: true,
                },
            });

            const text = getResultText(result);
            expect(text).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });
            const data = parseResultJson<XMindNode[]>(readResult);
            expect(data[0].title).toBe('New Root');
        });

        it('should reject non-.xmind extension', async () => {
            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: path.join(testDirPath, 'file.txt'),
                    sheets: [{
                        title: 'Sheet',
                        rootTopic: { title: 'Root' },
                    }],
                },
            });

            const text = getResultText(result);
            expect(text).toContain('Error');
            expect(text).toContain('.xmind');
        });

        it('should create XMind file with Gantt properties and read them back', async () => {
            const outputPath = path.join(testDirPath, 'created-gantt.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Project Plan',
                        rootTopic: {
                            title: 'Project',
                            children: [
                                {
                                    title: 'Task with dates',
                                    progress: 0.5,
                                    priority: 1,
                                    startDate: '2026-02-01T00:00:00.000Z',
                                    dueDate: '2026-02-15T00:00:00.000Z',
                                    markers: ['task-start'],
                                },
                                {
                                    title: 'Simple todo',
                                    taskStatus: 'todo',
                                    markers: ['task-start'],
                                },
                                {
                                    title: 'Done task',
                                    taskStatus: 'done',
                                    markers: ['task-done'],
                                },
                            ],
                        },
                    }],
                },
            });

            const text = getResultText(result);
            expect(text).toContain('created');

            // Read back and verify Gantt data
            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            const ganttTask = data[0].children!.find(c => c.title === 'Task with dates')!;
            expect(ganttTask.progress).toBe(0.5);
            expect(ganttTask.priority).toBe(1);
            expect(ganttTask.startDate).toBe('2026-02-01T00:00:00.000Z');
            expect(ganttTask.dueDate).toBe('2026-02-15T00:00:00.000Z');
            expect(ganttTask.markers).toContain('task-start');

            const todoTask = data[0].children!.find(c => c.title === 'Simple todo')!;
            expect(todoTask.taskStatus).toBe('todo');
            expect(todoTask.markers).toContain('task-start');

            const doneTask = data[0].children!.find(c => c.title === 'Done task')!;
            expect(doneTask.taskStatus).toBe('done');
            expect(doneTask.markers).toContain('task-done');
        });
        it('should create XMind file with callouts and read them back', async () => {
            const outputPath = path.join(testDirPath, 'created-callouts.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Sheet',
                        rootTopic: {
                            title: 'Root',
                            children: [
                                {
                                    title: 'Topic with callout',
                                    callouts: ['Attention!', 'Note importante'],
                                },
                            ],
                        },
                    }],
                },
            });

            expect(getResultText(result)).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            const topic = data[0].children![0];
            expect(topic.callouts).toHaveLength(2);
            expect(topic.callouts![0].title).toBe('Attention!');
            expect(topic.callouts![1].title).toBe('Note importante');
        });
        it('should create XMind file with boundaries and summaries', async () => {
            const outputPath = path.join(testDirPath, 'created-boundaries.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Sheet',
                        rootTopic: {
                            title: 'Root',
                            children: [
                                { title: 'A' },
                                { title: 'B' },
                                { title: 'C' },
                                { title: 'D' },
                            ],
                            boundaries: [{ range: '(1,3)', title: 'Group BC' }],
                            summaryTopics: [{ range: '(0,2)', title: 'Summary ABC' }],
                        },
                    }],
                },
            });

            expect(getResultText(result)).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            const root = data[0];
            expect(root.boundaries).toHaveLength(1);
            expect(root.boundaries![0].range).toBe('(1,3)');
            expect(root.boundaries![0].title).toBe('Group BC');
            expect(root.summaries).toHaveLength(1);
            expect(root.summaries![0].range).toBe('(0,2)');
            expect(root.summaries![0].topicTitle).toBe('Summary ABC');
        });
        it('should create XMind file with structureClass and theme', async () => {
            const outputPath = path.join(testDirPath, 'created-theme.xmind');

            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Themed Sheet',
                        theme: 'business',
                        rootTopic: {
                            title: 'Central',
                            structureClass: 'org.xmind.ui.map.clockwise',
                            children: [
                                { title: 'Branch 1' },
                                { title: 'Branch 2' },
                            ],
                        },
                    }],
                },
            });

            expect(getResultText(result)).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            expect(data[0].structureClass).toBe('org.xmind.ui.map.clockwise');
        });

        it('should round-trip HTML formatted notes', async () => {
            const outputPath = path.join(testDirPath, 'html-notes.xmind');
            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [{
                        title: 'Notes Test',
                        rootTopic: {
                            title: 'Root',
                            notes: { plain: 'Plain version', html: '<p><strong>Bold</strong> and <u>underline</u></p>' },
                            children: [
                                { title: 'Simple Note', notes: 'Just plain text' },
                            ],
                        },
                    }],
                },
            });

            expect(getResultText(result)).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            expect(data[0].notes?.content).toBe('Plain version');
            expect(data[0].notes?.html).toContain('<strong>Bold</strong>');
            // Simple string notes should only have plain content
            expect(data[0].children?.[0].notes?.content).toBe('Just plain text');
            expect(data[0].children?.[0].notes?.html).toBeUndefined();
        });

        it('should resolve linkToTopic across sheets', async () => {
            const outputPath = path.join(testDirPath, 'cross-link.xmind');
            const result = await client.callTool({
                name: 'create_xmind',
                arguments: {
                    path: outputPath,
                    sheets: [
                        {
                            title: 'Sheet 1',
                            rootTopic: {
                                title: 'Root A',
                                linkToTopic: 'Root B',
                            },
                        },
                        {
                            title: 'Sheet 2',
                            rootTopic: {
                                title: 'Root B',
                                linkToTopic: 'Root A',
                            },
                        },
                    ],
                },
            });

            expect(getResultText(result)).toContain('created');

            const readResult = await client.callTool({
                name: 'read_xmind',
                arguments: { path: outputPath },
            });

            const data = parseResultJson<XMindNode[]>(readResult);
            // Root A should link to Root B's ID
            expect(data[0].href).toMatch(/^xmind:#/);
            // Root B should link to Root A's ID
            expect(data[1].href).toMatch(/^xmind:#/);
            // Cross-check: Root A's href contains Root B's id
            expect(data[0].href).toBe(`xmind:#${data[1].id}`);
            expect(data[1].href).toBe(`xmind:#${data[0].id}`);
        });
    });
});
