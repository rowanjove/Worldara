import { describe, expect, it } from 'vitest';
import type { Claim, Entity, Fact, Relation, Scene, World } from '@world-codex/domain';
import { reviewSceneContinuity } from './continuity';

describe('reviewSceneContinuity', () => {
  const world: World = {
    id: 'world-1',
    ownerId: null,
    name: 'Valoria',
    slug: 'valoria',
    description: '',
    genre: 'Fantasy',
    currentTick: 1000n,
    revision: 10n,
    canonStrategy: 'strict',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const duncan: Entity = {
    id: 'duncan-id',
    worldId: world.id,
    typeId: 'char-type',
    name: 'King Duncan',
    subtitle: '',
    parentEntityId: null,
    document: {},
    documentText: '',
    tags: [],
    canonStatus: 'canon',
    revision: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const malcolm: Entity = {
    id: 'malcolm-id',
    worldId: world.id,
    typeId: 'char-type',
    name: 'Prince Malcolm',
    subtitle: '',
    parentEntityId: null,
    document: {},
    documentText: '',
    tags: [],
    canonStatus: 'canon',
    revision: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const kingdom: Entity = {
    id: 'kingdom-id',
    worldId: world.id,
    typeId: 'loc-type',
    name: 'Scotland',
    subtitle: '',
    parentEntityId: null,
    document: {},
    documentText: '',
    tags: [],
    canonStatus: 'canon',
    revision: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const castle: Entity = {
    id: 'castle-id',
    worldId: world.id,
    typeId: 'loc-type',
    name: 'Dunsinane Castle',
    subtitle: '',
    parentEntityId: kingdom.id, // child of kingdom
    document: {},
    documentText: '',
    tags: [],
    canonStatus: 'canon',
    revision: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const island: Entity = {
    id: 'island-id',
    worldId: world.id,
    typeId: 'loc-type',
    name: 'Remote Island',
    subtitle: '',
    parentEntityId: null,
    document: {},
    documentText: '',
    tags: [],
    canonStatus: 'canon',
    revision: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseScene: Scene = {
    id: 'scene-1',
    worldId: world.id,
    workId: 'work-1',
    chapterId: 'chapter-1',
    title: 'Council Meeting',
    orderIndex: 1,
    sceneTick: 400n,
    povCharacterId: duncan.id,
    locationEntityId: castle.id,
    participantEntityIds: [malcolm.id],
    proseText: 'Duncan greeted Malcolm.',
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('passes a fully consistent scene', () => {
    const facts: Fact[] = [
      { id: 'f1', worldId: world.id, branchId: '00000000-0000-0000-0000-000000000001', subjectEntityId: duncan.id, predicateKey: 'birth', objectKind: 'scalar', value: 100, validFromTick: 100n, canonStatus: 'canon', sourceKind: 'manual', createdRevision: 1n, revisionFrom: 1n, revisionTo: null },
      { id: 'f2', worldId: world.id, branchId: '00000000-0000-0000-0000-000000000001', subjectEntityId: malcolm.id, predicateKey: 'birth', objectKind: 'scalar', value: 200, validFromTick: 200n, canonStatus: 'canon', sourceKind: 'manual', createdRevision: 1n, revisionFrom: 1n, revisionTo: null },
    ];
    const result = reviewSceneContinuity(world, baseScene, [duncan, malcolm, castle, kingdom], facts, [], []);
    expect(result.pass).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('flags unanchored scene tick as info', () => {
    const scene: Scene = { ...baseScene, sceneTick: undefined };
    const result = reviewSceneContinuity(world, scene, [duncan, malcolm, castle, kingdom], [], [], []);
    expect(result.pass).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('UNANCHORED_SCENE_TICK');
    expect(result.issues[0]?.severity).toBe('info');
  });

  it('detects unknown POV, location, and participant entities', () => {
    const brokenScene: Scene = {
      ...baseScene,
      povCharacterId: 'ghost-pov',
      locationEntityId: 'ghost-loc',
      participantEntityIds: ['ghost-part'],
    };
    const result = reviewSceneContinuity(world, brokenScene, [], [], [], []);
    expect(result.pass).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('INVALID_POV');
    expect(codes).toContain('UNKNOWN_LOCATION');
    expect(codes).toContain('UNKNOWN_PARTICIPANT');
  });

  it('detects deceased character appearing in scene', () => {
    const deathFact: Fact = {
      id: 'f-death',
      worldId: world.id,
      branchId: '00000000-0000-0000-0000-000000000001',
      subjectEntityId: duncan.id,
      predicateKey: 'death',
      objectKind: 'scalar',
      value: 350,
      validFromTick: 350n, // died at 350, scene is at 400!
      canonStatus: 'canon',
      sourceKind: 'manual',
      createdRevision: 1n,
      revisionFrom: 1n,
      revisionTo: null,
    };
    const result = reviewSceneContinuity(world, baseScene, [duncan, malcolm, castle, kingdom], [deathFact], [], []);
    expect(result.pass).toBe(false);
    const issue = result.issues.find((i) => i.code === 'DECEASED_CHARACTER');
    expect(issue).toBeDefined();
    expect(issue?.subjectId).toBe(duncan.id);
    expect(issue?.severity).toBe('blocker');
  });

  it('detects unborn character appearing in scene', () => {
    const birthFact: Fact = {
      id: 'f-birth',
      worldId: world.id,
      branchId: '00000000-0000-0000-0000-000000000001',
      subjectEntityId: malcolm.id,
      predicateKey: 'born',
      objectKind: 'scalar',
      value: 500,
      validFromTick: 500n, // born at 500, scene is at 400!
      canonStatus: 'canon',
      sourceKind: 'manual',
      createdRevision: 1n,
      revisionFrom: 1n,
      revisionTo: null,
    };
    const result = reviewSceneContinuity(world, baseScene, [duncan, malcolm, castle, kingdom], [birthFact], [], []);
    expect(result.pass).toBe(false);
    const issue = result.issues.find((i) => i.code === 'UNBORN_CHARACTER');
    expect(issue).toBeDefined();
    expect(issue?.subjectId).toBe(malcolm.id);
    expect(issue?.severity).toBe('blocker');
  });

  it('detects location conflict when character is recorded elsewhere', () => {
    const locFact: Fact = {
      id: 'f-loc',
      worldId: world.id,
      branchId: '00000000-0000-0000-0000-000000000001',
      subjectEntityId: malcolm.id,
      predicateKey: 'location',
      objectKind: 'entity',
      value: null,
      objectEntityId: island.id, // recorded at Remote Island
      validFromTick: 300n,
      validToTick: 500n,
      canonStatus: 'canon',
      sourceKind: 'manual',
      createdRevision: 1n,
      revisionFrom: 1n,
      revisionTo: null,
    };
    // Scene is at castle-id
    const result = reviewSceneContinuity(world, baseScene, [duncan, malcolm, castle, kingdom, island], [locFact], [], []);
    const issue = result.issues.find((i) => i.code === 'LOCATION_CONFLICT');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
  });

  it('does NOT flag location conflict when scene location is a sublocation of character location', () => {
    const locFact: Fact = {
      id: 'f-loc-kingdom',
      worldId: world.id,
      branchId: '00000000-0000-0000-0000-000000000001',
      subjectEntityId: malcolm.id,
      predicateKey: 'location',
      objectKind: 'entity',
      value: null,
      objectEntityId: kingdom.id, // Malcolm recorded in Scotland (kingdom-id)
      validFromTick: 300n,
      validToTick: 500n,
      canonStatus: 'canon',
      sourceKind: 'manual',
      createdRevision: 1n,
      revisionFrom: 1n,
      revisionTo: null,
    };
    // Scene is at castle-id, which has parentEntityId = kingdom-id!
    const result = reviewSceneContinuity(world, baseScene, [duncan, malcolm, castle, kingdom], [locFact], [], []);
    const issue = result.issues.find((i) => i.code === 'LOCATION_CONFLICT');
    expect(issue).toBeUndefined();
  });

  it('detects premature knowledge leak in prose text', () => {
    const secretClaim: Claim = {
      id: 'claim-secret',
      worldId: world.id,
      branchId: '00000000-0000-0000-0000-000000000001',
      predicateKey: 'forbidden_prophecy',
      objectKind: 'scalar',
      value: 'The stars will fall',
      knownByEntityIds: ['prophet-id'], // Duncan does NOT know this!
      truthStatus: 'true',
      claimKind: 'secret',
      sourceRefs: [],
      canonStatus: 'canon',
      createdRevision: 1n,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const leakyScene: Scene = {
      ...baseScene,
      proseText: 'Duncan pondered the forbidden_prophecy quietly.',
    };
    const result = reviewSceneContinuity(world, leakyScene, [duncan, malcolm, castle, kingdom], [], [], [secretClaim]);
    const issue = result.issues.find((i) => i.code === 'PREMATURE_KNOWLEDGE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
  });
});
