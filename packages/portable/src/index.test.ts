import { describe, expect, it } from 'vitest';
import { bundleHash, bundleToGeoJson, bundleToJson, bundleToMarkdown, bundleToObsidianZip, bundleToZip, createBundle, parseBundle, parseBundleZip, parseCsvBundle, parseMarkdownBundle } from './index';

describe('world bundle', () => {
  it('round-trips the envelope and produces a stable hash independent of export time', () => {
    const bundle = createBundle({ world: { id: 'w', ownerId: null, name: 'W', slug: 'w', description: '', genre: 'Custom', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }, entityTypes: [], entities: [], facts: [], relationTypes: [], relations: [], events: [] });
    const parsed = parseBundle(bundleToJson(bundle));
    expect(parsed.format).toBe('world-codex.bundle');
    expect(parsed.maps).toEqual([]);
    expect(parsed.mapFeatures).toEqual([]);
    expect(parsed.timelineBranches).toEqual([]);
    expect(parsed.claims).toEqual([]);
    expect(parsed.validationRules).toEqual([]);
    expect(parsed.works).toEqual([]);
    expect(parsed.chapters).toEqual([]);
    expect(parsed.scenes).toEqual([]);
    expect(parsed.plotlines).toEqual([]);
    expect(parsed.foreshadowings).toEqual([]);
    expect(bundleHash(bundle)).toBe(bundleHash({ ...bundle, exportedAt: 'later' }));
    expect(bundleToMarkdown(bundle)).toContain('# W');
    expect(bundleToGeoJson(bundle).features).toEqual([]);
    const zip = bundleToZip(bundle);
    expect(Buffer.from(zip).subarray(0, 2).toString()).toBe('PK');
    expect(Buffer.from(zip).includes(Buffer.from('checksums.sha256'))).toBe(true);
    expect(parseBundleZip(zip).world.id).toBe('w');
  });

  it('carries controlled asset files in the ZIP and rejects no-path ambiguity', () => {
    const asset = { id: 'asset-1', worldId: 'w', storageKey: 'w/abc.png', mediaType: 'image/png', byteSize: 4n, sha256: 'a'.repeat(64), metadata: {}, scanStatus: 'passed' as const, scanMessage: 'ok', createdAt: new Date('2026-01-01') };
    const bundle = createBundle({ world: { id: 'w', ownerId: null, name: 'W', slug: 'w', description: '', genre: 'Custom', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }, entityTypes: [], entities: [], facts: [], relationTypes: [], relations: [], events: [], assets: [asset] });
    const zip = bundleToZip(bundle, new Map([['asset-1', Uint8Array.from([1, 2, 3, 4])]]));
    const parsed = parseBundleZip(zip);
    expect(parsed.assets).toHaveLength(1);
    expect(Array.from(parsed.assetFiles?.get('asset-1') ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('round-trips the exported Markdown into an inspectable bundle', () => {
    const bundle = createBundle({ world: { id: 'w', ownerId: null, name: 'Markdown World', slug: 'markdown-world', description: 'A world', genre: 'Fantasy', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }, entityTypes: [{ id: 'character', worldId: 'w', typeKey: 'character', label: 'Character', schemaVersion: 1, schema: {}, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }], entities: [{ id: 'entity-1', worldId: 'w', typeId: 'character', name: 'A', subtitle: '', parentEntityId: null, document: {}, documentText: 'Body', tags: [], canonStatus: 'draft', revision: 1n, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }], facts: [], relationTypes: [], relations: [], events: [] });
    const parsed = parseMarkdownBundle(bundleToMarkdown(bundle));
    expect(parsed.world).toMatchObject({ id: 'w', name: 'Markdown World', slug: 'markdown-world' });
    expect(parsed.entities[0]).toMatchObject({ id: 'entity-1', name: 'A', typeId: 'character', documentText: 'Body' });
  });

  it('imports a bounded entities CSV with quoted fields and tags', () => {
    const csv = 'id,name,typeId,canonStatus,parentEntityId,documentText,tags\nentity-1,"A, Prime",character,draft,,"line one, line two",one|two\n';
    const parsed = parseCsvBundle(csv);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]).toMatchObject({ id: 'entity-1', name: 'A, Prime', typeId: 'character', tags: ['one', 'two'], documentText: 'line one, line two' });
    expect(parsed.entityTypes[0]).toMatchObject({ id: 'character', typeKey: 'character' });
    expect(parseCsvBundle(csv).world.id).toBe(parsed.world.id);
    expect(bundleHash(parseCsvBundle(csv))).toBe(bundleHash(parsed));
  });

  it('rejects unsupported CSV columns instead of silently dropping data', () => {
    expect(() => parseCsvBundle('name,typeId,unknown\nA,character,value\n')).toThrow('unsupported');
    expect(() => parseMarkdownBundle('---\nformat: world-codex.markdown\nextra: value\n---\n# World\n')).toThrow('unsupported');
  });

  it('exports an Obsidian-compatible vault alongside the canonical ZIP', () => {
    const bundle = createBundle({ world: { id: 'w', ownerId: null, name: 'Vault World', slug: 'vault-world', description: '', genre: 'Custom', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }, entityTypes: [{ id: 'character', worldId: 'w', typeKey: 'character', label: 'Character', schemaVersion: 1, schema: {}, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }], entities: [{ id: '12345678-1234-4234-8234-123456789012', worldId: 'w', typeId: 'character', name: '北辰/皇帝', subtitle: '', parentEntityId: null, document: {}, documentText: 'Body', tags: [], canonStatus: 'draft', revision: 1n, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }], facts: [], relationTypes: [], relations: [], events: [] });
    const archive = bundleToObsidianZip(bundle);
    expect(archive.length).toBeGreaterThan(0);
    expect(parseBundleZip(archive).world.name).toBe('Vault World');
  });

  it('parses the structured Markdown fact, relation, and event subset', () => {
    const parsed = parseMarkdownBundle('# World\n\n## Entities\n\n### A\n```yaml\nid: a\ntypeId: character\n```\n\n### B\n```yaml\nid: b\ntypeId: character\n```\n\n## Facts\n\n- a · title = captain\n\n## Relations\n\n- a —[knows]→ b: trusted\n\n## Events\n\n- 0 · Meeting (social): met\n');
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.events).toHaveLength(1);
  });

  it('round-trips claims, rules, branches, and narrative records in the canonical JSON envelope', () => {
    const now = new Date('2026-01-01');
    const bundle = createBundle({
      world: { id: 'w', ownerId: null, name: 'W', slug: 'w', description: '', genre: 'Custom', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: now, updatedAt: now },
      entityTypes: [],
      entities: [],
      facts: [],
      relationTypes: [],
      relations: [],
      events: [],
      timelineBranches: [{ id: '00000000-0000-0000-0000-000000000001', worldId: 'w', name: 'main', parentBranchId: null, forkTick: null, forkRevision: null, status: 'main', createdAt: now }],
      claims: [{ id: 'claim-1', worldId: 'w', predicateKey: 'death_cause', objectKind: 'scalar', value: 'poison', knownByEntityIds: [], truthStatus: 'true', claimKind: 'secret', sourceRefs: [], canonStatus: 'draft', createdAt: now, updatedAt: now }],
      validationRules: [{ id: 'rule-1', worldId: 'w', name: 'human-max-age', severity: 'warning', target: 'entity', assert: { duration_between: { from: 'birth_date', to: 'death_date', lte: 180 } }, enabled: true, createdAt: now, updatedAt: now }],
      works: [{ id: 'work-1', worldId: 'w', title: 'Book', type: 'novel', createdAt: now, updatedAt: now }],
      chapters: [{ id: 'ch-1', worldId: 'w', workId: 'work-1', title: 'Ch 1', orderIndex: 0, createdAt: now, updatedAt: now }],
      scenes: [{ id: 'scene-1', worldId: 'w', workId: 'work-1', chapterId: 'ch-1', orderIndex: 0, participantEntityIds: [], proseText: 'Once.', status: 'draft', createdAt: now, updatedAt: now }],
      plotlines: [{ id: 'plot-1', worldId: 'w', title: 'Arc', summary: '', status: 'active', currentStage: 'setup', characterEntityIds: [], eventIds: [], createdAt: now, updatedAt: now }],
      foreshadowings: [{ id: 'foreshadow-1', worldId: 'w', title: 'Hint', description: '', setupSceneId: 'scene-1', relatedEntityIds: [], status: 'open', createdAt: now, updatedAt: now }],
    });
    const parsed = parseBundle(bundleToJson(bundle));
    expect(parsed.claims[0]?.predicateKey).toBe('death_cause');
    expect(parsed.validationRules[0]?.name).toBe('human-max-age');
    expect(parsed.works[0]?.title).toBe('Book');
    expect(parsed.chapters[0]?.workId).toBe('work-1');
    expect(parsed.scenes[0]?.chapterId).toBe('ch-1');
    expect(parsed.plotlines[0]?.title).toBe('Arc');
    expect(parsed.foreshadowings[0]?.setupSceneId).toBe('scene-1');
    expect(parsed.timelineBranches[0]?.name).toBe('main');
    expect(parseBundleZip(bundleToZip(bundle)).claims).toHaveLength(1);
  });
});
