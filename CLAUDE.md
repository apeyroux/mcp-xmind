# CLAUDE.md

## Build & Test
- `npm run build` — compile TS (tsc) + chmod dist/*.js
- `npm test` — vitest run
- `npx @modelcontextprotocol/inspector node dist/index.js /Users/alex/tmp/xmind` — test interactif MCP

## Architecture
- Single file server: `index.ts` (racine, pas src/)
- Tests: `test/xmind-server.test.ts` avec helpers dans `test/helpers.ts`
- tsconfig: rootDir=`.`, outDir=`dist/`, exclut `test/` du build

## XMind Format
- Fichier .xmind = ZIP contenant `content.json`, `metadata.json`, `manifest.json`
- Topics requièrent `class: "topic"`, sheets requièrent `class: "sheet"` + `theme: {}`
- Planned tasks nécessitent `extensions` avec `org.xmind.ui.working-day-settings` au niveau sheet
- `topicOverlapping: "overlap"` requis au niveau sheet
- Notes HTML : `realHTML.content` (balises supportées: `<strong>`, `<u>`, `<ul>`, `<ol>`, `<li>`, `<br>`) — `<code>` non supporté par XMind
- Liens internes entre topics/sheets : `href: "xmind:#<topicId>"`

## Patterns
- IDs générés via `crypto.randomUUID()` tronqué à 26 chars sans tirets
- Résolution par titre (relationships, dependencies, linkToTopic) : stocker title→id dans un Map, résoudre après construction
- TypeScript : utiliser `NonNullable<T>` pour accéder aux éléments d'arrays optionnels dans les interfaces
- Tests : `testDirPath` pour les fichiers créés par create_xmind (pas `tempDir`)

## Skill
- `skills/xmind/` : skill standalone pour Claude Desktop (création uniquement, pas de lecture)
- Script : `skills/xmind/scripts/create_xmind.mjs` — zéro dépendance npm (ZIP inline avec `zlib.deflateRawSync`)
- Build : `cd skills/xmind && zip -r xmind-skill.zip SKILL.md scripts/`
- Test : `echo '{"path":"/tmp/test.xmind","sheets":[{"title":"T","rootTopic":{"title":"R"}}]}' | node skills/xmind/scripts/create_xmind.mjs`
- Claude Code : `ln -s /path/to/mcp-xmind/skills/xmind ~/.claude/skills/xmind` (ou `.claude/skills/` par projet)
