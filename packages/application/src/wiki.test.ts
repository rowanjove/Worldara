import { describe, expect, it } from 'vitest';
import { WorldApplicationService } from './service';
import { InMemoryWorldRepository } from './memory-repository';

function setup() {
  const repo = new InMemoryWorldRepository();
  const app = new WorldApplicationService(repo, { next: () => crypto.randomUUID() }, { now: () => new Date('2026-01-01T00:00:00.000Z') });
  return app;
}

describe('wiki backlinks and unlinked mentions', () => {
  it('detects unlinked names, links them, and records reverse links', async () => {
    const app = setup();
    const world = await app.createWorld({ name: 'Wiki', slug: 'wiki' });
    const type = await app.createEntityType(world.id, { typeKey: 'person', label: 'Person', schema: {} }, 1n);
    const arlen = await app.createEntityDraft(world.id, { typeId: type.id, name: '阿伦', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [] }, 2n);
    const tower = await app.createEntityDraft(world.id, { typeId: type.id, name: '黑塔', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [] }, 3n);
    await app.updateEntityDraft(world.id, arlen.id, { document: { markdown: '阿伦进入黑塔。' }, documentText: '阿伦进入黑塔。' }, 4n);
    const unlinked = await app.listUnlinkedMentions(world.id, arlen.id);
    expect(unlinked.map((item) => item.name)).toContain('黑塔');
    const linked = await app.linkEntityMention(world.id, arlen.id, '黑塔', 5n);
    expect(linked.documentText).toContain('[[黑塔]]');
    expect(await app.listUnlinkedMentions(world.id, arlen.id)).toEqual([]);
    const backlinks = await app.listEntityBacklinks(world.id, tower.id);
    expect(backlinks.map((item) => item.entityId)).toEqual([arlen.id]);
    const outgoing = await app.listResolvedOutgoingLinks(world.id, arlen.id);
    expect(outgoing[0]?.entityId).toBe(tower.id);
  });
});
