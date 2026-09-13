import { describe, expect, it } from 'vitest';
import type { WorldRepository } from './ports';
import type { TemporalRepository } from './temporal-ports';
import { WorldApplicationService } from './service';
import { TemporalApplicationService } from './temporal-service';

export type ContractRepository = WorldRepository & TemporalRepository;

function uniqueSlug(base: string): string {
  return `${base}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function registerRepositoryContract(label: string, createRepository: () => ContractRepository): void {
  const setup = () => {
    const repo = createRepository();
    const ids = { next: () => crypto.randomUUID() };
    const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
    return {
      repo,
      app: new WorldApplicationService(repo, ids, clock),
      temporal: new TemporalApplicationService(repo, ids, clock),
    };
  };

  const revision = async (app: WorldApplicationService, worldId: string): Promise<bigint> => (await app.getWorld(worldId)).revision;

  describe(`repository contract (${label})`, () => {
    it('creates, reads, and isolates worlds', async () => {
      const { app } = setup();
      const world = await app.createWorld({ name: 'North', slug: uniqueSlug('north') });
      const other = await app.createWorld({ name: 'South', slug: uniqueSlug('south') });
      const listed = (await app.listWorlds()).map((item) => item.id);
      expect(listed).toContain(world.id);
      expect(listed).toContain(other.id);
      expect((await app.getWorld(world.id)).name).toBe('North');
      const type = await app.createEntityType(world.id, { typeKey: 'person', label: 'Person', schema: {} }, 1n);
      await app.createEntityDraft(world.id, { typeId: type.id, name: 'Hero', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [] }, await revision(app, world.id));
      expect(await app.listEntities(other.id)).toEqual([]);
    });

    it('rejects stale revisions and records a revision log', async () => {
      const { app } = setup();
      const world = await app.createWorld({ name: 'Rev', slug: uniqueSlug('rev') });
      const type = await app.createEntityType(world.id, { typeKey: 'person', label: 'Person', schema: {} }, 1n);
      const entity = await app.createEntityDraft(world.id, { typeId: type.id, name: 'Hero', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [] }, 2n);
      await expect(app.updateEntityDraft(world.id, entity.id, { subtitle: 'old' }, 2n)).rejects.toThrow(/revision/i);
      await app.updateEntityDraft(world.id, entity.id, { subtitle: 'new' }, 3n);
      expect((await app.listRevisions(world.id, 20)).length).toBeGreaterThanOrEqual(3);
    });

    it('stores facts, single-sided relations, events, and snapshot slices', async () => {
      const { app, temporal } = setup();
      const world = await app.createWorld({ name: 'Time', slug: uniqueSlug('time') });
      const type = await app.createEntityType(world.id, { typeKey: 'person', label: 'Person', schema: {} }, 1n);
      const hero = await app.createEntityDraft(world.id, { typeId: type.id, name: 'Hero', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [] }, 2n);
      const city = await app.createEntityDraft(world.id, { typeId: type.id, name: 'City', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [] }, 3n);
      await temporal.createFact(world.id, { subjectEntityId: hero.id, predicateKey: 'title', objectKind: 'scalar', value: 'captain', sourceKind: 'manual', validFromTick: 10n }, 4n);
      const relationType = await temporal.createRelationType(world.id, { forwardLabel: 'rules', inverseLabel: 'ruled by' }, 5n);
      await temporal.createRelation(world.id, { sourceEntityId: hero.id, targetEntityId: city.id, relationTypeId: relationType.id, description: '' }, 6n);
      await temporal.createEvent(world.id, { name: 'Coronation', eventType: 'court', startTick: 10n, participantIds: [hero.id], locationEntityIds: [city.id], causeEventIds: [], resultEventIds: [], effects: [], description: '' }, 7n);
      expect(await temporal.listFacts(world.id)).toHaveLength(1);
      expect(await temporal.listRelations(world.id)).toHaveLength(1);
      expect(await temporal.listEvents(world.id)).toHaveLength(1);
      const state = await temporal.getSnapshot(world.id, 10n);
      expect(state.facts[0]?.value).toBe('captain');
      expect(state.events).toHaveLength(1);
    });

    it('blocks writes on archived worlds and removes them on delete', async () => {
      const { app } = setup();
      const world = await app.createWorld({ name: 'Gone', slug: uniqueSlug('gone') });
      await app.archiveWorld(world.id, 1n, true);
      await expect(app.createEntityType(world.id, { typeKey: 'x', label: 'X', schema: {} }, 2n)).rejects.toThrow();
      await app.removeWorld(world.id);
      await expect(app.getWorld(world.id)).rejects.toThrow(/not found/i);
    });
  });
}
