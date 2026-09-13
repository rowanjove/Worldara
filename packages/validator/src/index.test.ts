import { describe, expect, it } from 'vitest';
import { rangesOverlap, validateWorld } from './index';
import type { Entity, EntityType, World, WorldEvent, Fact, Relation, RelationType } from '@world-codex/domain';

const now = new Date('2026-09-07T00:00:00.000Z');
const world: World = { id: 'world', ownerId: null, name: 'Test', slug: 'test', description: '', genre: 'Fantasy', canonStrategy: 'strict', currentTick: 0n, revision: 1n, createdAt: now, updatedAt: now };
const type: EntityType = { id: 'character', worldId: world.id, typeKey: 'character', label: 'Character', schemaVersion: 1, schema: {}, createdAt: now, updatedAt: now };
const entity: Entity = { id: 'hero', worldId: world.id, typeId: type.id, name: 'Hero', subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [], canonStatus: 'canon', revision: 1n, createdAt: now, updatedAt: now };
const fact = (id: string, predicateKey: string, value: string): Fact => ({ id, worldId: world.id, subjectEntityId: entity.id, predicateKey, objectKind: 'scalar', value, canonStatus: 'canon', sourceKind: 'manual' });

describe('deterministic validator', () => {
  it('detects a dead participant', () => {
    const event: WorldEvent = { id: 'war', worldId: world.id, name: 'War', eventType: 'military', startTick: 20n, participantIds: [entity.id], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' };
    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [fact('death', 'death_tick', '10')], relationTypes: [], relations: [], events: [event] });
    expect(issues.some((issue) => issue.ruleCode === 'EVENT_AFTER_DEATH')).toBe(true);
  });

  it('detects overlapping temporal facts', () => {
    const a = { ...fact('a', 'ruler', 'A'), validFromTick: 0n, validToTick: 10n };
    const b = { ...fact('b', 'ruler', 'B'), validFromTick: 9n, validToTick: 20n };
    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [a, b], relationTypes: [], relations: [], events: [] });
    expect(issues.some((issue) => issue.ruleCode === 'TEMPORAL_FIELD_OVERLAP')).toBe(true);
  });

  it('detects nested ranges while treating adjacent ranges as non-overlapping', () => {
    const long = { ...fact('long', 'ruler', 'A'), validFromTick: 0n, validToTick: 100n };
    const nested = { ...fact('nested', 'ruler', 'B'), validFromTick: 10n, validToTick: 20n };
    const adjacent = { ...fact('adjacent', 'ruler', 'C'), validFromTick: 100n, validToTick: 120n };
    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [long, nested, adjacent], relationTypes: [], relations: [], events: [] });
    const overlapIssues = issues.filter((issue) => issue.ruleCode === 'TEMPORAL_FIELD_OVERLAP');
    expect(overlapIssues).toHaveLength(1);
    expect(overlapIssues[0]?.relatedIds).toEqual(['long', 'nested']);
  });

  it('detects simultaneous conflicting locations and implausible parent age', () => {
    const placeA: Entity = { ...entity, id: 'place-a', typeId: type.id, name: 'A' };
    const placeB: Entity = { ...entity, id: 'place-b', typeId: type.id, name: 'B' };
    const parent: Entity = { ...entity, id: 'parent', name: 'Parent' };
    const parentRelationType: RelationType = { id: 'parent-type', worldId: world.id, forwardLabel: 'parent', inverseLabel: 'child', symmetric: false, sourceTypeIds: [], targetTypeIds: [] };
    const parentRelation: Relation = { id: 'parent-relation', worldId: world.id, sourceEntityId: parent.id, targetEntityId: entity.id, relationTypeId: parentRelationType.id, description: '', canonStatus: 'canon' };
    const issues = validateWorld({ world, entities: [entity, parent, placeA, placeB], entityTypes: [type], facts: [
      { ...fact('birth-parent', 'birth_tick', '10'), subjectEntityId: parent.id },
      fact('birth-child', 'birth_tick', '20'),
      { ...fact('location-a', 'location', ''), objectKind: 'entity', objectEntityId: placeA.id, value: null, validFromTick: 0n, validToTick: 10n },
      { ...fact('location-b', 'location', ''), objectKind: 'entity', objectEntityId: placeB.id, value: null, validFromTick: 5n, validToTick: 15n },
    ], relationTypes: [parentRelationType], relations: [parentRelation], events: [] });
    expect(issues.some((issue) => issue.ruleCode === 'LOCATION_CONFLICT')).toBe(true);
    expect(issues.some((issue) => issue.ruleCode === 'PARENT_AGE')).toBe(true);
  });

  it('detects non-canonical endpoint order for a symmetric relation', () => {
    const other: Entity = { ...entity, id: 'a', name: 'Other' };
    const source: Entity = { ...entity, id: 'z', name: 'Source' };
    const friendship: RelationType = { id: 'friendship', worldId: world.id, forwardLabel: 'friend', inverseLabel: 'friend', symmetric: true, sourceTypeIds: [], targetTypeIds: [] };
    const relation: Relation = { id: 'friendship-a', worldId: world.id, sourceEntityId: source.id, targetEntityId: other.id, relationTypeId: friendship.id, description: '', canonStatus: 'canon' };
    const issues = validateWorld({ world, entities: [entity, source, other], entityTypes: [type], facts: [], relationTypes: [friendship], relations: [relation], events: [] });
    expect(issues.some((issue) => issue.ruleCode === 'ASYMMETRIC_RELATION')).toBe(true);
  });

  it('detects missing required event participant roles', () => {
    const event: WorldEvent = { id: 'role-event', worldId: world.id, name: 'Council', eventType: 'social', startTick: 10n, participantIds: [entity.id], participantRoles: [{ entityId: entity.id, role: 'witness' }], requiredRoles: ['speaker'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' };
    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [], relationTypes: [], relations: [], events: [event] });
    expect(issues.some((issue) => issue.ruleCode === 'MISSING_REQUIRED_ROLE')).toBe(true);
  });

  it('keeps signed int64 endpoints inclusive for open temporal ranges', () => {
    const max = (1n << 63n) - 1n;
    expect(rangesOverlap(undefined, undefined, max, undefined)).toBe(true);
    expect(rangesOverlap(undefined, max, max, undefined)).toBe(false);
  });

  it('validates typed entity documents against their FieldSchema', () => {
    const typed = { ...type, schema: { fields: [
      { key: 'age', label: 'Age', value_type: 'Number', required: true, validation_json: { min: 0 } },
      { key: 'ally', label: 'Ally', value_type: 'EntityReference' },
    ] } };
    const candidate = { ...entity, document: { age: -1, ally: 'missing' } };
    const issues = validateWorld({ world, entities: [candidate], entityTypes: [typed], facts: [], relationTypes: [], relations: [], events: [] });
    expect(issues.some((issue) => issue.ruleCode === 'ENTITY_FIELD_INVALID')).toBe(true);
    expect(issues.some((issue) => issue.ruleCode === 'BROKEN_REFERENCE')).toBe(true);
  });

  it('rejects references to entities belonging to another world', () => {
    const foreign: Entity = { ...entity, id: 'foreign', worldId: 'other-world', name: 'Foreign' };
    const crossWorldFact: Fact = { ...fact('cross-world', 'ruler', ''), objectKind: 'entity', objectEntityId: foreign.id, value: null };
    const issues = validateWorld({ world, entities: [entity, foreign], entityTypes: [type], facts: [crossWorldFact], relationTypes: [], relations: [], events: [] });
    expect(issues.some((issue) => issue.ruleCode === 'BROKEN_REFERENCE' && issue.subjectId === crossWorldFact.id)).toBe(true);
  });

  it('does not resolve foreign relation types or event links', () => {
    const foreignType: RelationType = { id: 'foreign-relation-type', worldId: 'other-world', forwardLabel: 'owns', inverseLabel: 'owned-by', symmetric: false, sourceTypeIds: [], targetTypeIds: [] };
    const relation: Relation = { id: 'foreign-type-relation', worldId: world.id, sourceEntityId: entity.id, targetEntityId: entity.id, relationTypeId: foreignType.id, description: '', canonStatus: 'canon' };
    const foreignEvent: WorldEvent = { id: 'foreign-event', worldId: 'other-world', name: 'Foreign', eventType: 'test', startTick: 1n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' };
    const event: WorldEvent = { id: 'local-event', worldId: world.id, name: 'Local', eventType: 'test', startTick: 2n, participantIds: [entity.id], locationEntityIds: [], causeEventIds: [foreignEvent.id], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' };
    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [], relationTypes: [foreignType], relations: [relation], events: [event, foreignEvent] });
    expect(issues.some((issue) => issue.ruleCode === 'INVALID_RELATION' && issue.subjectId === relation.id)).toBe(true);
    expect(issues.some((issue) => issue.ruleCode === 'BROKEN_REFERENCE' && issue.subjectId === event.id)).toBe(true);
  });

  it('detects conflicting birth_tick facts on the same entity', () => {
    const birth1 = fact('b1', 'birth_tick', '10');
    const birth2 = fact('b2', 'birth_tick', '20');
    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [birth1, birth2], relationTypes: [], relations: [], events: [] });
    expect(issues.some((issue) => issue.ruleCode === 'TEMPORAL_FIELD_OVERLAP' && issue.message.includes('conflicting birth_tick'))).toBe(true);
  });

  it('does not treat superseded and replacement facts as overlapping', () => {
    const issues = validateWorld({
      world, entities: [entity], entityTypes: [type],
      facts: [
        { id: 'old-king', worldId: world.id, subjectEntityId: entity.id, predicateKey: 'king', objectKind: 'scalar', value: 'Arthur', validFromTick: 100n, validToTick: 200n, canonStatus: 'canon', sourceKind: 'manual', revisionFrom: 1n, revisionTo: 2n },
        { id: 'new-king', worldId: world.id, subjectEntityId: entity.id, predicateKey: 'king', objectKind: 'scalar', value: 'Lancelot', validFromTick: 150n, validToTick: 200n, canonStatus: 'canon', sourceKind: 'manual', revisionFrom: 2n, revisionTo: null },
      ],
      relationTypes: [], relations: [], events: [],
    });
    expect(issues.some((issue) => issue.ruleCode === 'TEMPORAL_FIELD_OVERLAP')).toBe(false);
  });

  it('detects causal link timeline order violation and contradicting events', () => {
    const ev1: WorldEvent = { id: 'ev-1', worldId: world.id, name: 'Assassination', eventType: 'political', startTick: 100n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon', causalLinks: [{ targetEventId: 'ev-2', kind: 'causes' }] };
    const ev2: WorldEvent = { id: 'ev-2', worldId: world.id, name: 'War Outbreak', eventType: 'war', startTick: 50n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' };
    const ev3: WorldEvent = { id: 'ev-3', worldId: world.id, name: 'Peace Treaty', eventType: 'diplomatic', startTick: 120n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon', causalLinks: [{ targetEventId: 'ev-2', kind: 'contradicts' }] };

    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [], relationTypes: [], relations: [], events: [ev1, ev2, ev3] });
    expect(issues.some((issue) => issue.ruleCode === 'TIMELINE_ORDER' && issue.subjectId === ev1.id)).toBe(true);
    expect(issues.some((issue) => issue.ruleCode === 'CONTRADICTING_EVENTS' && issue.subjectId === ev3.id)).toBe(true);
  });

  it('detects causal cycles in forward event causal graph', () => {
    const evA: WorldEvent = { id: 'ev-a', worldId: world.id, name: 'A', eventType: 'magic', startTick: 10n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon', causalLinks: [{ targetEventId: 'ev-b', kind: 'triggers' }] };
    const evB: WorldEvent = { id: 'ev-b', worldId: world.id, name: 'B', eventType: 'magic', startTick: 20n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon', causalLinks: [{ targetEventId: 'ev-c', kind: 'results_in' }] };
    const evC: WorldEvent = { id: 'ev-c', worldId: world.id, name: 'C', eventType: 'magic', startTick: 30n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon', causalLinks: [{ targetEventId: 'ev-a', kind: 'causes' }] };

    const issues = validateWorld({ world, entities: [entity], entityTypes: [type], facts: [], relationTypes: [], relations: [], events: [evA, evB, evC] });
    expect(issues.some((issue) => issue.ruleCode === 'CAUSAL_CYCLE')).toBe(true);
  });
});
