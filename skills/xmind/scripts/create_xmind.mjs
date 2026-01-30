#!/usr/bin/env node

// XMind file creator - reads JSON from stdin, writes .xmind file
// Usage: echo '{"path":"/tmp/test.xmind","sheets":[...]}' | node create_xmind.mjs
// Or:   node create_xmind.mjs --path /tmp/test.xmind < data.json
// No external dependencies — uses only Node.js built-ins.

import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { randomUUID } from 'crypto';
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

const THEMES = {
    default: {},
    business: {
        centralTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "30pt", "fo:font-weight": "800", "svg:fill": "#0D0D0D", "fill-pattern": "none", "line-width": "2pt", "line-color": "#0D0D0D", "line-pattern": "solid", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.curve" } },
        mainTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "18pt", "fo:font-weight": "500", "fill-pattern": "solid", "line-width": "2pt", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.roundedElbow" } },
        subTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "14pt", "fo:font-weight": "400", "fill-pattern": "none", "line-width": "2pt", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.roundedElbow" } },
        map: { id: generateId(), properties: { "svg:fill": "#FFFFFF", "multi-line-colors": "#F22816 #F2B807 #233ED9", "color-list": "#FFFFFF #F2F2F2 #F22816 #F2B807 #233ED9 #0D0D0D", "line-tapered": "none" } },
    },
    dark: {
        centralTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "30pt", "fo:font-weight": "800", "fo:color": "#FFFFFF", "svg:fill": "#2D2D2D", "fill-pattern": "solid", "line-width": "2pt", "line-color": "#FFFFFF", "line-pattern": "solid", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.curve" } },
        mainTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "18pt", "fo:font-weight": "500", "fo:color": "#FFFFFF", "fill-pattern": "solid", "line-width": "2pt", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.roundedElbow" } },
        subTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "14pt", "fo:font-weight": "400", "fo:color": "#CCCCCC", "fill-pattern": "none", "line-width": "2pt", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.roundedElbow" } },
        map: { id: generateId(), properties: { "svg:fill": "#1A1A1A", "multi-line-colors": "#FF6B6B #FFD93D #6BCB77", "color-list": "#1A1A1A #2D2D2D #FF6B6B #FFD93D #6BCB77 #FFFFFF", "line-tapered": "none" } },
    },
    simple: {
        centralTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "24pt", "fo:font-weight": "600", "svg:fill": "#FFFFFF", "fill-pattern": "solid", "line-width": "1pt", "line-color": "#333333", "line-pattern": "solid", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.curve" } },
        mainTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "16pt", "fo:font-weight": "400", "fill-pattern": "solid", "line-width": "1pt", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.roundedElbow" } },
        subTopic: { id: generateId(), properties: { "fo:font-family": "NeverMind", "fo:font-size": "13pt", "fo:font-weight": "400", "fill-pattern": "none", "line-width": "1pt", "shape-class": "org.xmind.topicShape.roundedRect", "line-class": "org.xmind.branchConnection.roundedElbow" } },
        map: { id: generateId(), properties: { "svg:fill": "#FFFFFF", "multi-line-colors": "#4A90D9 #50C878 #FF8C42", "color-list": "#FFFFFF #F5F5F5 #4A90D9 #50C878 #FF8C42 #333333", "line-tapered": "none" } },
    },
};

class XMindBuilder {
    constructor() {
        this.titleToId = new Map();
        this.pendingDependencies = new Map();
        this.pendingLinks = new Map();
    }

    build(sheets) {
        this.titleToId.clear();
        this.pendingDependencies.clear();
        this.pendingLinks.clear();

        const builtSheets = [];
        for (const sheet of sheets) {
            const rootTopic = this.buildTopic(sheet.rootTopic);
            this.resolveDependencies(rootTopic);
            builtSheets.push({ rootTopic, sheet });
        }

        for (const { rootTopic } of builtSheets) {
            this.resolveLinks(rootTopic);
        }

        const contentJson = builtSheets.map(({ rootTopic, sheet }) => {
            const sheetTheme = sheet.theme ? THEMES[sheet.theme] || {} : {};
            const hasPlanned = this.hasPlannedTasks(sheet.rootTopic);
            const sheetObj = {
                id: generateId(),
                class: "sheet",
                title: sheet.title,
                rootTopic,
                topicOverlapping: "overlap",
                theme: sheetTheme,
            };
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
                    return r;
                });
            }
            return sheetObj;
        });

        return {
            content: JSON.stringify(contentJson),
            metadata: JSON.stringify({
                dataStructureVersion: "3",
                creator: { name: "xmind-skill", version: "1.0.0" },
                layoutEngineVersion: "5",
            }),
            manifest: JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {}, "Thumbnails/thumbnail.png": {} } }),
        };
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

    buildTopic(input) {
        const id = generateId();
        this.titleToId.set(input.title, id);
        const topic = { id, class: "topic", title: input.title };

        if (input.structureClass) topic.structureClass = input.structureClass;

        if (input.notes) {
            if (typeof input.notes === 'string') {
                topic.notes = { plain: { content: input.notes } };
            } else {
                topic.notes = {};
                if (input.notes.plain) topic.notes.plain = { content: input.notes.plain };
                if (input.notes.html) topic.notes.realHTML = { content: input.notes.html };
            }
        }
        if (input.href) topic.href = input.href;
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
    const { content, metadata, manifest } = builder.build(input.sheets);

    const resolvedPath = resolve(outputPath);
    await mkdir(dirname(resolvedPath), { recursive: true });

    const zipBuffer = buildZip([
        { name: 'content.json', data: Buffer.from(content, 'utf-8') },
        { name: 'metadata.json', data: Buffer.from(metadata, 'utf-8') },
        { name: 'manifest.json', data: Buffer.from(manifest, 'utf-8') },
    ]);
    await writeFile(resolvedPath, zipBuffer);

    console.log(`Created: ${resolvedPath}`);
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
