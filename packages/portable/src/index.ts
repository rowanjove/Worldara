import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { CalendarDefinition } from '@world-codex/calendar';
import type { Asset, Chapter, Claim, Entity, EntityType, EntityTypeVersion, Fact, Foreshadowing, MapFeature, MapLayer, Plotline, Relation, RelationType, Scene, TimelineBranch, ValidationRule, Work, World, WorldEvent, WorldMap } from '@world-codex/domain';

export interface BundleCalendar {
  id: string;
  worldId: string;
  name: string;
  currentVersion: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface BundleCalendarVersion {
  id: string;
  worldId: string;
  calendarId: string;
  version: number;
  definition: CalendarDefinition;
  createdRevision: bigint | string | number;
  createdAt: string | Date;
}

export interface WorldBundle {
  format: 'world-codex.bundle';
  version: 1;
  exportedAt: string;
  world: World;
  entityTypes: EntityType[];
  entityTypeVersions: EntityTypeVersion[];
  entities: Entity[];
  facts: Fact[];
  relationTypes: RelationType[];
  relations: Relation[];
  events: WorldEvent[];
  maps: WorldMap[];
  mapLayers: MapLayer[];
  mapFeatures: MapFeature[];
  assets: Asset[];
  calendars: BundleCalendar[];
  calendarVersions: BundleCalendarVersion[];
  timelineBranches: TimelineBranch[];
  claims: Claim[];
  validationRules: ValidationRule[];
  works: Work[];
  chapters: Chapter[];
  scenes: Scene[];
  plotlines: Plotline[];
  foreshadowings: Foreshadowing[];
}

type OptionalBundleCollections = 'entityTypeVersions' | 'maps' | 'mapLayers' | 'mapFeatures' | 'assets' | 'calendars' | 'calendarVersions' | 'timelineBranches' | 'claims' | 'validationRules' | 'works' | 'chapters' | 'scenes' | 'plotlines' | 'foreshadowings';

function emptyBundleCollections(): Pick<WorldBundle, OptionalBundleCollections> {
  return { entityTypeVersions: [], maps: [], mapLayers: [], mapFeatures: [], assets: [], calendars: [], calendarVersions: [], timelineBranches: [], claims: [], validationRules: [], works: [], chapters: [], scenes: [], plotlines: [], foreshadowings: [] };
}

export function createBundle(input: Omit<WorldBundle, 'format' | 'version' | 'exportedAt' | OptionalBundleCollections> & Partial<Pick<WorldBundle, OptionalBundleCollections>>): WorldBundle {
  const defaults = emptyBundleCollections();
  return { format: 'world-codex.bundle', version: 1, exportedAt: new Date().toISOString(), ...defaults, ...input, entityTypeVersions: input.entityTypeVersions ?? defaults.entityTypeVersions, maps: input.maps ?? defaults.maps, mapLayers: input.mapLayers ?? defaults.mapLayers, mapFeatures: input.mapFeatures ?? defaults.mapFeatures, assets: input.assets ?? defaults.assets, calendars: input.calendars ?? defaults.calendars, calendarVersions: input.calendarVersions ?? defaults.calendarVersions, timelineBranches: input.timelineBranches ?? defaults.timelineBranches, claims: input.claims ?? defaults.claims, validationRules: input.validationRules ?? defaults.validationRules, works: input.works ?? defaults.works, chapters: input.chapters ?? defaults.chapters, scenes: input.scenes ?? defaults.scenes, plotlines: input.plotlines ?? defaults.plotlines, foreshadowings: input.foreshadowings ?? defaults.foreshadowings };
}

export function bundleToJson(bundle: WorldBundle): string {
  return JSON.stringify(bundle, (_key, value) => typeof value === 'bigint' ? `${value}n` : value, 2);
}

export function bundleHash(bundle: WorldBundle): string {
  return createHash('sha256').update(bundleToJson({ ...bundle, exportedAt: '' })).digest('hex');
}

export function bundleToMarkdown(bundle: WorldBundle): string {
  const lines = ['---', 'format: world-codex.markdown', 'version: 1', `worldId: ${bundle.world.id}`, `slug: ${bundle.world.slug}`, `genre: ${bundle.world.genre}`, `canonStrategy: ${bundle.world.canonStrategy}`, '---', '', `# ${bundle.world.name}`, '', bundle.world.description || ''];
  lines.push('', '## Entities', '');
  for (const entity of bundle.entities) {
    lines.push(`### ${entity.name}`, '', '```yaml', `id: ${entity.id}`, `typeId: ${entity.typeId}`, `canonStatus: ${entity.canonStatus}`, `parentEntityId: ${entity.parentEntityId ?? 'null'}`, '```', '', entity.documentText || '', '');
  }
  lines.push('## Facts', '');
  for (const fact of bundle.facts) lines.push(`- ${fact.subjectEntityId} · ${fact.predicateKey} = ${formatValue(fact.value)}`);
  lines.push('', '## Relations', '');
  for (const relation of bundle.relations) lines.push(`- ${relation.sourceEntityId} —[${relation.relationTypeId}]→ ${relation.targetEntityId}${relation.description ? `: ${relation.description}` : ''}`);
  lines.push('', '## Events', '');
  for (const event of bundle.events) lines.push(`- ${event.startTick.toString()} · ${event.name} (${event.eventType})${event.description ? `: ${event.description}` : ''}`);
  if (bundle.claims.length) {
    lines.push('', '## Claims', '');
    for (const claim of bundle.claims) lines.push(`- ${claim.assertedByEntityId ?? 'unknown'} · ${claim.predicateKey} = ${formatValue(claim.value)} (${claim.claimKind}/${claim.truthStatus})`);
  }
  if (bundle.works.length) {
    lines.push('', '## Works', '');
    for (const work of bundle.works) lines.push(`- ${work.title} (${work.type})`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? `${nested}n` : nested) ?? ''; } catch { return String(value); }
}

export function bundleToGeoJson(bundle: WorldBundle): { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; id: string; geometry: Record<string, unknown>; properties: Record<string, unknown> }> } {
  return {
    type: 'FeatureCollection',
    features: bundle.mapFeatures.map((feature) => ({ type: 'Feature', id: feature.id, geometry: feature.geometry, properties: { ...feature.properties, worldId: feature.worldId, mapId: feature.mapId, ...(feature.layerId === undefined ? {} : { layerId: feature.layerId }), ...(feature.entityId === undefined ? {} : { entityId: feature.entityId }) } })),
  };
}

export function bundleToZip(bundle: WorldBundle, assetFiles: ReadonlyMap<string, Uint8Array> = new Map(), extraFiles: ReadonlyArray<{ name: string; content: Uint8Array }> = []): Uint8Array {
  const includedAssetFiles = bundle.assets.filter((asset) => assetFiles.has(asset.id)).map((asset) => `assets/${asset.id}.bin`);
  const safeExtraFiles = extraFiles.filter((file) => /^\p{L}[\p{L}\p{N}._/-]*$/u.test(file.name) && !file.name.includes('..'));
  const files: Array<{ name: string; content: Uint8Array }> = [
    { name: 'world.json', content: Buffer.from(bundleToJson(bundle), 'utf8') },
    { name: 'world.md', content: Buffer.from(bundleToMarkdown(bundle), 'utf8') },
    { name: 'maps.geojson', content: Buffer.from(JSON.stringify(bundleToGeoJson(bundle), null, 2), 'utf8') },
    { name: 'manifest.json', content: Buffer.from(JSON.stringify({ format: bundle.format, version: bundle.version, sourceHash: bundleHash(bundle), files: ['world.json', 'world.md', 'maps.geojson', ...includedAssetFiles.sort(), ...safeExtraFiles.map((file) => file.name).sort(), 'checksums.sha256'] }, null, 2), 'utf8') },
    ...safeExtraFiles,
  ];
  for (const asset of bundle.assets.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const content = assetFiles.get(asset.id);
    if (content === undefined) continue;
    files.push({ name: `assets/${asset.id}.bin`, content });
  }
  const checksums = files.map((file) => `${createHash('sha256').update(file.content).digest('hex')}  ${file.name}`).join('\n') + '\n';
  files.push({ name: 'checksums.sha256', content: Buffer.from(checksums, 'utf8') });
  const locals: Uint8Array[] = []; const centrals: Uint8Array[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8'); const compressed = deflateRawSync(file.content); const crc = crc32(file.content);
    const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.content.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(file.content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    locals.push(concat(local, compressed)); centrals.push(central); offset += local.length + compressed.length;
  }
  const centralDirectory = concat(...centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return concat(...locals, centralDirectory, end);
}

/** Create an Obsidian-compatible vault archive without changing the canonical bundle format. */
export function bundleToObsidianZip(bundle: WorldBundle, assetFiles: ReadonlyMap<string, Uint8Array> = new Map()): Uint8Array {
  const entityPaths = new Map(bundle.entities.map((entity) => [entity.id, `Entities/${vaultFileName(entity.name, entity.id)}.md`]));
  const files: Array<{ name: string; content: Uint8Array }> = [];
  const link = (id: string): string => {
    const path = entityPaths.get(id);
    return path ? `[[${path.slice(0, -3)}]]` : `\`${id}\``;
  };
  const index = [`# ${bundle.world.name}`, '', bundle.world.description || '', '', '## Entities', '', ...bundle.entities.map((entity) => `- ${link(entity.id)} — ${entity.canonStatus}`), '', '## Events', '', ...bundle.events.map((event) => `- ${event.startTick.toString()} · ${event.name}`), ''].join('\n');
  files.push({ name: 'README.md', content: Buffer.from(index, 'utf8') });
  for (const entity of bundle.entities) {
    const frontmatter = ['---', `id: ${entity.id}`, `typeId: ${entity.typeId}`, `canonStatus: ${entity.canonStatus}`, `parentEntityId: ${entity.parentEntityId ?? 'null'}`, '---', ''].join('\n');
    const facts = bundle.facts.filter((fact) => fact.subjectEntityId === entity.id).map((fact) => `- ${fact.predicateKey}: ${formatValue(fact.value)}`);
    const relations = bundle.relations.filter((relation) => relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id).map((relation) => `- ${link(relation.sourceEntityId)} —[${relation.relationTypeId}]→ ${link(relation.targetEntityId)}`);
    files.push({ name: entityPaths.get(entity.id)!, content: Buffer.from(`${frontmatter}# ${entity.name}\n\n${entity.documentText || ''}\n\n## Facts\n${facts.join('\n')}\n\n## Relations\n${relations.join('\n')}\n`, 'utf8') });
  }
  const events = bundle.events.map((event) => [`---`, `id: ${event.id}`, `canonStatus: ${event.canonStatus}`, '---', '', `# ${event.name}`, '', `- tick: ${event.startTick.toString()}`, `- type: ${event.eventType}`, '', event.description || ''].join('\n')).join('\n\n');
  files.push({ name: 'Events/Events.md', content: Buffer.from(events, 'utf8') });
  return bundleToZip(bundle, assetFiles, files);
}

function vaultFileName(name: string, id: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entity';
  return `${normalized}-${id.slice(0, 8)}`;
}

export interface ParsedWorldBundle extends WorldBundle { assetFiles?: ReadonlyMap<string, Uint8Array>; }

export function parseBundleZip(data: Uint8Array): ParsedWorldBundle {
  if (data.length > 50 * 1024 * 1024) throw new Error('World Codex ZIP is too large');
  let offset = 0; let worldJson: string | undefined; let fileCount = 0; let totalUncompressed = 0; const assetFiles = new Map<string, Uint8Array>(); const archiveFiles = new Map<string, Buffer>();
  while (offset + 30 <= data.length) {
    const signature = readU32(data, offset);
    if (signature !== 0x04034b50) break;
    fileCount += 1;
    if (fileCount > 100) throw new Error('World Codex ZIP contains too many files');
    const method = readU16(data, offset + 8); const compressedSize = readU32(data, offset + 18); const uncompressedSize = readU32(data, offset + 22); const expectedCrc = readU32(data, offset + 14); const nameLength = readU16(data, offset + 26); const extraLength = readU16(data, offset + 28);
    totalUncompressed += uncompressedSize;
    if (uncompressedSize > 50 * 1024 * 1024 || totalUncompressed > 50 * 1024 * 1024 || (compressedSize > 0 && uncompressedSize / compressedSize > 1000)) throw new Error('World Codex ZIP entry is too large');
    const nameStart = offset + 30; const dataStart = nameStart + nameLength + extraLength; const name = Buffer.from(data.subarray(nameStart, nameStart + nameLength)).toString('utf8');
    if (!/^(?:\p{L}|\p{N})[\p{L}\p{N}._/-]*$/u.test(name) || name.includes('..') || name.startsWith('/') || name.includes('//')) throw new Error('Invalid World Codex ZIP path');
    if (archiveFiles.has(name)) throw new Error('World Codex ZIP contains duplicate file');
    if (dataStart + compressedSize > data.length) throw new Error('Invalid World Codex ZIP bounds');
    const compressed = data.subarray(dataStart, dataStart + compressedSize); const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: 50 * 1024 * 1024 }) : undefined;
    if (!content || content.length !== uncompressedSize || crc32(content) !== expectedCrc) throw new Error('Invalid World Codex ZIP entry');
    archiveFiles.set(name, Buffer.from(content));
    if (name === 'world.json') { if (worldJson !== undefined) throw new Error('World Codex ZIP contains duplicate world.json'); worldJson = Buffer.from(content).toString('utf8'); }
    else if (/^assets\/[^/]+\.bin$/.test(name)) { const assetId = name.slice('assets/'.length, -'.bin'.length); if (assetFiles.has(assetId)) throw new Error('World Codex ZIP contains duplicate asset'); assetFiles.set(assetId, Buffer.from(content)); }
    offset = dataStart + compressedSize;
  }
  if (!worldJson) throw new Error('World Codex ZIP is missing world.json');
  const bundle = parseBundle(worldJson) as ParsedWorldBundle;
  const manifestBytes = archiveFiles.get('manifest.json');
  if (manifestBytes) {
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as { format?: unknown; version?: unknown; sourceHash?: unknown; files?: unknown };
      if (manifest.format !== bundle.format || manifest.version !== bundle.version || manifest.sourceHash !== bundleHash(bundle) || !Array.isArray(manifest.files) || manifest.files.some((file) => typeof file !== 'string' || !archiveFiles.has(file))) throw new Error('manifest mismatch');
    } catch { throw new Error('Invalid World Codex manifest'); }
  }
  const checksumBytes = archiveFiles.get('checksums.sha256');
  if (checksumBytes) {
    const checked = new Set<string>();
    for (const line of checksumBytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      const checksumName = match?.[2];
      if (!match || checksumName === undefined || checksumName === 'checksums.sha256' || checked.has(checksumName) || !archiveFiles.has(checksumName)) throw new Error('Invalid World Codex checksum manifest');
      if (createHash('sha256').update(archiveFiles.get(checksumName)!).digest('hex') !== match[1]) throw new Error('World Codex checksum mismatch');
      checked.add(checksumName);
    }
    for (const name of archiveFiles.keys()) if (name !== 'checksums.sha256' && !checked.has(name)) throw new Error('World Codex checksum manifest is incomplete');
  }
  for (const assetId of assetFiles.keys()) if (!bundle.assets.some((asset) => asset.id === assetId)) throw new Error('World Codex ZIP contains an asset file missing from world.json');
  Object.defineProperty(bundle, 'assetFiles', { value: assetFiles, enumerable: false });
  return bundle;
}

function concat(...parts: Uint8Array[]): Uint8Array { const total = parts.reduce((sum, part) => sum + part.length, 0); const output = Buffer.alloc(total); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU16(data: Uint8Array, offset: number): number { return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8); }
function readU32(data: Uint8Array, offset: number): number { return ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16) | ((data[offset + 3] ?? 0) << 24)) >>> 0; }

export function parseBundle(text: string): WorldBundle {
  if (text.length > 50 * 1024 * 1024) throw new Error('World Codex bundle is too large');
  const raw = JSON.parse(text) as Partial<WorldBundle>;
  if (!isRecord(raw) || raw.format !== 'world-codex.bundle' || raw.version !== 1 || !isRecord(raw.world) || !Array.isArray(raw.entities) || !Array.isArray(raw.entityTypes) || !Array.isArray(raw.facts) || !Array.isArray(raw.relationTypes) || !Array.isArray(raw.relations) || !Array.isArray(raw.events)) throw new Error('Invalid world bundle');
  const world = raw.world as Record<string, unknown>;
  if (typeof world.id !== 'string' || typeof world.name !== 'string' || typeof world.slug !== 'string' || typeof world.description !== 'string' || typeof world.genre !== 'string' || (world.canonStrategy !== 'strict' && world.canonStrategy !== 'lenient')) throw new Error('Invalid world bundle world');
  for (const [name, records] of [['entities', raw.entities], ['entityTypes', raw.entityTypes], ['entityTypeVersions', raw.entityTypeVersions], ['facts', raw.facts], ['relationTypes', raw.relationTypes], ['relations', raw.relations], ['events', raw.events], ['maps', raw.maps], ['mapLayers', raw.mapLayers], ['mapFeatures', raw.mapFeatures], ['assets', raw.assets], ['calendars', raw.calendars], ['calendarVersions', raw.calendarVersions], ['timelineBranches', raw.timelineBranches], ['claims', raw.claims], ['validationRules', raw.validationRules], ['works', raw.works], ['chapters', raw.chapters], ['scenes', raw.scenes], ['plotlines', raw.plotlines], ['foreshadowings', raw.foreshadowings]] as const) {
    if (records !== undefined && (!Array.isArray(records) || records.some((record) => !isRecord(record) || typeof record.id !== 'string'))) throw new Error(`Invalid world bundle ${name}`);
  }
  const defaults = emptyBundleCollections();
  return { ...raw, entityTypeVersions: Array.isArray(raw.entityTypeVersions) ? raw.entityTypeVersions : defaults.entityTypeVersions, maps: Array.isArray(raw.maps) ? raw.maps : defaults.maps, mapLayers: Array.isArray(raw.mapLayers) ? raw.mapLayers : defaults.mapLayers, mapFeatures: Array.isArray(raw.mapFeatures) ? raw.mapFeatures : defaults.mapFeatures, assets: Array.isArray(raw.assets) ? raw.assets : defaults.assets, calendars: Array.isArray(raw.calendars) ? raw.calendars : defaults.calendars, calendarVersions: Array.isArray(raw.calendarVersions) ? raw.calendarVersions : defaults.calendarVersions, timelineBranches: Array.isArray(raw.timelineBranches) ? raw.timelineBranches : defaults.timelineBranches, claims: Array.isArray(raw.claims) ? raw.claims : defaults.claims, validationRules: Array.isArray(raw.validationRules) ? raw.validationRules : defaults.validationRules, works: Array.isArray(raw.works) ? raw.works : defaults.works, chapters: Array.isArray(raw.chapters) ? raw.chapters : defaults.chapters, scenes: Array.isArray(raw.scenes) ? raw.scenes : defaults.scenes, plotlines: Array.isArray(raw.plotlines) ? raw.plotlines : defaults.plotlines, foreshadowings: Array.isArray(raw.foreshadowings) ? raw.foreshadowings : defaults.foreshadowings } as WorldBundle;
}

/**
 * Import the Markdown emitted by bundleToMarkdown, plus the intentionally
 * small human-editable subset of that format. The adapter creates a portable
 * bundle; the API still performs the normal inspect/validate/commit pipeline.
 */
export function parseMarkdownBundle(text: string): WorldBundle {
  if (text.length > 10 * 1024 * 1024) throw new Error('Markdown import is too large');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const sourceDigest = createHash('sha256').update(normalized).digest('hex');
  const frontmatter: Record<string, string> = {};
  let cursor = 0;
  if (lines[0]?.trim() === '---') {
    cursor = 1;
    while (cursor < lines.length && lines[cursor]?.trim() !== '---') {
      const line = lines[cursor] ?? '';
      const separator = line.indexOf(':');
      if (separator > 0) frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      cursor += 1;
    }
    if (lines[cursor]?.trim() !== '---') throw new Error('Markdown frontmatter is not closed');
    cursor += 1;
  }
  const supportedFrontmatter = new Set(['format', 'version', 'worldId', 'slug', 'genre', 'canonStrategy']);
  for (const key of Object.keys(frontmatter)) if (!supportedFrontmatter.has(key)) throw new Error(`Markdown frontmatter field is unsupported: ${key}`);
  if (frontmatter.format !== undefined && frontmatter.format !== 'world-codex.markdown') throw new Error('Unsupported Markdown import format');
  if (frontmatter.version !== undefined && frontmatter.version !== '1') throw new Error('Unsupported Markdown import version');
  while (cursor < lines.length && !lines[cursor]?.startsWith('# ')) cursor += 1;
  if (cursor >= lines.length) throw new Error('Markdown import requires a world heading');
  const worldName = lines[cursor]!.slice(2).trim();
  if (!worldName || worldName.length > 300) throw new Error('Markdown world heading is invalid');
  cursor += 1;
  const descriptionLines: string[] = [];
  while (cursor < lines.length && !lines[cursor]?.startsWith('## ')) {
    if (lines[cursor]?.trim()) descriptionLines.push(lines[cursor]!.trim());
    cursor += 1;
  }
  const worldId = frontmatter.worldId?.trim() || stablePortableId(`markdown:world:${sourceDigest}`);
  const now = new Date(0);
  const world: World = { id: worldId, ownerId: null, name: worldName, slug: frontmatter.slug?.trim() || slugifyPortable(worldName), description: descriptionLines.join('\n').slice(0, 100_000), genre: frontmatter.genre?.trim() || 'Custom', canonStrategy: frontmatter.canonStrategy === 'lenient' ? 'lenient' : 'strict', currentTick: 0n, revision: 1n, createdAt: now, updatedAt: now };
  const entityTypes: EntityType[] = [];
  const entities: Entity[] = [];
  const typeIds = new Set<string>();
  const facts: Fact[] = [];
  const relationTypes: RelationType[] = [];
  const relations: Relation[] = [];
  const events: WorldEvent[] = [];
  const typeById = new Map<string, EntityType>();
  const ensureType = (id: string): EntityType => {
    if (!id || id.length > 100) throw new Error('Markdown entity type id is invalid');
    const existing = typeById.get(id);
    if (existing) return existing;
    const type: EntityType = { id, worldId, typeKey: id.slice(0, 100), label: id, schemaVersion: 1, schema: {}, createdAt: now, updatedAt: now };
    typeById.set(id, type); entityTypes.push(type); typeIds.add(id); return type;
  };
  while (cursor < lines.length) {
    const line = lines[cursor]?.trim() ?? '';
    if (line === '## Entities') {
      cursor += 1;
      while (cursor < lines.length && !lines[cursor]?.startsWith('## ')) {
        if (!lines[cursor]?.startsWith('### ')) { cursor += 1; continue; }
        const name = lines[cursor]!.slice(4).trim();
        if (!name || name.length > 300) throw new Error('Markdown entity heading is invalid');
        cursor += 1;
        while (cursor < lines.length && lines[cursor]?.trim() === '') cursor += 1;
        const metadata: Record<string, string> = {};
        if (lines[cursor]?.trim() === '```yaml') {
          cursor += 1;
          while (cursor < lines.length && lines[cursor]?.trim() !== '```') {
            const metadataLine = lines[cursor] ?? '';
            const separator = metadataLine.indexOf(':');
            if (separator > 0) metadata[metadataLine.slice(0, separator).trim()] = metadataLine.slice(separator + 1).trim();
            cursor += 1;
          }
          if (lines[cursor]?.trim() !== '```') throw new Error('Markdown entity metadata is not closed');
          cursor += 1;
        }
        const supportedMetadata = new Set(['id', 'typeId', 'canonStatus', 'parentEntityId']);
        for (const key of Object.keys(metadata)) if (!supportedMetadata.has(key)) throw new Error(`Markdown entity metadata field is unsupported: ${key}`);
        const documentLines: string[] = [];
        while (cursor < lines.length && !lines[cursor]?.startsWith('### ') && !lines[cursor]?.startsWith('## ')) {
          if (lines[cursor]?.trim()) documentLines.push(lines[cursor]!);
          cursor += 1;
        }
        const id = metadata.id?.trim() || stablePortableId(`markdown:entity:${worldId}:${entities.length}:${name}`);
        const typeId = metadata.typeId?.trim() || 'markdown_entity';
        ensureType(typeId);
        const status = parsePortableStatus(metadata.canonStatus);
        const parentEntityId = metadata.parentEntityId && metadata.parentEntityId !== 'null' ? metadata.parentEntityId : null;
        entities.push({ id, worldId, typeId, name, subtitle: '', parentEntityId, document: documentLines.length ? { markdown: documentLines.join('\n') } : {}, documentText: documentLines.join('\n').slice(0, 100_000), tags: [], canonStatus: status, revision: 1n, createdAt: now, updatedAt: now });
        continue;
      }
      continue;
    }
    if (line === '## Facts') {
      cursor += 1;
      while (cursor < lines.length && !lines[cursor]?.startsWith('## ')) {
        const raw = lines[cursor] ?? '';
        const match = /^-\s+([^·]+)\s+·\s+([^=]+?)\s*=\s*(.*)$/.exec(raw);
        if (raw.trim() && !match) throw new Error('Markdown fact row is invalid');
        if (match) facts.push({ id: stablePortableId(`markdown:fact:${worldId}:${facts.length}:${raw}`), worldId, subjectEntityId: match[1]!.trim(), predicateKey: match[2]!.trim().slice(0, 100), objectKind: 'scalar', value: match[3]!.trim(), canonStatus: 'draft', sourceKind: 'import', createdRevision: 1n });
        cursor += 1;
      }
      continue;
    }
    if (line === '## Relations') {
      cursor += 1;
      while (cursor < lines.length && !lines[cursor]?.startsWith('## ')) {
        const raw = lines[cursor] ?? '';
        const match = /^-\s+([^—]+)\s+—\[([^\]]+)\]→\s+([^:]+?)(?::\s*(.*))?$/.exec(raw);
        if (raw.trim() && !match) throw new Error('Markdown relation row is invalid');
        if (match) {
          const relationTypeId = match[2]!.trim();
          if (!relationTypes.some((type) => type.id === relationTypeId)) relationTypes.push({ id: relationTypeId, worldId, forwardLabel: relationTypeId, inverseLabel: relationTypeId, symmetric: false, sourceTypeIds: [], targetTypeIds: [] });
          relations.push({ id: stablePortableId(`markdown:relation:${worldId}:${relations.length}:${raw}`), worldId, sourceEntityId: match[1]!.trim(), targetEntityId: match[3]!.trim(), relationTypeId, description: match[4]?.trim() ?? '', canonStatus: 'draft', sourceKind: 'import', createdRevision: 1n });
        }
        cursor += 1;
      }
      continue;
    }
    if (line === '## Events') {
      cursor += 1;
      while (cursor < lines.length && !lines[cursor]?.startsWith('## ')) {
        const raw = lines[cursor] ?? '';
        const match = /^-\s+(-?\d+)\s+·\s+(.+?)\s+\(([^)]+)\)(?::\s*(.*))?$/.exec(raw);
        if (raw.trim() && !match) throw new Error('Markdown event row is invalid');
        if (match) events.push({ id: stablePortableId(`markdown:event:${worldId}:${events.length}:${raw}`), worldId, name: match[2]!.trim(), eventType: match[3]!.trim(), startTick: BigInt(match[1]!), participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: match[4]?.trim() ?? '', canonStatus: 'draft', createdRevision: 1n });
        cursor += 1;
      }
      continue;
    }
    cursor += 1;
  }
  if (entities.length > 50_000 || facts.length > 100_000 || relations.length > 200_000 || events.length > 100_000) throw new Error('Markdown import contains too many records');
  return createBundle({ world, entityTypes: [...entityTypes, ...[...typeIds].filter((id) => !entityTypes.some((type) => type.id === id)).map((id) => ensureType(id))], entities, facts, relationTypes, relations, events });
}

/** Import a bounded entities CSV with columns id,name,typeId,canonStatus,parentEntityId,documentText,tags. */
export function parseCsvBundle(text: string, options: { worldName?: string; description?: string } = {}): WorldBundle {
  if (text.length > 10 * 1024 * 1024) throw new Error('CSV import is too large');
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('CSV import is empty');
  const header = rows[0]!.map((value) => value.trim());
  const required = ['name', 'typeId'];
  if (header.some((value, index) => !value || header.indexOf(value) !== index) || required.some((field) => !header.includes(field))) throw new Error('CSV header must include unique name and typeId columns');
  const supportedColumns = new Set(['id', 'name', 'typeId', 'canonStatus', 'parentEntityId', 'documentText', 'tags']);
  for (const column of header) if (!supportedColumns.has(column)) throw new Error(`CSV column is unsupported: ${column}`);
  if (rows.length > 50_001) throw new Error('CSV import contains too many rows');
  const sourceDigest = createHash('sha256').update(text).digest('hex');
  const worldId = stablePortableId(`csv:world:${sourceDigest}:${options.worldName ?? ''}:${options.description ?? ''}`);
  const now = new Date(0);
  const worldName = options.worldName?.trim() || 'Imported CSV World';
  const world: World = { id: worldId, ownerId: null, name: worldName, slug: slugifyPortable(worldName), description: options.description?.slice(0, 100_000) ?? '', genre: 'Custom', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: now, updatedAt: now };
  const index = new Map(header.map((key, position) => [key, position]));
  const entityTypes = new Map<string, EntityType>();
  const entities: Entity[] = [];
  const entityIds = new Set<string>();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.length !== header.length) throw new Error(`CSV row ${rowIndex + 1} has the wrong column count`);
    const value = (key: string): string => row[index.get(key) ?? -1]?.trim() ?? '';
    const name = value('name'); const typeId = value('typeId');
    if (!name || name.length > 300 || !typeId || typeId.length > 100) throw new Error(`CSV row ${rowIndex + 1} has an invalid name or typeId`);
    const id = value('id') || stablePortableId(`csv:entity:${worldId}:${rowIndex}`);
    if (entityIds.has(id)) throw new Error(`CSV contains duplicate entity id ${id}`);
    entityIds.add(id);
    if (!entityTypes.has(typeId)) entityTypes.set(typeId, { id: typeId, worldId, typeKey: typeId, label: typeId, schemaVersion: 1, schema: {}, createdAt: now, updatedAt: now });
    const documentText = value('documentText').slice(0, 100_000);
    const tags = value('tags').split('|').map((tag) => tag.trim()).filter(Boolean).slice(0, 100);
    const parent = value('parentEntityId');
    entities.push({ id, worldId, typeId, name, subtitle: '', ...(parent ? { parentEntityId: parent } : { parentEntityId: null }), document: documentText ? { markdown: documentText } : {}, documentText, tags, canonStatus: parsePortableStatus(value('canonStatus')), revision: 1n, createdAt: now, updatedAt: now });
  }
  return createBundle({ world, entityTypes: [...entityTypes.values()], entities, facts: [], relationTypes: [], relations: [], events: [] });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
    if (field.length > 100_000) throw new Error('CSV field is too large');
  }
  if (quoted) throw new Error('CSV quoted field is not closed');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((candidate) => candidate.some((value) => value.trim()));
}

function parsePortableStatus(value: string | undefined): Entity['canonStatus'] {
  return value === 'pending' || value === 'canon' || value === 'retconned' || value === 'archived' ? value : 'draft';
}

function slugifyPortable(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || `import-${randomUUID().slice(0, 8)}`;
}

function stablePortableId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
