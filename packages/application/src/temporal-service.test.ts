import { describe, expect, it } from 'vitest';
import type { Entity, Relation, World } from '@world-codex/domain';
import type { TemporalRepository } from './temporal-ports';
import { TemporalApplicationService } from './temporal-service';

const now = new Date('2026-09-08T00:00:00.000Z');
const world: World = {
  id: 'world-1', ownerId: null, name: 'Test', slug: 'test', description: '', genre: 'Fantasy', canonStrategy: 'strict',
  currentTick: 0n, revision: 1n, createdAt: now, updatedAt: now,
};

const entity = (id: string): Entity => ({
  id, worldId: world.id, typeId: 'type', name: id, subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [],
  canonStatus: 'canon', revision: 1n, createdAt: now, updatedAt: now,
});

const relation = (id: string, sourceEntityId: string, targetEntityId: string, canonStatus: Relation['canonStatus'], validFromTick?: bigint, validToTick?: bigint): Relation => ({
  id, worldId: world.id, sourceEntityId, targetEntityId, relationTypeId: 'relation-type', description: '', canonStatus,
  ...(validFromTick === undefined ? {} : { validFromTick }),
  ...(validToTick === undefined ? {} : { validToTick }),
});

describe('TemporalApplicationService.getNeighborhood', () => {
  it('returns only canon/pending relations active at the requested tick', async () => {
    const entities = ['a', 'b', 'c', 'd', 'e'].map(entity);
    const relations = [
      relation('active-canon', 'a', 'b', 'canon', 0n, 10n),
      relation('active-pending', 'b', 'c', 'pending', 0n, 10n),
      relation('future-canon', 'a', 'd', 'canon', 10n),
      relation('active-draft', 'a', 'e', 'draft', 0n, 10n),
    ];
    const repository = {
      getWorld: async (id: string) => id === world.id ? world : null,
      listEntities: async () => entities,
      listRelations: async () => relations,
    } as unknown as TemporalRepository;
    const service = new TemporalApplicationService(repository, { next: () => 'generated-id' }, { now: () => now });

    const atZero = await service.getNeighborhood(world.id, 'a', 2, 0n);
    expect(atZero.entities.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(atZero.relations.map((item) => item.id)).toEqual(['active-canon', 'active-pending']);

    const atTen = await service.getNeighborhood(world.id, 'a', 1, 10n);
    expect(atTen.entities.map((item) => item.id)).toEqual(['a', 'd']);
    expect(atTen.relations.map((item) => item.id)).toEqual(['future-canon']);
  });
});

describe('TemporalApplicationService.getTimeline', () => {
  it('filters out retconned and draft records by default, and includes them when option is all', async () => {
    const facts = [
      { id: 'f-canon', worldId: world.id, subjectEntityId: 'a', predicateKey: 'status', objectKind: 'scalar' as const, value: 'active', canonStatus: 'canon' as const, validFromTick: 0n, validToTick: 10n, sourceKind: 'manual' as const },
      { id: 'f-draft', worldId: world.id, subjectEntityId: 'a', predicateKey: 'status', objectKind: 'scalar' as const, value: 'draft', canonStatus: 'draft' as const, validFromTick: 0n, validToTick: 10n, sourceKind: 'manual' as const },
      { id: 'f-retconned', worldId: world.id, subjectEntityId: 'a', predicateKey: 'status', objectKind: 'scalar' as const, value: 'old', canonStatus: 'retconned' as const, validFromTick: 0n, validToTick: 10n, sourceKind: 'manual' as const },
    ];
    const relations = [
      relation('r-canon', 'a', 'b', 'canon', 0n, 10n),
      relation('r-retconned', 'a', 'c', 'retconned', 0n, 10n),
    ];
    const events = [
      { id: 'e-canon', worldId: world.id, name: 'War', eventType: 'battle', startTick: 5n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' as const },
      { id: 'e-draft', worldId: world.id, name: 'Draft Battle', eventType: 'battle', startTick: 5n, participantIds: ['a'], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'draft' as const },
    ];
    const repository = {
      getWorld: async (id: string) => id === world.id ? world : null,
      listFacts: async () => facts,
      listRelations: async () => relations,
      listEvents: async () => events,
    } as unknown as TemporalRepository;
    const service = new TemporalApplicationService(repository, { next: () => 'generated-id' }, { now: () => now });

    const defaultTimeline = await service.getTimeline(world.id, 0n, 10n);
    expect(defaultTimeline.facts.map((item) => item.id)).toEqual(['f-canon']);
    expect(defaultTimeline.relations.map((item) => item.id)).toEqual(['r-canon']);
    expect(defaultTimeline.events.map((item) => item.id)).toEqual(['e-canon']);

    const allTimeline = await service.getTimeline(world.id, 0n, 10n, { canonStatus: 'all' });
    expect(allTimeline.facts.map((item) => item.id)).toEqual(['f-canon', 'f-draft', 'f-retconned']);
    expect(allTimeline.relations.map((item) => item.id)).toEqual(['r-canon', 'r-retconned']);
    expect(allTimeline.events.map((item) => item.id)).toEqual(['e-canon', 'e-draft']);
  });
});

describe('TemporalApplicationService.createEvent & Causality', () => {
  it('resolves relative startTick based on relativeToEventId', async () => {
    const rootEvent = { id: 'root-ev', worldId: world.id, name: 'Root', eventType: 'coronation', startTick: 1000n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '', canonStatus: 'canon' as const };
    let savedEvent: any;
    const repository = {
      getWorld: async (id: string) => id === world.id ? world : null,
      listEntities: async () => [],
      listEvents: async () => [rootEvent],
      createEvent: async (input: any) => { savedEvent = input; return { ...input, canonStatus: 'draft' }; },
    } as unknown as TemporalRepository;
    const service = new TemporalApplicationService(repository, { next: () => 'ev-rel' }, { now: () => now });

    const created = await service.createEvent(world.id, {
      name: 'Post Coronation Ball',
      eventType: 'social',
      startTick: 0n,
      temporalExpression: {
        kind: 'relative',
        relativeToEventId: 'root-ev',
        relativeOffsetTicks: 30n,
        displayLabel: '加冕后30日',
      },
      participantIds: [],
      locationEntityIds: [],
      causeEventIds: [],
      resultEventIds: [],
      effects: [],
      description: '',
    }, 1n);

    expect(created.startTick).toBe(1030n);
    expect(savedEvent.startTick).toBe(1030n);
  });

  it('rejects causal cycle on createEvent', async () => {
    const evA = { id: 'ev-a', worldId: world.id, name: 'A', eventType: 'magic', startTick: 10n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], causalLinks: [{ targetEventId: 'ev-b', kind: 'triggers' as const }], effects: [], description: '', canonStatus: 'canon' as const };
    const evB = { id: 'ev-b', worldId: world.id, name: 'B', eventType: 'magic', startTick: 20n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], causalLinks: [], effects: [], description: '', canonStatus: 'canon' as const };
    const repository = {
      getWorld: async (id: string) => id === world.id ? world : null,
      listEntities: async () => [],
      listEvents: async () => [evA, evB],
    } as unknown as TemporalRepository;
    const service = new TemporalApplicationService(repository, { next: () => 'ev-c' }, { now: () => now });

    // ev-c: B -> C -> A forming cycle A -> B -> C -> A
    await expect(service.createEvent(world.id, {
      name: 'C',
      eventType: 'magic',
      startTick: 30n,
      participantIds: [],
      locationEntityIds: [],
      causeEventIds: ['ev-b'],
      resultEventIds: [],
      causalLinks: [{ targetEventId: 'ev-a', kind: 'causes' }],
      effects: [],
      description: '',
    }, 1n)).rejects.toThrow(/cycle detected/);
  });

  it('retrieves event causality lineage with upstream, downstream, and contradictions', async () => {
    const ev1 = { id: 'ev-1', worldId: world.id, name: 'Secret Treaty', eventType: 'diplomacy', startTick: 10n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], causalLinks: [{ targetEventId: 'ev-2', kind: 'enables' as const }], effects: [], description: '', canonStatus: 'canon' as const };
    const ev2 = { id: 'ev-2', worldId: world.id, name: 'Border Skirmish', eventType: 'military', startTick: 20n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], causalLinks: [{ targetEventId: 'ev-3', kind: 'causes' as const }], effects: [], description: '', canonStatus: 'canon' as const };
    const ev3 = { id: 'ev-3', worldId: world.id, name: 'War Outbreak', eventType: 'war', startTick: 30n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], causalLinks: [{ targetEventId: 'ev-alt', kind: 'contradicts' as const }], effects: [], description: '', canonStatus: 'canon' as const };
    const evAlt = { id: 'ev-alt', worldId: world.id, name: 'Golden Age of Peace', eventType: 'diplomacy', startTick: 30n, participantIds: [], locationEntityIds: [], causeEventIds: [], resultEventIds: [], causalLinks: [], effects: [], description: '', canonStatus: 'canon' as const };

    const repository = {
      getWorld: async (id: string) => id === world.id ? world : null,
      listEvents: async () => [ev1, ev2, ev3, evAlt],
    } as unknown as TemporalRepository;
    const service = new TemporalApplicationService(repository, { next: () => 'id' }, { now: () => now });

    const causality = await service.getEventCausality(world.id, 'ev-2');
    expect(causality.event.id).toBe('ev-2');
    expect(causality.upstreamCauses.map((c) => c.eventId)).toEqual(['ev-1']);
    expect(causality.downstreamConsequences.map((c) => c.eventId)).toEqual(['ev-3']);
    expect(causality.contradictingEvents).toHaveLength(0);
    expect(causality.hasCycle).toBe(false);

    const warCausality = await service.getEventCausality(world.id, 'ev-3');
    expect(warCausality.upstreamCauses.map((c) => c.eventId)).toEqual(['ev-2', 'ev-1']);
    expect(warCausality.contradictingEvents.map((c) => c.eventId)).toEqual(['ev-alt']);
  });
});

