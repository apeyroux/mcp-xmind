#!/usr/bin/env node

// XMind file creator - reads JSON from stdin, writes .xmind file
// Usage: echo '{"path":"/tmp/test.xmind","sheets":[...]}' | node create_xmind.mjs
// Or:   node create_xmind.mjs --path /tmp/test.xmind < data.json
// No external dependencies — uses only Node.js built-ins.

import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, resolve, extname } from 'path';
import { randomUUID, createHash } from 'crypto';
import { deflateRawSync } from 'zlib';

// ─── Minimal ZIP writer (PKZIP APPNOTE 6.3.3) ───

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
    // files: Array<{name: string, data: Buffer}>
    const entries = [];
    const centralHeaders = [];
    let offset = 0;

    for (const { name, data } of files) {
        const nameBytes = Buffer.from(name, 'utf-8');
        const compressed = deflateRawSync(data);
        const crc = crc32(data);

        // Local file header (30 + nameLen + compressedLen)
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);  // signature
        localHeader.writeUInt16LE(20, 4);            // version needed
        localHeader.writeUInt16LE(0, 6);             // flags
        localHeader.writeUInt16LE(8, 8);             // compression: deflate
        localHeader.writeUInt16LE(0, 10);            // mod time
        localHeader.writeUInt16LE(0, 12);            // mod date
        localHeader.writeUInt32LE(crc, 14);          // crc-32
        localHeader.writeUInt32LE(compressed.length, 18);  // compressed size
        localHeader.writeUInt32LE(data.length, 22);        // uncompressed size
        localHeader.writeUInt16LE(nameBytes.length, 26);   // file name length
        localHeader.writeUInt16LE(0, 28);            // extra field length

        const entry = Buffer.concat([localHeader, nameBytes, compressed]);
        entries.push(entry);

        // Central directory header
        const cdHeader = Buffer.alloc(46);
        cdHeader.writeUInt32LE(0x02014b50, 0);   // signature
        cdHeader.writeUInt16LE(20, 4);             // version made by
        cdHeader.writeUInt16LE(20, 6);             // version needed
        cdHeader.writeUInt16LE(0, 8);              // flags
        cdHeader.writeUInt16LE(8, 10);             // compression: deflate
        cdHeader.writeUInt16LE(0, 12);             // mod time
        cdHeader.writeUInt16LE(0, 14);             // mod date
        cdHeader.writeUInt32LE(crc, 16);           // crc-32
        cdHeader.writeUInt32LE(compressed.length, 20);
        cdHeader.writeUInt32LE(data.length, 24);
        cdHeader.writeUInt16LE(nameBytes.length, 28);
        cdHeader.writeUInt16LE(0, 30);             // extra field length
        cdHeader.writeUInt16LE(0, 32);             // comment length
        cdHeader.writeUInt16LE(0, 34);             // disk number
        cdHeader.writeUInt16LE(0, 36);             // internal attrs
        cdHeader.writeUInt32LE(0, 38);             // external attrs
        cdHeader.writeUInt32LE(offset, 42);        // local header offset

        centralHeaders.push(Buffer.concat([cdHeader, nameBytes]));
        offset += entry.length;
    }

    const centralDir = Buffer.concat(centralHeaders);

    // End of central directory record
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);                          // disk number
    eocd.writeUInt16LE(0, 6);                          // disk with CD
    eocd.writeUInt16LE(files.length, 8);               // entries on disk
    eocd.writeUInt16LE(files.length, 10);              // total entries
    eocd.writeUInt32LE(centralDir.length, 12);         // CD size
    eocd.writeUInt32LE(offset, 16);                    // CD offset
    eocd.writeUInt16LE(0, 20);                         // comment length

    return Buffer.concat([...entries, centralDir, eocd]);
}

// ─── XMind builder ───

function generateId() {
    return randomUUID().replace(/-/g, '').substring(0, 26);
}

class XMindBuilder {
    constructor() {
        this.titleToId = new Map();
        this.pendingDependencies = new Map();
        this.pendingLinks = new Map();
        this.attachments = []; // {sourcePath, resourcePath}
    }

    build(sheets) {
        this.titleToId.clear();
        this.pendingDependencies.clear();
        this.pendingLinks.clear();
        this.attachments = [];

        const builtSheets = [];
        for (const sheet of sheets) {
            const rootTopic = this.buildTopic(sheet.rootTopic);
            const detached = sheet.detachedTopics?.map(t => this.buildTopic(t, { detached: true }));
            this.resolveDependencies(rootTopic);
            builtSheets.push({ rootTopic, detached, sheet });
        }

        for (const { rootTopic, detached } of builtSheets) {
            this.resolveLinks(rootTopic);
            if (detached) detached.forEach(t => this.resolveLinks(t));
        }

        const contentJson = builtSheets.map(({ rootTopic, detached, sheet }) => {
            const sheetTheme = {};
            const hasPlanned = this.hasPlannedTasks(sheet.rootTopic);
            if (detached?.length > 0) {
                if (!rootTopic.children) rootTopic.children = {};
                rootTopic.children.detached = detached;
            }
            const sheetId = generateId();
            const sheetObj = {
                id: sheetId,
                class: "sheet",
                title: sheet.title,
                rootTopic,
                topicOverlapping: "overlap",
                theme: sheetTheme,
            };
            if (sheet.freePositioning) {
                sheetObj.topicPositioning = "free";
                sheetObj.floatingTopicFlexible = true;
            }
            if (hasPlanned) {
                sheetObj.extensions = [{
                    provider: "org.xmind.ui.working-day-settings",
                    content: {
                        id: "YmFzaWMtY2FsZW5kYXI=",
                        name: "Calendrier de base",
                        defaultWorkingDays: [1, 2, 3, 4, 5],
                        rules: [],
                    },
                }];
            }
            if (sheet.relationships?.length > 0) {
                sheetObj.relationships = sheet.relationships.map(rel => {
                    const end1Id = this.titleToId.get(rel.sourceTitle);
                    const end2Id = this.titleToId.get(rel.targetTitle);
                    if (!end1Id) throw new Error(`Relationship source not found: "${rel.sourceTitle}"`);
                    if (!end2Id) throw new Error(`Relationship target not found: "${rel.targetTitle}"`);
                    const r = { id: generateId(), end1Id, end2Id };
                    if (rel.title) r.title = rel.title;
                    if (rel.shape) {
                        r.style = { id: generateId(), properties: { "shape-class": rel.shape } };
                    }
                    if (rel.controlPoints) r.controlPoints = rel.controlPoints;
                    return r;
                });
            }
            return sheetObj;
        });

        return {
            contentJson,
            attachments: this.attachments,
        };
    }

    async finalize(contentJson, attachments) {
        const fileEntries = { "content.json": {}, "metadata.json": {} };
        const resourceFiles = [];

        for (const att of attachments) {
            const data = await readFile(resolve(att.sourcePath));
            const hash = createHash('sha256').update(data).digest('hex');
            const ext = extname(att.sourcePath);
            const resourcePath = `resources/${hash}${ext}`;
            fileEntries[resourcePath] = {};
            resourceFiles.push({ name: resourcePath, data });
            // Set href on the topic
            this.setHrefById(contentJson, att.topicId, `xap:${resourcePath}`);
        }

        return {
            content: JSON.stringify(contentJson),
            metadata: JSON.stringify({
                dataStructureVersion: "3",
                creator: { name: "xmind-skill", version: "1.0.0" },
                layoutEngineVersion: "5",
            }),
            manifest: JSON.stringify({ "file-entries": fileEntries }),
            resourceFiles,
        };
    }

    setHrefById(sheets, topicId, href) {
        for (const sheet of sheets) {
            if (this._setHref(sheet.rootTopic, topicId, href)) return;
        }
    }

    _setHref(topic, topicId, href) {
        if (topic.id === topicId) { topic.href = href; return true; }
        for (const child of topic.children?.attached || []) if (this._setHref(child, topicId, href)) return true;
        for (const child of topic.children?.callout || []) if (this._setHref(child, topicId, href)) return true;
        return false;
    }

    resolveLinks(topic) {
        const targetTitle = this.pendingLinks.get(topic.id);
        if (targetTitle) {
            const targetId = this.titleToId.get(targetTitle);
            if (!targetId) throw new Error(`Link target not found: "${targetTitle}"`);
            topic.href = `xmind:#${targetId}`;
        }
        for (const child of topic.children?.attached || []) this.resolveLinks(child);
        for (const child of topic.children?.callout || []) this.resolveLinks(child);
    }

    resolveDependencies(topic) {
        const deps = this.pendingDependencies.get(topic.id);
        if (deps && topic.extensions) {
            const taskExt = topic.extensions.find(e => e.provider === 'org.xmind.ui.task');
            if (taskExt) {
                taskExt.content.dependencies = deps.map(d => {
                    const targetId = this.titleToId.get(d.targetTitle);
                    if (!targetId) throw new Error(`Dependency target not found: "${d.targetTitle}"`);
                    return { id: targetId, type: d.type, lag: d.lag ?? 0 };
                });
            }
        }
        for (const child of topic.children?.attached || []) this.resolveDependencies(child);
    }

    hasPlannedTasks(input) {
        if (input.startDate || input.dueDate || input.progress !== undefined || input.durationDays !== undefined) return true;
        return (input.children || []).some(c => this.hasPlannedTasks(c));
    }

    buildTopic(input, { detached = false } = {}) {
        const id = generateId();
        this.titleToId.set(input.title, id);
        const topic = { id, class: "topic", title: input.title };

        if (input.structureClass) topic.structureClass = input.structureClass;
        if (input.position) topic.position = input.position;
        if (input.shape) {
            topic.style = { id: generateId(), properties: { "shape-class": input.shape } };
        }

        if (input.notes) {
            if (typeof input.notes === 'string') {
                topic.notes = { plain: { content: input.notes } };
            } else {
                topic.notes = {};
                if (input.notes.plain) topic.notes.plain = { content: input.notes.plain };
                if (input.notes.html) topic.notes.realHTML = { content: input.notes.html };
            }
        }
        if (input.attachment) {
            this.attachments.push({ sourcePath: input.attachment, topicId: id });
        } else if (input.href) {
            topic.href = input.href;
        }
        if (input.linkToTopic) this.pendingLinks.set(id, input.linkToTopic);
        if (input.labels) topic.labels = input.labels;
        if (input.markers?.length > 0) topic.markers = input.markers.map(m => ({ markerId: m }));

        const hasTaskProps = input.taskStatus || input.progress !== undefined ||
            input.priority !== undefined || input.startDate || input.dueDate ||
            input.durationDays !== undefined || input.dependencies;
        if (hasTaskProps) {
            const tc = {};
            if (input.taskStatus) tc.status = input.taskStatus;
            if (input.progress !== undefined) tc.progress = input.progress;
            if (input.priority !== undefined) tc.priority = input.priority;
            if (input.startDate) tc.start = new Date(input.startDate).getTime();
            if (input.dueDate) {
                tc.due = new Date(input.dueDate).getTime();
                if (input.startDate) tc.duration = new Date(input.dueDate).getTime() - new Date(input.startDate).getTime();
            }
            if (input.durationDays !== undefined && !input.startDate) tc.duration = input.durationDays * 86400000;
            if (input.dependencies?.length > 0) this.pendingDependencies.set(id, input.dependencies);
            topic.extensions = [{ provider: 'org.xmind.ui.task', content: tc }];
        }

        if (input.boundaries?.length > 0) {
            topic.boundaries = input.boundaries.map(b => ({
                id: generateId(), range: b.range, ...(b.title ? { title: b.title } : {}),
            }));
        }
        if (input.summaryTopics?.length > 0) {
            topic.summaries = input.summaryTopics.map(s => {
                const topicId = generateId();
                return { id: generateId(), range: s.range, topicId };
            });
            topic.summary = input.summaryTopics.map((s, i) => ({
                id: topic.summaries[i].topicId, title: s.title,
            }));
        }

        const attached = input.children?.length > 0
            ? input.children.map(c => this.buildTopic(c))
            : undefined;
        const callout = input.callouts?.length > 0
            ? input.callouts.map(text => ({ id: generateId(), title: text }))
            : undefined;
        if (attached || callout) {
            topic.children = {};
            if (attached) topic.children.attached = attached;
            if (callout) topic.children.callout = callout;
        }

        return topic;
    }
}

// Main
async function main() {
    let rawInput = '';
    for await (const chunk of process.stdin) rawInput += chunk;

    const input = JSON.parse(rawInput);
    const outputPath = input.path || process.argv.find((a, i) => process.argv[i - 1] === '--path');
    if (!outputPath) {
        console.error('Error: no output path. Provide "path" in JSON or --path argument.');
        process.exit(1);
    }
    if (!outputPath.toLowerCase().endsWith('.xmind')) {
        console.error('Error: path must end with .xmind');
        process.exit(1);
    }

    const builder = new XMindBuilder();
    const { contentJson, attachments } = builder.build(input.sheets);
    const { content, metadata, manifest, resourceFiles } = await builder.finalize(contentJson, attachments);

    const resolvedPath = resolve(outputPath);
    await mkdir(dirname(resolvedPath), { recursive: true });

    const zipBuffer = buildZip([
        { name: 'content.json', data: Buffer.from(content, 'utf-8') },
        { name: 'metadata.json', data: Buffer.from(metadata, 'utf-8') },
        { name: 'manifest.json', data: Buffer.from(manifest, 'utf-8') },
        ...resourceFiles,
    ]);
    await writeFile(resolvedPath, zipBuffer);

    console.log(`Created: ${resolvedPath}`);
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
