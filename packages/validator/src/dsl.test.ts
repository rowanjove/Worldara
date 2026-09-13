import { describe, expect, it } from 'vitest';
import type { Entity, EntityType, Fact, Relation, RelationType, ValidationRule, World, WorldEvent } from '@world-codex/domain';
import { evaluateRule, evaluateCondition } from './dsl';
import { validateWorld, type ValidationContext } from './index';

function createMockContext(): ValidationContext {
  const world: World = {
    id: 'world-1',
    ownerId: null,
    name: 'Test World',
    slug: 'test-world',
    description: '',
    genre: 'fantasy',
    canonStrategy: 'strict',
    defaultCalendarVersionId: null,
    currentTick: 100n,
    revision: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
  };

  const humanType: EntityType = {
    id: 'type-human',
    worldId: 'world-1',
    typeKey: 'human',
    label: 'Human',
    schemaVersion: 1,
    schema: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const elfType: EntityType = {
    id: 'type-elf',
    worldId: 'world-1',
    typeKey: 'elf',
    label: 'Elf',
    schemaVersion: 1,
    schema: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const entities: Entity[] = [
    {
      id: 'entity-bob',
      worldId: 'world-1',
      typeId: 'type-human',
      name: 'Bob',
      subtitle: '',
      parentEntityId: null,
      document: { age: 30, title: 'Adventurer' },
      documentText: '',
      tags: ['warrior'],
      canonStatus: 'canon',
      revision: 1n,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'entity-methuselah',
      worldId: 'world-1',
      typeId: 'type-human',
      name: 'Old Human',
      subtitle: '',
      parentEntityId: null,
      document: {},
      documentText: '',
      tags: [],
      canonStatus: 'canon',
      revision: 1n,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'entity-legolas',
      worldId: 'world-1',
      typeId: 'type-elf',
      name: 'Legolas',
      subtitle: '',
      parentEntityId: null,
      document: {},
      documentText: '',
      tags: [],
      canonStatus: 'canon',
      revision: 1n,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const facts: Fact[] = [
    {
      id: 'fact-bob-birth',
      worldId: 'world-1',
      subjectEntityId: 'entity-bob',
      predicateKey: 'birth_date',
      objectKind: 'scalar',
      value: 10,
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-bob-death',
      worldId: 'world-1',
      subjectEntityId: 'entity-bob',
      predicateKey: 'death_date',
      objectKind: 'scalar',
      value: 90,
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-old-birth',
      worldId: 'world-1',
      subjectEntityId: 'entity-methuselah',
      predicateKey: 'birth_date',
      objectKind: 'scalar',
      value: 0,
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-old-death',
      worldId: 'world-1',
      subjectEntityId: 'entity-methuselah',
      predicateKey: 'death_date',
      objectKind: 'scalar',
      value: 250,
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-bob-species',
      worldId: 'world-1',
      subjectEntityId: 'entity-bob',
      predicateKey: 'species',
      objectKind: 'scalar',
      value: 'human',
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-old-species',
      worldId: 'world-1',
      subjectEntityId: 'entity-methuselah',
      predicateKey: 'species',
      objectKind: 'scalar',
      value: 'human',
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-legolas-species',
      worldId: 'world-1',
      subjectEntityId: 'entity-legolas',
      predicateKey: 'species',
      objectKind: 'scalar',
      value: 'elf',
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-legolas-birth',
      worldId: 'world-1',
      subjectEntityId: 'entity-legolas',
      predicateKey: 'birth_date',
      objectKind: 'scalar',
      value: 0,
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
    {
      id: 'fact-legolas-death',
      worldId: 'world-1',
      subjectEntityId: 'entity-legolas',
      predicateKey: 'death_date',
      objectKind: 'scalar',
      value: 1000,
      canonStatus: 'canon',
      sourceKind: 'manual',
    },
  ];

  const relationTypes: RelationType[] = [
    {
      id: 'reltype-mentor',
      worldId: 'world-1',
      forwardLabel: 'mentors',
      inverseLabel: 'mentored_by',
      symmetric: false,
      sourceTypeIds: [],
      targetTypeIds: [],
    },
  ];

  const relations: Relation[] = [
    {
      id: 'rel-1',
      worldId: 'world-1',
      sourceEntityId: 'entity-bob',
      targetEntityId: 'entity-methuselah',
      relationTypeId: 'reltype-mentor',
      description: 'Bob mentors Old Human',
      canonStatus: 'canon',
    },
  ];

  const events: WorldEvent[] = [
    {
      id: 'event-1',
      worldId: 'world-1',
      name: 'Great Battle',
      eventType: 'battle',
      startTick: 50n,
      endTick: 55n,
      participantIds: ['entity-bob'],
      locationEntityIds: [],
      causeEventIds: [],
      resultEventIds: [],
      effects: [],
      description: '',
      canonStatus: 'canon',
    },
  ];

  return {
    world,
    entities,
    entityTypes: [humanType, elfType],
    facts,
    relationTypes,
    relations,
    events,
  };
}

describe('Validator DSL Evaluator', () => {
  it('evaluates basic field and fact comparisons', () => {
    const ctx = createMockContext();
    const bob = ctx.entities[0]!;

    // equals on entity name
    expect(evaluateCondition({ field: 'name', equals: 'Bob' }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ field: 'name', equals: 'Alice' }, ctx, bob, 'entity')).toBe(false);

    // not_equals
    expect(evaluateCondition({ field: 'name', not_equals: 'Alice' }, ctx, bob, 'entity')).toBe(true);

    // document nested access
    expect(evaluateCondition({ field: 'document.age', equals: 30 }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ field: 'age', equals: 30 }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ field: 'age', gt: 20 }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ field: 'age', lte: 30 }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ field: 'age', lt: 30 }, ctx, bob, 'entity')).toBe(false);

    // fact lookup
    expect(evaluateCondition({ fact: 'species', equals: 'human' }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ fact: 'species', equals: 'elf' }, ctx, bob, 'entity')).toBe(false);
    expect(evaluateCondition({ field: 'species', equals: 'human' }, ctx, bob, 'entity')).toBe(true);

    // exists / not_exists
    expect(evaluateCondition({ field: 'name', exists: true }, ctx, bob, 'entity')).toBe(true);
    expect(evaluateCondition({ field: 'nonexistent', not_exists: true }, ctx, bob, 'entity')).toBe(true);
  });

  it('evaluates logical operators (all, any, not)', () => {
    const ctx = createMockContext();
    const bob = ctx.entities[0]!;

    // all (AND)
    expect(
      evaluateCondition(
        {
          all: [
            { field: 'name', equals: 'Bob' },
            { fact: 'species', equals: 'human' },
          ],
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          all: [
            { field: 'name', equals: 'Bob' },
            { fact: 'species', equals: 'elf' },
          ],
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(false);

    // any (OR)
    expect(
      evaluateCondition(
        {
          any: [
            { field: 'name', equals: 'Alice' },
            { fact: 'species', equals: 'human' },
          ],
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(true);

    // not (NOT)
    expect(
      evaluateCondition(
        {
          not: { field: 'name', equals: 'Alice' },
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(true);
  });

  it('evaluates duration_between for lifespan checks', () => {
    const ctx = createMockContext();
    const bob = ctx.entities[0]!;
    const oldHuman = ctx.entities[1]!;

    const max180Years = {
      duration_between: {
        from: 'birth_date',
        to: 'death_date',
        lte: 180,
      },
    };

    // Bob: 90 - 10 = 80 <= 180 -> passes
    expect(evaluateCondition(max180Years, ctx, bob, 'entity')).toBe(true);

    // Old Human: 250 - 0 = 250 > 180 -> fails
    expect(evaluateCondition(max180Years, ctx, oldHuman, 'entity')).toBe(false);
  });

  it('evaluates relation_exists condition', () => {
    const ctx = createMockContext();
    const bob = ctx.entities[0]!;
    const legolas = ctx.entities[2]!;

    expect(
      evaluateCondition(
        {
          relation_exists: {
            forwardLabel: 'mentors',
            direction: 'outgoing',
          },
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          relation_exists: {
            forwardLabel: 'mentors',
            direction: 'outgoing',
          },
        },
        ctx,
        legolas,
        'entity'
      )
    ).toBe(false);
  });

  it('evaluates count operator on relations, facts, and events', () => {
    const ctx = createMockContext();
    const bob = ctx.entities[0]!;
    const legolas = ctx.entities[2]!;

    // Count relations >= 1
    expect(
      evaluateCondition(
        {
          count: {
            target: 'relations',
            gte: 1,
          },
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          count: {
            target: 'relations',
            gte: 1,
          },
        },
        ctx,
        legolas,
        'entity'
      )
    ).toBe(false);

    // Count events >= 1
    expect(
      evaluateCondition(
        {
          count: {
            target: 'events',
            gte: 1,
          },
        },
        ctx,
        bob,
        'entity'
      )
    ).toBe(true);
  });

  it('evaluates active_at condition', () => {
    const ctx = createMockContext();
    const event = ctx.events[0]!; // start 50, end 55

    expect(evaluateCondition({ active_at: { tick: 52 } }, ctx, event, 'event')).toBe(true);
    expect(evaluateCondition({ active_at: { tick: 60 } }, ctx, event, 'event')).toBe(false);
  });

  it('runs complete custom rule and reports violations with when precondition', () => {
    const ctx = createMockContext();

    // Section 5.2 example: Human lifespan upper bound 180 years
    const humanMaxAgeRule: ValidationRule = {
      id: 'human-max-age',
      worldId: 'world-1',
      name: '凡人寿命上限',
      severity: 'warning',
      target: 'entity',
      when: {
        all: [{ fact: 'species', equals: 'human' }],
      },
      assert: {
        duration_between: {
          from: 'birth_date',
          to: 'death_date',
          lte: 180,
        },
      },
      message: '凡人寿命不可超过180年',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const issues = evaluateRule(humanMaxAgeRule, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.subjectId).toBe('entity-methuselah');
    expect(issues[0]!.ruleCode).toBe('human-max-age');
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toBe('凡人寿命不可超过180年');

    // Legolas is an elf (when condition false), so not checked
    expect(issues.some((i) => i.subjectId === 'entity-legolas')).toBe(false);
  });

  it('integrates seamlessly with validateWorld', () => {
    const ctx = createMockContext();
    const rule: ValidationRule = {
      id: 'custom-adventurer-title',
      worldId: 'world-1',
      name: '冒险者称号检查',
      severity: 'error',
      target: 'entity',
      when: { field: 'name', equals: 'Bob' },
      assert: { field: 'document.title', equals: 'King' },
      message: 'Bob must be a King',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    ctx.rules = [rule];
    const issues = validateWorld(ctx);
    expect(issues.some((i) => i.ruleCode === 'custom-adventurer-title')).toBe(true);

    // Disabled rule produces no issues
    rule.enabled = false;
    const issuesDisabled = validateWorld(ctx);
    expect(issuesDisabled.some((i) => i.ruleCode === 'custom-adventurer-title')).toBe(false);
  });
});
