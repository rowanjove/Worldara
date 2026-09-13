import { describe, expect, it } from 'vitest';
import type { Entity, EntityType, Fact, MapFeature, Relation, RelationType, WorldEvent } from '@world-codex/domain';
import { materializeEventEffects } from './event-effects';

const now = new Date('2026-09-08T00:00:00.000Z');
const type: EntityType = { id: 'type-person', worldId: 'world-1', typeKey: 'person', label: 'Person', schemaVersion: 1, schema: {}, createdAt: now, updatedAt: now };
const entity = (id: string, name: string): Entity => ({ id, worldId: 'world-1', typeId: type.id, name, subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [], canonStatus: 'canon', revision: 1n, createdAt: now, updatedAt: now });
const relationType: RelationType = { id: 'relation-knows', worldId: 'world-1', forwardLabel: 'knows', inverseLabel: 'known by', symmetric: false, sourceTypeIds: [type.id], targetTypeIds: [type.id] };
const baseFact: Fact = { id: 'fact-title-1', worldId: 'world-1', subjectEntityId: 'entity-a', predicateKey: 'title', objectKind: 'scalar', value: 'captain', validFromTick: 0n, canonStatus: 'canon', sourceKind: 'manual' };
const baseFeature: MapFeature = { id: 'feature-1', worldId: 'world-1', mapId: 'map-1', entityId: 'entity-a', kind: 'marker', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {}, validFromTick: 0n, createdAt: now, updatedAt: now };

describe('materializeEventEffects', () => {
  it('applies ordered fact, relation, entity and status effects without mutating input', () => {
    const event: WorldEvent = {
      id: 'event-1', worldId: 'world-1', name: 'Promotion', eventType: 'political', startTick: 10n,
      participantIds: ['entity-a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [],
      effects: [
        { id: 'fact-title-2', type: 'SET_FACT', targetId: baseFact.id, payload: { value: 'commander' }, sequence: 0 },
        { id: 'relation-1', type: 'ADD_RELATION', payload: { sourceEntityId: 'entity-a', targetEntityId: 'entity-b', relationTypeId: relationType.id }, sequence: 1 },
        { id: 'entity-c', type: 'CREATE_ENTITY', payload: { id: 'entity-c', typeId: type.id, name: 'New ally' }, sequence: 2 },
        { id: 'status-1', type: 'SET_STATUS', targetId: 'entity-a', payload: { status: 'active' }, sequence: 3 },
        { id: 'fact-origin', type: 'ADD_FACT', payload: { subjectEntityId: 'entity-a', predicateKey: 'origin', objectKind: 'scalar', value: 'north' }, sequence: 4 },
      ],
      description: '', canonStatus: 'canon',
    };
    const input = { entities: [entity('entity-a', 'A'), entity('entity-b', 'B')], entityTypes: [type], facts: [baseFact], relations: [], relationTypes: [relationType] };
    const result = materializeEventEffects(event, input, 8n, now);
    expect(input.facts[0]?.validToTick).toBeUndefined();
    expect(result.facts.find((fact) => fact.id === baseFact.id)?.validToTick).toBe(10n);
    expect(result.facts.find((fact) => fact.id === 'fact-title-2')).toMatchObject({ value: 'commander', validFromTick: 10n, sourceKind: 'event' });
    expect(result.facts.find((fact) => fact.id === 'fact-title-2')?.validToTick).toBeUndefined();
    expect(result.relations.find((relation) => relation.id === 'relation-1')).toMatchObject({ sourceEntityId: 'entity-a', targetEntityId: 'entity-b', validFromTick: 10n, canonStatus: 'canon' });
    expect(result.entities.find((candidate) => candidate.id === 'entity-c')?.name).toBe('New ally');
    expect(result.entities.find((candidate) => candidate.id === 'entity-a')?.document).toMatchObject({ status: 'active' });
    expect(result.facts.find((fact) => fact.id === 'fact-origin')).toMatchObject({ predicateKey: 'origin', value: 'north', validFromTick: 10n });
  });

  it('rejects effects that reference a missing or inactive record before persistence', () => {
    const event: WorldEvent = { id: 'event-2', worldId: 'world-1', name: 'Broken', eventType: 'test', startTick: 10n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'missing-fact-effect', type: 'END_FACT', targetId: 'missing-fact', payload: {}, sequence: 0 }], description: '', canonStatus: 'canon' };
    expect(() => materializeEventEffects(event, { entities: [entity('entity-a', 'A')], entityTypes: [type], facts: [baseFact], relations: [], relationTypes: [relationType] }, 2n, now)).toThrow('does not exist');
  });

  it('materializes geometry changes as a closed history row plus a new range', () => {
    const event: WorldEvent = { id: 'event-3', worldId: 'world-1', name: 'Move map marker', eventType: 'travel', startTick: 10n, participantIds: ['entity-a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'feature-2', type: 'CHANGE_GEOMETRY', targetId: baseFeature.id, payload: { geometry: { type: 'Point', coordinates: [5, 8] }, properties: { label: 'New' } }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const input = { entities: [entity('entity-a', 'A')], entityTypes: [type], facts: [], relations: [], relationTypes: [], mapFeatures: [baseFeature] };
    const result = materializeEventEffects(event, input, 2n, now);
    expect(input.mapFeatures[0]?.validToTick).toBeUndefined();
    expect(result.mapFeatures?.find((feature) => feature.id === baseFeature.id)?.validToTick).toBe(10n);
    expect(result.mapFeatures?.find((feature) => feature.id === 'feature-2')).toMatchObject({ geometry: { coordinates: [5, 8] }, properties: { label: 'New' }, validFromTick: 10n });
  });

  it('accepts the PRD REMOVE_RELATION alias', () => {
    const relation: Relation = { id: 'relation-1', worldId: 'world-1', sourceEntityId: 'entity-a', targetEntityId: 'entity-b', relationTypeId: relationType.id, validFromTick: 0n, description: '', canonStatus: 'canon' };
    const event: WorldEvent = { id: 'event-4', worldId: 'world-1', name: 'Break', eventType: 'political', startTick: 10n, participantIds: ['entity-a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'remove-1', type: 'REMOVE_RELATION', targetId: relation.id, payload: {}, sequence: 0 }], description: '', canonStatus: 'canon' };
    const result = materializeEventEffects(event, { entities: [entity('entity-a', 'A'), entity('entity-b', 'B')], entityTypes: [type], facts: [], relations: [relation], relationTypes: [relationType] }, 2n, now);
    expect(result.relations[0]?.validToTick).toBe(10n);
  });

  it('accepts SET_FIELD for an entity document field', () => {
    const event: WorldEvent = { id: 'event-5', worldId: 'world-1', name: 'Reveal status', eventType: 'political', startTick: 10n, participantIds: ['entity-a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'field-1', type: 'SET_FIELD', targetId: 'entity-a', payload: { field: 'status', value: 'active' }, sequence: 0 }], description: '', canonStatus: 'canon' };
    const result = materializeEventEffects(event, { entities: [entity('entity-a', 'A')], entityTypes: [type], facts: [], relations: [], relationTypes: [relationType] }, 2n, now);
    expect(result.entities[0]?.document).toEqual({ status: 'active' });
  });

  it('rejects Canon effects that write a computed or invalid typed field', () => {
    const typed = { ...type, schema: { fields: [{ key: 'score', label: 'Score', value_type: 'Formula', storage_mode: 'computed', formula: '1 + 1' }] } };
    const event: WorldEvent = { id: 'event-6', worldId: 'world-1', name: 'Illegal formula write', eventType: 'test', startTick: 10n, participantIds: ['entity-a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [{ id: 'field-2', type: 'SET_FIELD', targetId: 'entity-a', payload: { field: 'score', value: 2 }, sequence: 0 }], description: '', canonStatus: 'canon' };
    expect(() => materializeEventEffects(event, { entities: [entity('entity-a', 'A')], entityTypes: [typed], facts: [], relations: [], relationTypes: [] }, 2n, now)).toThrow('invalid entity document');
  });
});
