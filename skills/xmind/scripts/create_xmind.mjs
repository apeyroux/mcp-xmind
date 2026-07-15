#!/usr/bin/env node

// XMind file creator - reads JSON from stdin, writes .xmind file
// Usage: echo '{"path":"/tmp/test.xmind","sheets":[...]}' | node create_xmind.mjs
// Or:   node create_xmind.mjs --path /tmp/test.xmind < data.json
// No external dependencies — uses only Node.js built-ins.

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve, extname } from 'path';
import { randomUUID, createHash } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';

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

// ─── Minimal ZIP reader (ported from read_xmind.mjs) — used to preserve theme/style/resources
// when overwriting a file that already exists, so re-running create_xmind.mjs on an existing
// .xmind never silently resets its visual theme, layout extensions, or embedded thumbnail. ───

function readZip(buf) {
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset === -1) throw new Error('Invalid ZIP: EOCD not found');

    const cdEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    const files = new Map();
    let pos = cdOffset;
    for (let i = 0; i < cdEntries; i++) {
        if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP: bad CD entry');
        const compression = buf.readUInt16LE(pos + 10);
        const compressedSize = buf.readUInt32LE(pos + 20);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localHeaderOffset = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf-8', pos + 46, pos + 46 + nameLen);

        files.set(name, { compression, compressedSize, localHeaderOffset });
        pos += 46 + nameLen + extraLen + commentLen;
    }

    return {
        extract(name) {
            const entry = files.get(name);
            if (!entry) return null;
            const lhOffset = entry.localHeaderOffset;
            if (buf.readUInt32LE(lhOffset) !== 0x04034b50) throw new Error('Invalid ZIP: bad local header');
            const lhNameLen = buf.readUInt16LE(lhOffset + 26);
            const lhExtraLen = buf.readUInt16LE(lhOffset + 28);
            const dataOffset = lhOffset + 30 + lhNameLen + lhExtraLen;
            const rawData = buf.subarray(dataOffset, dataOffset + entry.compressedSize);
            if (entry.compression === 0) return rawData;
            if (entry.compression === 8) return inflateRawSync(rawData);
            throw new Error(`Unsupported compression method: ${entry.compression}`);
        },
        names() { return [...files.keys()]; },
    };
}

// Reads an existing .xmind file (if any) at `path` so its per-sheet theme/extensions and
// embedded resources (e.g. Thumbnails/thumbnail.png) can be carried into the regenerated file.
// Returns null if there's nothing to preserve (file doesn't exist, isn't zen-format, or fails to parse) —
// callers must treat that as "nothing to merge", not an error.
async function loadExistingXMind(path) {
    if (!existsSync(path)) return null;
    try {
        const buf = await readFile(path);
        const zip = readZip(buf);
        const names = zip.names();
        if (!names.includes('content.json')) return null;

        const parsedContent = JSON.parse(zip.extract('content.json').toString('utf-8'));
        // Accept both array format and {sheets:[...]} object wrapper (read_xmind.mjs does the same).
        const contentJson = Array.isArray(parsedContent) ? parsedContent
            : Array.isArray(parsedContent?.sheets) ? parsedContent.sheets : [];
        const metadataRaw = names.includes('metadata.json')
            ? zip.extract('metadata.json').toString('utf-8')
            : null;

        // Sheets are matched by title; keep a queue per title so a workbook with duplicate
        // sheet titles doesn't collapse them onto a single reused id.
        const sheetsByTitle = new Map();
        for (const sheet of contentJson) {
            if (!sheet.title) continue;
            if (!sheetsByTitle.has(sheet.title)) sheetsByTitle.set(sheet.title, []);
            sheetsByTitle.get(sheet.title).push(sheet);
        }

        const resourceEntries = [];
        for (const name of names) {
            if (name === 'content.json' || name === 'metadata.json' || name === 'manifest.json') continue;
            if (name.endsWith('/')) continue; // directory marker entry, nothing to carry forward
            resourceEntries.push({ name, data: zip.extract(name) });
        }

        return { sheetsByTitle, metadataRaw, resourceEntries };
    } catch (err) {
        console.error(`Warning: could not read existing file "${path}" to preserve its theme/style (${err.message}). Proceeding without merge.`);
        return null;
    }
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

    build(sheets, existingSheetsByTitle = null) {
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
            // Sheets with duplicate titles are matched in order (first existing sheet with this
            // title pairs with the first rebuilt sheet with this title, etc.) rather than all
            // reusing the same existing sheet.
            const existingSheet = existingSheetsByTitle?.get(sheet.title)?.shift();
            // Preserve the previous sheet's visual theme and layout extensions when a sheet with
            // the same title already existed — without this, every regeneration resets styling to
            // XMind's bare default (empty theme, no clockwise/logic layout, no thumbnail).
            const sheetTheme = existingSheet?.theme ? existingSheet.theme : {};
            const hasPlanned = this.hasPlannedTasks(sheet.rootTopic);
            if (detached?.length > 0) {
                if (!rootTopic.children) rootTopic.children = {};
                rootTopic.children.detached = detached;
            }
            const sheetId = existingSheet?.id || generateId();
            const sheetObj = {
                id: sheetId,
                class: "sheet",
                title: sheet.title,
                rootTopic,
                topicOverlapping: existingSheet?.topicOverlapping || "overlap",
                theme: sheetTheme,
            };
            // Note: `zones` and `arrangeableLayerOrder` are intentionally NOT carried forward —
            // both reference topic/zone ids, and buildTopic() always mints fresh ids, so copying
            // them verbatim would leave dangling references into a workbook that no longer has
            // those ids.
            if (sheet.freePositioning) {
                sheetObj.topicPositioning = "free";
                sheetObj.floatingTopicFlexible = true;
            }
            // Preserve non-task extensions from the old sheet (e.g. layout/structure style),
            // then layer the planned-task extension on top if this build introduces one —
            // otherwise regenerating a sheet with tasks would drop its prior layout extensions.
            const preservedExtensions = (existingSheet?.extensions || [])
                .filter(e => e.provider !== 'org.xmind.ui.working-day-settings');
            if (hasPlanned) {
                preservedExtensions.push({
                    provider: "org.xmind.ui.working-day-settings",
                    content: {
                        id: "YmFzaWMtY2FsZW5kYXI=",
                        name: "Calendrier de base",
                        defaultWorkingDays: [1, 2, 3, 4, 5],
                        rules: [],
                    },
                });
            }
            if (preservedExtensions.length > 0) sheetObj.extensions = preservedExtensions;
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

    async finalize(contentJson, attachments, existingResourceEntries = [], existingMetadataRaw = null) {
        const fileEntries = { "content.json": {}, "metadata.json": {} };
        const resourceFilesByName = new Map();

        for (const att of attachments) {
            const data = await readFile(resolve(att.sourcePath));
            const hash = createHash('sha256').update(data).digest('hex');
            const ext = extname(att.sourcePath);
            const resourcePath = `resources/${hash}${ext}`;
            fileEntries[resourcePath] = {};
            resourceFilesByName.set(resourcePath, data);
            // Set href on the topic
            this.setHrefById(contentJson, att.topicId, `xap:${resourcePath}`);
        }

        // Carry forward resources embedded in the previous file (e.g. Thumbnails/thumbnail.png)
        // that this build doesn't already regenerate — otherwise XMind falls back to a blank
        // thumbnail/theme-less render for files that previously had one. Skip any name already
        // written by a freshly-attached resource above so regenerated attachments always win.
        for (const res of existingResourceEntries) {
            if (resourceFilesByName.has(res.name)) continue;
            fileEntries[res.name] = {};
            resourceFilesByName.set(res.name, res.data);
        }

        const resourceFiles = [...resourceFilesByName].map(([name, data]) => ({ name, data }));

        return {
            content: JSON.stringify(contentJson),
            metadata: existingMetadataRaw || JSON.stringify({
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

// ─── XMind 8 Legacy XML builder ───

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function topicToXml(topic, indent = '      ') {
    const attrs = [`id="${escapeXml(topic.id)}"`];
    if (topic.structureClass) attrs.push(`structure-class="${escapeXml(topic.structureClass)}"`);
    if (topic.href) attrs.push(`xlink:href="${escapeXml(topic.href)}"`);

    let xml = `${indent}<topic ${attrs.join(' ')}>\n`;
    xml += `${indent}  <title>${escapeXml(topic.title)}</title>\n`;

    // Position
    if (topic.position) {
        xml += `${indent}  <position svg:x="${topic.position.x}" svg:y="${topic.position.y}"/>\n`;
    }

    // Style (shape)
    if (topic.style?.properties?.['shape-class']) {
        xml += `${indent}  <style>\n`;
        xml += `${indent}    <topic-properties shape-class="${escapeXml(topic.style.properties['shape-class'])}"/>\n`;
        xml += `${indent}  </style>\n`;
    }

    // Notes
    if (topic.notes) {
        xml += `${indent}  <notes>\n`;
        if (topic.notes.plain) {
            xml += `${indent}    <plain>${escapeXml(topic.notes.plain.content)}</plain>\n`;
        }
        if (topic.notes.realHTML) {
            xml += `${indent}    <html><![CDATA[${topic.notes.realHTML.content}]]></html>\n`;
        }
        xml += `${indent}  </notes>\n`;
    }

    // Labels
    if (topic.labels?.length > 0) {
        xml += `${indent}  <labels>\n`;
        for (const label of topic.labels) {
            xml += `${indent}    <label>${escapeXml(label)}</label>\n`;
        }
        xml += `${indent}  </labels>\n`;
    }

    // Markers
    if (topic.markers?.length > 0) {
        xml += `${indent}  <marker-refs>\n`;
        for (const m of topic.markers) {
            xml += `${indent}    <marker-ref marker-id="${escapeXml(m.markerId)}"/>\n`;
        }
        xml += `${indent}  </marker-refs>\n`;
    }

    // Boundaries
    if (topic.boundaries?.length > 0) {
        xml += `${indent}  <boundaries>\n`;
        for (const b of topic.boundaries) {
            if (b.title) {
                xml += `${indent}    <boundary id="${escapeXml(b.id)}" range="${escapeXml(b.range)}">\n`;
                xml += `${indent}      <title>${escapeXml(b.title)}</title>\n`;
                xml += `${indent}    </boundary>\n`;
            } else {
                xml += `${indent}    <boundary id="${escapeXml(b.id)}" range="${escapeXml(b.range)}"/>\n`;
            }
        }
        xml += `${indent}  </boundaries>\n`;
    }

    // Summaries
    if (topic.summaries?.length > 0) {
        xml += `${indent}  <summaries>\n`;
        for (const s of topic.summaries) {
            xml += `${indent}    <summary id="${escapeXml(s.id)}" range="${escapeXml(s.range)}" topic-id="${escapeXml(s.topicId)}"/>\n`;
        }
        xml += `${indent}  </summaries>\n`;
    }

    // Extensions (task info)
    if (topic.extensions?.length > 0) {
        xml += `${indent}  <extensions>\n`;
        for (const ext of topic.extensions) {
            xml += `${indent}    <extension provider="${escapeXml(ext.provider)}">\n`;
            xml += `${indent}      <content>\n`;
            const c = ext.content;
            if (c.status) xml += `${indent}        <status>${escapeXml(c.status)}</status>\n`;
            if (c.progress !== undefined) xml += `${indent}        <progress>${c.progress}</progress>\n`;
            if (c.priority !== undefined) xml += `${indent}        <priority>${c.priority}</priority>\n`;
            if (c.start !== undefined) xml += `${indent}        <start>${c.start}</start>\n`;
            if (c.due !== undefined) xml += `${indent}        <due>${c.due}</due>\n`;
            if (c.duration !== undefined) xml += `${indent}        <duration>${c.duration}</duration>\n`;
            if (c.dependencies?.length > 0) {
                xml += `${indent}        <dependencies>\n`;
                for (const dep of c.dependencies) {
                    xml += `${indent}          <dependency id="${escapeXml(dep.id)}" type="${escapeXml(dep.type)}" lag="${dep.lag}"/>\n`;
                }
                xml += `${indent}        </dependencies>\n`;
            }
            xml += `${indent}      </content>\n`;
            xml += `${indent}    </extension>\n`;
        }
        xml += `${indent}  </extensions>\n`;
    }

    // Children — XMind 8 uses <topics type="attached|detached|callout|summary">
    const hasAttached = topic.children?.attached?.length > 0;
    const hasCallout = topic.children?.callout?.length > 0;
    const hasDetached = topic.children?.detached?.length > 0;
    // Summary topics go under <children><topics type="summary"> in XMind 8
    const hasSummaryTopics = topic.summary?.length > 0;

    if (hasAttached || hasCallout || hasDetached || hasSummaryTopics) {
        xml += `${indent}  <children>\n`;
        if (hasAttached) {
            xml += `${indent}    <topics type="attached">\n`;
            for (const child of topic.children.attached) {
                xml += topicToXml(child, indent + '      ');
            }
            xml += `${indent}    </topics>\n`;
        }
        if (hasCallout) {
            xml += `${indent}    <topics type="callout">\n`;
            for (const child of topic.children.callout) {
                xml += `${indent}      <topic id="${escapeXml(child.id)}">\n`;
                xml += `${indent}        <title>${escapeXml(child.title)}</title>\n`;
                xml += `${indent}      </topic>\n`;
            }
            xml += `${indent}    </topics>\n`;
        }
        if (hasDetached) {
            xml += `${indent}    <topics type="detached">\n`;
            for (const child of topic.children.detached) {
                xml += topicToXml(child, indent + '      ');
            }
            xml += `${indent}    </topics>\n`;
        }
        if (hasSummaryTopics) {
            xml += `${indent}    <topics type="summary">\n`;
            for (const st of topic.summary) {
                xml += `${indent}      <topic id="${escapeXml(st.id)}">\n`;
                xml += `${indent}        <title>${escapeXml(st.title)}</title>\n`;
                xml += `${indent}      </topic>\n`;
            }
            xml += `${indent}    </topics>\n`;
        }
        xml += `${indent}  </children>\n`;
    }

    xml += `${indent}</topic>\n`;
    return xml;
}

function buildLegacyXml(contentJson) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
    xml += '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"';
    xml += ' xmlns:fo="http://www.w3.org/1999/XSL/Format"';
    xml += ' xmlns:svg="http://www.w3.org/2000/svg"';
    xml += ' xmlns:xhtml="http://www.w3.org/1999/xhtml"';
    xml += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    xml += ' version="2.0">\n';

    for (const sheet of contentJson) {
        xml += `  <sheet id="${escapeXml(sheet.id)}">\n`;
        xml += `    <title>${escapeXml(sheet.title)}</title>\n`;
        xml += topicToXml(sheet.rootTopic, '    ');

        // Relationships
        if (sheet.relationships?.length > 0) {
            xml += '    <relationships>\n';
            for (const rel of sheet.relationships) {
                const relAttrs = [`id="${escapeXml(rel.id)}"`, `end1="${escapeXml(rel.end1Id)}"`, `end2="${escapeXml(rel.end2Id)}"`];
                const hasChildren = rel.title || rel.style || rel.controlPoints;
                if (hasChildren) {
                    xml += `      <relationship ${relAttrs.join(' ')}>\n`;
                    if (rel.title) xml += `        <title>${escapeXml(rel.title)}</title>\n`;
                    if (rel.style?.properties?.['shape-class']) {
                        xml += `        <style>\n`;
                        xml += `          <relationship-properties shape-class="${escapeXml(rel.style.properties['shape-class'])}"/>\n`;
                        xml += `        </style>\n`;
                    }
                    if (rel.controlPoints?.length > 0) {
                        xml += '        <control-points>\n';
                        rel.controlPoints.forEach((cp, i) => {
                            const cpAttrs = [`index="${i}"`];
                            if (cp.amount !== undefined) cpAttrs.push(`amount="${cp.amount}"`);
                            if (cp.angle !== undefined) cpAttrs.push(`angle="${cp.angle}"`);
                            xml += `          <control-point ${cpAttrs.join(' ')}/>\n`;
                        });
                        xml += '        </control-points>\n';
                    }
                    xml += '      </relationship>\n';
                } else {
                    xml += `      <relationship ${relAttrs.join(' ')}/>\n`;
                }
            }
            xml += '    </relationships>\n';
        }

        xml += '  </sheet>\n';
    }

    xml += '</xmap-content>\n';
    return xml;
}

function buildLegacyMeta() {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
    xml += '<meta xmlns="urn:xmind:xmap:xmlns:meta:2.0" version="2.0">\n';
    xml += '  <Creator><Name>xmind-skill</Name><Version>1.0.0</Version></Creator>\n';
    xml += '</meta>\n';
    return xml;
}

function buildLegacyManifest(fileEntries) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
    xml += '<manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0">\n';
    for (const entry of Object.keys(fileEntries)) {
        const mediaType = entry.endsWith('.xml') ? 'text/xml' : '';
        xml += `  <file-entry full-path="${escapeXml(entry)}"${mediaType ? ` media-type="${mediaType}"` : ''}/>\n`;
    }
    xml += '</manifest>\n';
    return xml;
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

    // ─── Format / version resolution ───
    // Accepts many aliases so that any editor or user can specify a familiar version string.
    //
    // Legacy (XML-based, XMind 8 and earlier):
    //   "legacy", "xml", "xmind8", "xmind7", "xmind6", "xmind3",
    //   "8", "7", "6", "3", "2008", "2009", "2010", "2011", "2012", "2013"
    //
    // Modern (JSON-based, XMind Zen / 2020+):
    //   "zen", "json", "xmind2020", "xmind2021", "xmind2022", "xmind2023", "xmind2024", "xmind2025", "xmind2026",
    //   "2020", "2021", "2022", "2023", "2024", "2025", "2026", "latest", "new"
    //
    // Default (no format specified): "zen"

    const LEGACY_ALIASES = new Set([
        'legacy', 'xml', 'old',
        'xmind8', 'xmind7', 'xmind6', 'xmind5', 'xmind4', 'xmind3',
        'xmind-8', 'xmind-7', 'xmind-6',
        '8', '7', '6', '5', '4', '3',
        '2008', '2009', '2010', '2011', '2012', '2013',
        'xmind2008', 'xmind2009', 'xmind2010', 'xmind2011', 'xmind2012', 'xmind2013',
        'pro8', 'pro7', 'pro6',
    ]);

    const ZEN_ALIASES = new Set([
        'zen', 'json', 'new', 'latest', 'modern',
        'xmindzen', 'xmind-zen',
        'xmind2020', 'xmind2021', 'xmind2022', 'xmind2023', 'xmind2024', 'xmind2025', 'xmind2026',
        'xmind-2020', 'xmind-2021', 'xmind-2022', 'xmind-2023', 'xmind-2024', 'xmind-2025', 'xmind-2026',
        '2020', '2021', '2022', '2023', '2024', '2025', '2026',
        '10', '11', '12', '13', '14',
    ]);

    const rawFormat = (input.format || 'zen').toString().toLowerCase().replace(/\s+/g, '');
    let resolvedFormat;
    if (LEGACY_ALIASES.has(rawFormat)) {
        resolvedFormat = 'legacy';
    } else if (ZEN_ALIASES.has(rawFormat)) {
        resolvedFormat = 'zen';
    } else {
        // Heuristic: numbers <= 13 are version-based (XMind 3~8 = legacy, 10+ = zen-era)
        // Years <= 2019 are legacy, >= 2020 are zen
        const num = parseInt(rawFormat, 10);
        if (!isNaN(num)) {
            if (num <= 9) resolvedFormat = 'legacy';       // XMind 3-8
            else if (num <= 99) resolvedFormat = 'zen';     // XMind 10+
            else if (num <= 2019) resolvedFormat = 'legacy'; // years up to 2019
            else resolvedFormat = 'zen';                     // 2020+
        } else {
            console.error(`Warning: unknown format "${input.format}", defaulting to zen (modern JSON format).`);
            console.error('  Legacy (XML):  "xmind8", "legacy", "xml", "8", "2013"');
            console.error('  Modern (JSON): "zen", "latest", "xmind2024", "2024"');
            resolvedFormat = 'zen';
        }
    }

    const builder = new XMindBuilder();

    const resolvedPath = resolve(outputPath);
    await mkdir(dirname(resolvedPath), { recursive: true });

    // If a zen-format .xmind already exists at this path, preserve its per-sheet theme/layout
    // extensions and embedded resources (thumbnail, attachments) when regenerating — see
    // loadExistingXMind(). Legacy-format rebuilds don't carry theme state the same way, so this
    // only applies when producing zen output.
    const existing = resolvedFormat === 'zen' ? await loadExistingXMind(resolvedPath) : null;
    if (existing) {
        console.error(`Note: preserving theme/layout/resources from existing file at ${resolvedPath}`);
    }

    const { contentJson, attachments } = builder.build(input.sheets, existing?.sheetsByTitle);

    if (resolvedFormat === 'legacy') {
        // Legacy XML format (XMind 3–8 compatible)
        const { resourceFiles } = await builder.finalize(contentJson, attachments);
        const contentXml = buildLegacyXml(contentJson);
        const metaXml = buildLegacyMeta();
        const fileEntries = { 'content.xml': {}, 'meta.xml': {}, 'META-INF/manifest.xml': {} };
        for (const rf of resourceFiles) fileEntries[rf.name] = {};
        const manifestXml = buildLegacyManifest(fileEntries);

        const zipBuffer = buildZip([
            { name: 'content.xml', data: Buffer.from(contentXml, 'utf-8') },
            { name: 'meta.xml', data: Buffer.from(metaXml, 'utf-8') },
            { name: 'META-INF/manifest.xml', data: Buffer.from(manifestXml, 'utf-8') },
            ...resourceFiles,
        ]);
        await writeFile(resolvedPath, zipBuffer);
        console.log(`Created (XMind 8 / legacy XML format): ${resolvedPath}`);
    } else {
        // Modern JSON format (XMind Zen / 2020+)
        const { content, metadata, manifest, resourceFiles } = await builder.finalize(
            contentJson, attachments, existing?.resourceEntries, existing?.metadataRaw,
        );
        const zipBuffer = buildZip([
            { name: 'content.json', data: Buffer.from(content, 'utf-8') },
            { name: 'metadata.json', data: Buffer.from(metadata, 'utf-8') },
            { name: 'manifest.json', data: Buffer.from(manifest, 'utf-8') },
            ...resourceFiles,
        ]);
        await writeFile(resolvedPath, zipBuffer);
        console.log(`Created (XMind Zen / modern JSON format): ${resolvedPath}`);
    }
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
