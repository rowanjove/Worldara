import { describe, expect, it } from 'vitest';
import type {
  ChangeSet,
  Entity,
  EntityType,
  Fact,
  Relation,
  RelationType,
  ValidationRule,
  World,
  WorldEvent,
} from '@world-codex/domain';
import { validateWorld, type ValidationContext } from './index';
import { validateIncremental } from './incremental';

const now = new Date('2026-09-11T00:00:00.000Z');

const world: World = {
  id: 'world-1',
  ownerId: null,
  name: 'Test World',
  slug: 'test-world',
  description: '',
  genre: 'fantasy',
  canonStrategy: 'strict',
  currentTick: 0n,
  revision: 1n,
  createdAt: now,
  updatedAt: now,
};

const mortalType: EntityType = {
  id: 'type-mortal',
  worldId: world.id,
  typeKey: 'mortal',
  label: 'Mortal',
  schemaVersion: 1,
  schema: {},
  createdAt: now,
  updatedAt: now,
};

const entityAlice: Entity = {
  id: 'alice',
  worldId: world.id,
  typeId: mortalType.id,
  name: 'Alice',
  subtitle: '',
  parentEntityId: null,
  document: {},
  documentText: '',
  tags: [],
  canonStatus: 'canon',
  revision: 1n,
  createdAt: now,
  updatedAt: now,
};

const entityBob: Entity = {
  id: 'bob',
  worldId: world.id,
  typeId: mortalType.id,
  name: 'Bob',
  subtitle: '',
  parentEntityId: null,
  document: {},
  documentText: '',
  tags: [],
  canonStatus: 'canon',
  revision: 1n,
  createdAt: now,
  updatedAt: now,
};

const parentType: RelationType = {
  id: 'rel-parent',
  worldId: world.id,
  forwardLabel: 'father',
  inverseLabel: 'child',
  sourceTypeIds: [mortalType.id],
  targetTypeIds: [mortalType.id],
  symmetric: false,
};

const friendshipType: RelationType = {
  id: 'rel-friend',
  worldId: world.id,
  forwardLabel: 'friend',
  inverseLabel: 'friend',
  sourceTypeIds: [mortalType.id],
  targetTypeIds: [mortalType.id],
  symmetric: true,
};

describe('Incremental Validation & Dependency Graph', () => {
  it('triggers only birth/event rules when modifying character birth date', () => {
    // Alice born at 100, died at 80 (invalid: birth after death)
    // Alice participates in event at tick 50 (invalid: event before birth)
    const birthFact: Fact = {
      id: 'f-birth',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'birth_tick',
      objectKind: 'scalar',
      value: '100',
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const deathFact: Fact = {
      id: 'f-death',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'death_tick',
      objectKind: 'scalar',
      value: '80',
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const eventEarly: WorldEvent = {
      id: 'event-early',
      worldId: world.id,
      name: 'Early battle',
      eventType: 'battle',
      startTick: 50n,
      participantIds: [entityAlice.id],
      locationEntityIds: [],
      causeEventIds: [],
      resultEventIds: [],
      effects: [],
      description: '',
      canonStatus: 'canon',
    };

    const ctx: ValidationContext = {
      world,
      entities: [entityAlice, entityBob],
      entityTypes: [mortalType],
      facts: [birthFact, deathFact],
      relationTypes: [parentType, friendshipType],
      relations: [],
      events: [eventEarly],
    };

    const changeSet: ChangeSet = {
      entityIds: [entityAlice.id],
      predicates: ['birth_tick'],
      factIds: [birthFact.id],
    };

    const incrementalResult = validateIncremental(ctx, changeSet);

    // Should detect BIRTH_AFTER_DEATH and EVENT_BEFORE_BIRTH
    const issueCodes = incrementalResult.issues.map((i) => i.ruleCode);
    expect(issueCodes).toContain('BIRTH_AFTER_DEATH');
    expect(issueCodes).toContain('EVENT_BEFORE_BIRTH');

    // Should have skipped unrelated rules
    expect(incrementalResult.skippedRuleCodes).toContain('LOCATION_CONFLICT');
    expect(incrementalResult.skippedRuleCodes).toContain('ASYMMETRIC_RELATION');
    expect(incrementalResult.skippedRuleCodes).toContain('INVALID_RELATION');

    // Equivalence with full validateWorld for Alice
    const fullIssues = validateWorld(ctx);
    const fullAliceIssues = fullIssues.filter((i) => i.subjectId === entityAlice.id);
    const incAliceIssues = incrementalResult.issues.filter((i) => i.subjectId === entityAlice.id);

    expect(incAliceIssues.map((i) => i.ruleCode).sort()).toEqual(
      fullAliceIssues.map((i) => i.ruleCode).sort()
    );
  });

  it('triggers only LOCATION_CONFLICT when modifying character location facts', () => {
    const locA: Fact = {
      id: 'loc-1',
      worldId: world.id,
      subjectEntityId: entityBob.id,
      predicateKey: 'location',
      objectKind: 'entity',
      objectEntityId: 'loc-city-a',
      value: null,
      validFromTick: 100n,
      validToTick: 200n,
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const locB: Fact = {
      id: 'loc-2',
      worldId: world.id,
      subjectEntityId: entityBob.id,
      predicateKey: 'location',
      objectKind: 'entity',
      objectEntityId: 'loc-city-b',
      value: null,
      validFromTick: 150n,
      validToTick: 250n,
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const cityA: Entity = {
      ...entityAlice,
      id: 'loc-city-a',
      name: 'City A',
    };
    const cityB: Entity = {
      ...entityAlice,
      id: 'loc-city-b',
      name: 'City B',
    };

    const ctx: ValidationContext = {
      world,
      entities: [entityBob, cityA, cityB],
      entityTypes: [mortalType],
      facts: [locA, locB],
      relationTypes: [parentType],
      relations: [],
      events: [],
    };

    const changeSet: ChangeSet = {
      entityIds: [entityBob.id],
      predicates: ['location'],
    };

    const result = validateIncremental(ctx, changeSet);
    expect(result.issues.map((i) => i.ruleCode)).toContain('LOCATION_CONFLICT');
    expect(result.skippedRuleCodes).toContain('BIRTH_AFTER_DEATH');
    expect(result.skippedRuleCodes).toContain('ASYMMETRIC_RELATION');
    expect(result.skippedRuleCodes).toContain('TIMELINE_ORDER');
  });

  it('evaluates affected custom DSL rules and skips unaffected custom rules', () => {
    // Custom rule 1: mortal species lifespan <= 180
    const ruleLifespan: ValidationRule = {
      id: 'rule-mortal-lifespan',
      worldId: world.id,
      name: 'Mortal lifespan limit',
      severity: 'error',
      target: 'entity',
      when: { fact: 'species', equals: 'mortal' },
      assert: {
        duration_between: {
          from: 'birth_tick',
          to: 'death_tick',
          lte: 180,
        },
      },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    // Custom rule 2: elven archery skill >= 10 (unrelated)
    const ruleArchery: ValidationRule = {
      id: 'rule-elven-archery',
      worldId: world.id,
      name: 'Elven archery level',
      severity: 'warning',
      target: 'entity',
      when: { fact: 'species', equals: 'elf' },
      assert: { fact: 'archery_level', gte: 10 },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    const speciesFact: Fact = {
      id: 'f-spec',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'species',
      objectKind: 'scalar',
      value: 'mortal',
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const birthFact: Fact = {
      id: 'f-b',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'birth_tick',
      objectKind: 'scalar',
      value: '100',
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const deathFact: Fact = {
      id: 'f-d',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'death_tick',
      objectKind: 'scalar',
      value: '350', // 250 years > 180
      canonStatus: 'canon',
      sourceKind: 'manual',
    };

    const ctx: ValidationContext = {
      world,
      entities: [entityAlice],
      entityTypes: [mortalType],
      facts: [speciesFact, birthFact, deathFact],
      relationTypes: [],
      relations: [],
      events: [],
      rules: [ruleLifespan, ruleArchery],
    };

    const changeSet: ChangeSet = {
      entityIds: [entityAlice.id],
      predicates: ['death_tick'],
    };

    const result = validateIncremental(ctx, changeSet, [ruleLifespan, ruleArchery]);

    // ruleLifespan is affected because death_tick is in its duration_between
    expect(result.affectedRuleCodes).toContain('rule-mortal-lifespan');
    // ruleArchery does not touch death_tick and is skipped
    expect(result.skippedRuleCodes).toContain('rule-elven-archery');

    // Rule catches Alice's lifespan violation
    expect(result.issues.some((i) => i.ruleCode === 'rule-mortal-lifespan')).toBe(true);
  });

  it('detects asymmetric relation errors incrementally when relations are touched', () => {
    const relInvalidOrder: Relation = {
      id: 'rel-sym-2',
      worldId: world.id,
      relationTypeId: friendshipType.id,
      sourceEntityId: 'z-charlie',
      targetEntityId: 'a-alice',
      description: '',
      canonStatus: 'canon',
    };

    const charlie: Entity = {
      ...entityAlice,
      id: 'z-charlie',
      name: 'Charlie',
    };
    const aAlice: Entity = {
      ...entityAlice,
      id: 'a-alice',
      name: 'Alice',
    };

    const ctx: ValidationContext = {
      world,
      entities: [charlie, aAlice],
      entityTypes: [mortalType],
      facts: [],
      relationTypes: [friendshipType],
      relations: [relInvalidOrder],
      events: [],
    };

    const changeSet: ChangeSet = {
      relationIds: [relInvalidOrder.id],
      relationTypeIds: [friendshipType.id],
    };

    const result = validateIncremental(ctx, changeSet);
    expect(result.issues.map((i) => i.ruleCode)).toContain('ASYMMETRIC_RELATION');
    expect(result.skippedRuleCodes).toContain('EVENT_BEFORE_BIRTH');
    expect(result.skippedRuleCodes).toContain('LOCATION_CONFLICT');
  });

  it('matches full validation on the impacted issue set when the changeSet covers those subjects', () => {
    const birthFact: Fact = {
      id: 'f-birth',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'birth_tick',
      objectKind: 'scalar',
      value: '100',
      canonStatus: 'canon',
      sourceKind: 'manual',
    };
    const deathFact: Fact = {
      id: 'f-death',
      worldId: world.id,
      subjectEntityId: entityAlice.id,
      predicateKey: 'death_tick',
      objectKind: 'scalar',
      value: '80',
      canonStatus: 'canon',
      sourceKind: 'manual',
    };
    const ctx: ValidationContext = {
      world,
      entities: [entityAlice, entityBob],
      entityTypes: [mortalType],
      facts: [birthFact, deathFact],
      relationTypes: [parentType],
      relations: [],
      events: [],
    };
    const changeSet: ChangeSet = {
      entityIds: [entityAlice.id, entityBob.id],
      factIds: [birthFact.id, deathFact.id],
      predicates: ['birth_tick', 'death_tick'],
    };
    const fingerprint = (issues: Array<{ ruleCode: string; subjectId?: string }>) =>
      issues.map((issue) => `${issue.ruleCode}:${issue.subjectId ?? ''}`).sort();
    const incremental = validateIncremental(ctx, changeSet);
    expect(fingerprint(incremental.issues)).toEqual(fingerprint(validateWorld(ctx)));
  });
});
