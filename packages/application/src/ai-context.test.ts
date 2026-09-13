import { describe, expect, it } from 'vitest';
import { buildCanonContext } from './ai-context';
import type { Entity, Fact, Relation, World, WorldEvent } from '@world-codex/domain';

const world = { id: 'world-1', name: 'Context', currentTick: 0n, revision: 3n } as World;
const entity = (id: string, canonStatus: Entity['canonStatus']): Entity => ({ id, worldId: world.id, typeId: 'type', name: id, subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [], canonStatus, revision: 1n, createdAt: new Date(0), updatedAt: new Date(0) });
const fact = (id: string, subjectEntityId: string, canonStatus: Fact['canonStatus'], validFromTick?: bigint, validToTick?: bigint): Fact => ({ id, worldId: world.id, subjectEntityId, predicateKey: 'status', objectKind: 'scalar', value: id, ...(validFromTick === undefined ? {} : { validFromTick }), ...(validToTick === undefined ? {} : { validToTick }), canonStatus, sourceKind: 'manual' });
const relation = (id: string, sourceEntityId: string, targetEntityId: string, canonStatus: Relation['canonStatus'], validFromTick?: bigint, validToTick?: bigint): Relation => ({ id, worldId: world.id, sourceEntityId, targetEntityId, relationTypeId: 'relation-type', description: '', ...(validFromTick === undefined ? {} : { validFromTick }), ...(validToTick === undefined ? {} : { validToTick }), canonStatus });
const event = (id: string, startTick: bigint, endTick: bigint | undefined, canonStatus: WorldEvent['canonStatus']): WorldEvent => ({ id, worldId: world.id, name: id, eventType: 'test', startTick, ...(endTick === undefined ? {} : { endTick }), participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus });

describe('buildCanonContext', () => {
  it('keeps only canon records active at the requested tick and bounds search', () => {
    const result = buildCanonContext({
      world,
      entities: [entity('canon-entity', 'canon'), entity('draft-entity', 'draft')],
      facts: [fact('active-fact', 'canon-entity', 'canon', 0n, 10n), fact('future-fact', 'canon-entity', 'canon', 10n), fact('draft-fact', 'canon-entity', 'draft', 0n)],
      relations: [relation('active-relation', 'canon-entity', 'canon-entity', 'canon', 0n, 10n), relation('future-relation', 'canon-entity', 'canon-entity', 'canon', 10n)],
      events: [event('active-event', 5n, 8n, 'canon'), event('draft-event', 5n, 8n, 'draft')],
      search: [{ kind: 'entity', id: 'canon-entity', title: 'canon', snippet: '' }, { kind: 'entity', id: 'draft-entity', title: 'draft', snippet: '' }],
      atTick: 6n,
    });
    expect((result.entities as Entity[]).map((item) => item.id)).toEqual(['canon-entity']);
    expect((result.facts as Fact[]).map((item) => item.id)).toEqual(['active-fact']);
    expect((result.relations as Relation[]).map((item) => item.id)).toEqual(['active-relation']);
    expect((result.events as WorldEvent[]).map((item) => item.id)).toEqual(['active-event']);
    expect(result.search).toEqual([{ kind: 'entity', id: 'canon-entity', title: 'canon', snippet: '' }]);
    expect(result.atTick).toBe('6');
  });
});
