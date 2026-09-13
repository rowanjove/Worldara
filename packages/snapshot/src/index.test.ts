import { describe, expect, it } from 'vitest';
import { computeSnapshot } from './index';
import type { Entity, Fact, MapFeature, Relation, RelationType, World, WorldEvent } from '@world-codex/domain';

const now = new Date('2026-09-07T00:00:00.000Z');
const world: World = { id: 'w', ownerId: null, name: 'W', slug: 'w', description: '', genre: 'Custom', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: now, updatedAt: now };
const entity = (id: string): Entity => ({ id, worldId: world.id, typeId: 't', name: id, subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [], canonStatus: 'canon', revision: 1n, createdAt: now, updatedAt: now });
const fact: Fact = { id: 'f', worldId: world.id, subjectEntityId: 'a', predicateKey: 'title', objectKind: 'scalar', value: 'ruler', validFromTick: 10n, validToTick: 20n, canonStatus: 'canon', sourceKind: 'manual' };
const relation: Relation = { id: 'r', worldId: world.id, sourceEntityId: 'a', targetEntityId: 'b', relationTypeId: 'ally', description: '', validFromTick: 0n, validToTick: 30n, canonStatus: 'canon' };
const relationType: RelationType = { id: 'ally', worldId: world.id, forwardLabel: 'ally', inverseLabel: 'ally', symmetric: true, sourceTypeIds: [], targetTypeIds: [] };
const event: WorldEvent = { id: 'e', worldId: world.id, name: 'event', eventType: 'custom', startTick: 15n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' };

describe('snapshot', () => {
  it('composes state at a tick without mutating input', () => {
    const result = computeSnapshot(world, 15n, [entity('a'), entity('b')], [fact], [relation], [relationType], [event]);
    expect(result.facts).toHaveLength(1);
    expect(result.relations[0]?.sourceName).toBe('a');
    expect(result.activeEvents).toHaveLength(1);
  });

  it('projects Canon event effects without mutating source records', () => {
    const move: WorldEvent = { id: 'e2', worldId: world.id, name: 'Move', eventType: 'change', startTick: 20n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'fx', type: 'MOVE_ENTITY', targetId: 'a', payload: { locationEntityId: 'b' }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const result = computeSnapshot(world, 20n, [entity('a'), entity('b')], [], [], [], [move]);
    expect(result.facts[0]).toMatchObject({ predicateKey: 'location', subjectEntityId: 'a', objectEntityId: 'b', validFromTick: 20n });
    expect(move.effects[0]?.payload).toEqual({ locationEntityId: 'b' });
  });

  it('closes the previous location when an entity moves again', () => {
    const first: WorldEvent = { id: 'e3', worldId: world.id, name: 'Move 1', eventType: 'change', startTick: 10n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'fx-1', type: 'MOVE_ENTITY', targetId: 'a', payload: { locationEntityId: 'b' }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const second: WorldEvent = { id: 'e4', worldId: world.id, name: 'Move 2', eventType: 'change', startTick: 20n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'fx-2', type: 'MOVE_ENTITY', targetId: 'a', payload: { locationEntityId: 'c' }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const result = computeSnapshot(world, 20n, [entity('a'), entity('b'), entity('c')], [], [], [], [first, second]);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({ objectEntityId: 'c', validFromTick: 20n });
  });

  it('clears a stale entity reference when SET_FACT changes to a scalar', () => {
    const factWithEntity: Fact = { ...fact, objectKind: 'entity', objectEntityId: 'b', value: null };
    const change: WorldEvent = { id: 'e5', worldId: world.id, name: 'Reveal', eventType: 'change', startTick: 12n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'fx-3', type: 'SET_FACT', targetId: 'f', payload: { objectKind: 'scalar', value: 'new' }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const result = computeSnapshot(world, 12n, [entity('a'), entity('b')], [factWithEntity], [], [], [change]);
    expect(result.facts[0]).toMatchObject({ id: 'effect:fx-3', objectKind: 'scalar', value: 'new', validFromTick: 12n, validToTick: 20n, sourceKind: 'event', sourceRefId: 'e5' });
    expect(result.facts[0]).not.toHaveProperty('objectEntityId');
    expect(factWithEntity.validToTick).toBe(20n);
  });

  it('does not duplicate effects that were already materialized at Canon promotion', () => {
    const current: Fact = { id: 'current', worldId: world.id, subjectEntityId: 'a', predicateKey: 'title', objectKind: 'scalar', value: 'before', validFromTick: 0n, validToTick: 12n, canonStatus: 'canon', sourceKind: 'manual' };
    const materialized: Fact = { id: 'fx-set', worldId: world.id, subjectEntityId: 'a', predicateKey: 'title', objectKind: 'scalar', value: 'after', validFromTick: 12n, canonStatus: 'canon', sourceKind: 'event' };
    const moved: Fact = { id: 'fx-move', worldId: world.id, subjectEntityId: 'a', predicateKey: 'location', objectKind: 'entity', objectEntityId: 'b', value: null, validFromTick: 12n, canonStatus: 'canon', sourceKind: 'event' };
    const materializedRelation: Relation = { id: 'fx-relation', worldId: world.id, sourceEntityId: 'a', targetEntityId: 'b', relationTypeId: 'ally', description: '', validFromTick: 12n, canonStatus: 'canon' };
    const change: WorldEvent = { id: 'e6', worldId: world.id, name: 'Materialized', eventType: 'change', startTick: 12n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [
      { id: 'fx-set', type: 'SET_FACT', targetId: 'current', payload: { value: 'after' }, sequence: 0 },
      { id: 'fx-move', type: 'MOVE_ENTITY', targetId: 'a', payload: { locationEntityId: 'b' }, sequence: 1 },
      { id: 'fx-relation', type: 'ADD_RELATION', payload: { sourceEntityId: 'a', targetEntityId: 'b', relationTypeId: 'ally' }, sequence: 2 },
    ], description: '', canonStatus: 'canon' };
    const result = computeSnapshot(world, 12n, [entity('a'), entity('b')], [current, materialized, moved], [materializedRelation], [relationType], [change]);
    expect(result.facts.map((item) => item.id).sort()).toEqual(['fx-move', 'fx-set']);
    expect(result.relations.map((item) => item.id)).toEqual(['fx-relation']);
  });

  it('does not apply Pending event effects', () => {
    const pending: WorldEvent = { id: 'pending', worldId: world.id, name: 'Pending', eventType: 'change', startTick: 0n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'pending-fx', type: 'ARCHIVE_ENTITY', targetId: 'a', payload: {}, sequence: 0 }], description: '', canonStatus: 'pending' };
    const result = computeSnapshot(world, 10n, [entity('a')], [], [], [], [pending]);
    expect(result.entities).toHaveLength(1);
  });

  it('projects SET_FIELD entity updates without mutating source records', () => {
    const change: WorldEvent = { id: 'e-field', worldId: world.id, name: 'Reveal', eventType: 'change', startTick: 12n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'field-fx', type: 'SET_FIELD', targetId: 'a', payload: { field: 'status', value: 'active' }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const source = entity('a');
    const result = computeSnapshot(world, 12n, [source], [], [], [], [change]);
    expect(result.entities[0]?.document).toEqual({ status: 'active' });
    expect(result.entities[0]?.documentText).toContain('active');
    expect(source.document).toEqual({});
  });

  it('projects geometry changes with a temporal range', () => {
    const feature: MapFeature = { id: 'feature', worldId: world.id, mapId: 'map', entityId: 'a', kind: 'marker', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {}, validFromTick: 0n, createdAt: now, updatedAt: now };
    const change: WorldEvent = { id: 'e7', worldId: world.id, name: 'Move marker', eventType: 'change', startTick: 10n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'geometry-fx', type: 'CHANGE_GEOMETRY', targetId: feature.id, payload: { geometry: { type: 'Point', coordinates: [7, 9] } }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const result = computeSnapshot(world, 10n, [entity('a')], [], [], [], [change], [feature]);
    expect(result.mapFeatures).toHaveLength(1);
    expect(result.mapFeatures[0]).toMatchObject({ validFromTick: 10n, geometry: { coordinates: [7, 9] } });
  });

  it('supports bi-temporal historical snapshot retrieval across revisions', () => {
    // Revision 1: King is Arthur, valid tick 100 to 200
    const arthur: Fact = {
      id: 'fact-arthur', worldId: world.id, subjectEntityId: 'a', predicateKey: 'king',
      objectKind: 'scalar', value: 'Arthur', validFromTick: 100n, validToTick: 200n,
      canonStatus: 'canon', sourceKind: 'manual',
      createdRevision: 1n, revisionFrom: 1n, retconnedRevision: 2n, revisionTo: 2n,
    };
    // Revision 2: Author corrects record: King is Lancelot, valid tick 150 to 200
    const lancelot: Fact = {
      id: 'fact-lancelot', worldId: world.id, subjectEntityId: 'a', predicateKey: 'king',
      objectKind: 'scalar', value: 'Lancelot', validFromTick: 150n, validToTick: 200n,
      canonStatus: 'canon', sourceKind: 'manual',
      createdRevision: 2n, revisionFrom: 2n, revisionTo: null,
    };

    // Snapshot at tick 160 as of Revision 1 -> Arthur
    const snapRev1 = computeSnapshot(world, 160n, [entity('a')], [arthur, lancelot], [], [], [], [], { asOfRevision: 1n });
    expect(snapRev1.facts).toHaveLength(1);
    expect(snapRev1.facts[0]?.value).toBe('Arthur');
    expect(snapRev1.asOfRevision).toBe(1n);

    // Snapshot at tick 160 as of Revision 2 -> Lancelot
    const snapRev2 = computeSnapshot(world, 160n, [entity('a')], [arthur, lancelot], [], [], [], [], { asOfRevision: 2n });
    expect(snapRev2.facts).toHaveLength(1);
    expect(snapRev2.facts[0]?.value).toBe('Lancelot');
    expect(snapRev2.asOfRevision).toBe(2n);
  });

  it('isolates facts and events between different timeline branches', () => {
    const mainFact: Fact = {
      id: 'fact-main', worldId: world.id, branchId: '00000000-0000-0000-0000-000000000001',
      subjectEntityId: 'a', predicateKey: 'state', objectKind: 'scalar', value: 'peace',
      validFromTick: 0n, canonStatus: 'canon', sourceKind: 'manual',
    };
    const alternateFact: Fact = {
      id: 'fact-alt', worldId: world.id, branchId: 'branch-what-if-war',
      subjectEntityId: 'a', predicateKey: 'state', objectKind: 'scalar', value: 'war',
      validFromTick: 0n, canonStatus: 'canon', sourceKind: 'manual',
    };

    const mainSnap = computeSnapshot(world, 10n, [entity('a')], [mainFact, alternateFact], [], [], [], [], { branchId: '00000000-0000-0000-0000-000000000001' });
    expect(mainSnap.facts).toHaveLength(1);
    expect(mainSnap.facts[0]?.value).toBe('peace');

    const altSnap = computeSnapshot(world, 10n, [entity('a')], [mainFact, alternateFact], [], [], [], [], { branchId: 'branch-what-if-war' });
    expect(altSnap.facts).toHaveLength(1);
    expect(altSnap.facts[0]?.value).toBe('war');
  });

  it('projects temporal identity facts onto entity name and parent at the requested tick', () => {
    const city = entity('city-1');
    city.name = 'ChangAn';
    const rename: Fact = {
      id: 'fact-name', worldId: world.id, subjectEntityId: 'city-1', predicateKey: 'name',
      objectKind: 'scalar', value: 'XiAn', validFromTick: 100n,
      canonStatus: 'canon', sourceKind: 'manual', createdRevision: 1n, revisionFrom: 1n,
    };
    const early = computeSnapshot(world, 50n, [city], [rename], [], [], [], []);
    expect(early.entities[0]?.name).toBe('ChangAn');
    const later = computeSnapshot(world, 120n, [city], [rename], [], [], [], []);
    expect(later.entities[0]?.name).toBe('XiAn');
  });
});
