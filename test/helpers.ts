import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface TestXMindContent {
    id: string;
    title: string;
    rootTopic: {
        id: string;
        title: string;
        children?: {
            attached?: Array<{
                id: string;
                title: string;
                notes?: {
                    plain?: {
                        content: string;
                    };
                };
                labels?: string[];
                extensions?: Array<{
                    provider: string;
                    content: {
                        status: 'done' | 'todo';
                    };
                }>;
                children?: {
                    attached?: Array<{
                        id: string;
                        title: string;
                    }>;
                    callout?: Array<{
                        id: string;
                        title: string;
                    }>;
                };
            }>;
            callout?: Array<{
                id: string;
                title: string;
            }>;
        };
        href?: string;
    };
    relationships?: Array<{
        id: string;
        end1Id: string;
        end2Id: string;
        title?: string;
    }>;
}

/**
 * Creates a temporary XMind file for testing
 */
export async function createTestXMindFile(
    content: TestXMindContent[],
    filename: string = 'test.xmind'
): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-test-'));
    const filePath = path.join(tempDir, filename);

    const zip = new AdmZip();
    zip.addFile('content.json', Buffer.from(JSON.stringify(content), 'utf-8'));
    zip.writeZip(filePath);

    return filePath;
}

/**
 * Creates a simple test XMind file with predefined content
 */
export async function createSimpleTestXMindFile(): Promise<string> {
    const content: TestXMindContent[] = [
        {
            id: 'sheet-1',
            title: 'Test Mind Map',
            rootTopic: {
                id: 'root-1',
                title: 'Root Topic',
                children: {
                    attached: [
                        {
                            id: 'child-1',
                            title: 'Child 1',
                            notes: {
                                plain: {
                                    content: 'This is a note for Child 1'
                                }
                            },
                            labels: ['important', 'review'],
                            children: {
                                attached: [
                                    {
                                        id: 'grandchild-1',
                                        title: 'Grandchild 1'
                                    }
                                ]
                            }
                        },
                        {
                            id: 'child-2',
                            title: 'Child 2 - Task',
                            extensions: [
                                {
                                    provider: 'org.xmind.ui.task',
                                    content: {
                                        status: 'todo'
                                    }
                                }
                            ]
                        },
                        {
                            id: 'child-3',
                            title: 'Child 3 - Done',
                            extensions: [
                                {
                                    provider: 'org.xmind.ui.task',
                                    content: {
                                        status: 'done'
                                    }
                                }
                            ],
                            children: {
                                callout: [
                                    {
                                        id: 'callout-1',
                                        title: 'Important callout!'
                                    }
                                ]
                            }
                        }
                    ]
                },
                href: 'https://example.com'
            },
            relationships: [
                {
                    id: 'rel-1',
                    end1Id: 'child-1',
                    end2Id: 'child-2',
                    title: 'relates to'
                }
            ]
        }
    ];

    return createTestXMindFile(content);
}

/**
 * Cleanup test files
 */
export async function cleanupTestFile(filePath: string): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        await fs.rm(dir, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Creates a test directory with multiple XMind files
 */
export async function createTestDirectory(): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xmind-dir-test-'));

    // Create main test file
    const content1: TestXMindContent[] = [
        {
            id: 'sheet-1',
            title: 'Project A',
            rootTopic: {
                id: 'root-1',
                title: 'Project A Root',
                children: {
                    attached: [
                        { id: 'a-1', title: 'Feature 1' },
                        { id: 'a-2', title: 'Feature 2' }
                    ]
                }
            }
        }
    ];

    const content2: TestXMindContent[] = [
        {
            id: 'sheet-2',
            title: 'Project B',
            rootTopic: {
                id: 'root-2',
                title: 'Project B Root',
                children: {
                    attached: [
                        { id: 'b-1', title: 'Task 1' },
                        { id: 'b-2', title: 'Task 2' }
                    ]
                }
            }
        }
    ];

    // Create subdirectory
    const subDir = path.join(tempDir, 'subdir');
    await fs.mkdir(subDir, { recursive: true });

    // Create XMind files
    const zip1 = new AdmZip();
    zip1.addFile('content.json', Buffer.from(JSON.stringify(content1), 'utf-8'));
    zip1.writeZip(path.join(tempDir, 'project-a.xmind'));

    const zip2 = new AdmZip();
    zip2.addFile('content.json', Buffer.from(JSON.stringify(content2), 'utf-8'));
    zip2.writeZip(path.join(subDir, 'project-b.xmind'));

    return tempDir;
}

export async function cleanupTestDirectory(dirPath: string): Promise<void> {
    try {
        await fs.rm(dirPath, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors
    }
}
