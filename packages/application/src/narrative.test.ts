import { describe, expect, it } from 'vitest';
import { InMemoryWorldRepository } from './memory-repository';
import { WorldApplicationService } from './service';

function createService() {
  const repo = new InMemoryWorldRepository();
  const service = new WorldApplicationService(
    repo,
    { next: () => crypto.randomUUID() },
    { now: () => new Date('2026-09-11T00:00:00.000Z') }
  );
  return { repo, service };
}

describe('NarrativeService - Plotlines & Foreshadowing Tracking', () => {
  it('supports Plotline CRUD lifecycle and stage progression', async () => {
    const { service } = createService();
    const world = await service.createWorld({ name: 'Narrative World' });
    let rev = world.revision;

    // 1. Create Plotline
    const plotline = await service.createPlotline(
      world.id,
      {
        title: 'Rebellion Arc',
        summary: 'Underground resistance against the tyrant',
        status: 'active',
        currentStage: 'setup',
      },
      rev
    );
    expect(plotline.id).toBeDefined();
    expect(plotline.title).toBe('Rebellion Arc');
    expect(plotline.currentStage).toBe('setup');
    expect(plotline.status).toBe('active');

    // 2. Fetch Plotline
    const fetched = await service.getPlotline(world.id, plotline.id);
    expect(fetched?.title).toBe('Rebellion Arc');

    // 3. Update stage and character references
    const updated = await service.updatePlotline(
      world.id,
      plotline.id,
      {
        currentStage: 'climax',
        summary: 'The battle for the capital begins',
      },
      rev + 1n
    );
    expect(updated.currentStage).toBe('climax');
    expect(updated.summary).toBe('The battle for the capital begins');

    // 4. List Plotlines
    const list = await service.listPlotlines(world.id);
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(plotline.id);

    // 5. Delete Plotline
    await service.deletePlotline(world.id, plotline.id, rev + 2n);
    expect(await service.getPlotline(world.id, plotline.id)).toBeNull();
  });

  it('supports Foreshadowing CRUD and audit detection of PREMATURE_PAYOFF', async () => {
    const { service } = createService();
    const world = await service.createWorld({ name: 'Foreshadowing World' });
    let rev = world.revision;

    const work = await service.createWork(world.id, { title: 'Book 1' }, rev);
    rev++;
    const chapter = await service.createChapter(world.id, work.id, { title: 'Chapter 1' }, rev);
    rev++;

    // Create Setup Scene at tick 100
    const setupScene = await service.createScene(
      world.id,
      chapter.id,
      { title: 'The Dagger Hidden in the Study', sceneTick: 100n, orderIndex: 1, proseText: 'He hid the poisoned dagger behind the bookcase.' },
      rev
    );
    rev++;

    // Create Payoff Scene at tick 50 (BEFORE setup!)
    const prematurePayoffScene = await service.createScene(
      world.id,
      chapter.id,
      { title: 'The Poison Kills the King', sceneTick: 50n, orderIndex: 2, proseText: 'The poison on the dagger took effect instantly.' },
      rev
    );
    rev++;

    // Create Foreshadowing linking them
    const foreshadowing = await service.createForeshadowing(
      world.id,
      {
        title: 'Poisoned Dagger',
        description: 'Dagger planted in the study to poison the king',
        setupSceneId: setupScene.id,
        payoffSceneId: prematurePayoffScene.id,
        status: 'resolved',
      },
      rev
    );
    rev++;
    expect(foreshadowing.setupTick).toBe(100n);
    expect(foreshadowing.payoffTick).toBe(50n);

    // Audit should detect PREMATURE_PAYOFF
    const audit = await service.auditForeshadowings(world.id);
    expect(audit.totalForeshadowings).toBe(1);
    expect(audit.resolvedCount).toBe(1);
    const prematureIssue = audit.issues.find((i) => i.code === 'PREMATURE_PAYOFF');
    expect(prematureIssue).toBeDefined();
    expect(prematureIssue?.severity).toBe('blocker');
    expect(prematureIssue?.message).toContain('occurs before setup tick');

    // Continuity review on prematurePayoffScene should also report PREMATURE_PAYOFF blocker
    const sceneReview = await service.reviewSceneContinuity(world.id, prematurePayoffScene.id);
    expect(sceneReview.pass).toBe(false);
    expect(sceneReview.issues.some((i) => i.code === 'PREMATURE_PAYOFF')).toBe(true);
  });

  it('detects ORPHANED_PAYOFF, DUPLICATE_PAYOFF, and UNRESOLVED_FORESHADOWING', async () => {
    const { service } = createService();
    const world = await service.createWorld({ name: 'Audit Test World' });
    let rev = world.revision;

    const work = await service.createWork(world.id, { title: 'Epic' }, rev);
    rev++;
    const chapter = await service.createChapter(world.id, work.id, { title: 'Prologue' }, rev);
    rev++;

    const scene1 = await service.createScene(world.id, chapter.id, { title: 'Scene 1', sceneTick: 10n, orderIndex: 1, proseText: 'A prophecy spoken.' }, rev);
    rev++;
    const scene2 = await service.createScene(world.id, chapter.id, { title: 'Scene 2', sceneTick: 50n, orderIndex: 2, proseText: 'A sword retrieved.' }, rev);
    rev++;

    const plotline = await service.createPlotline(world.id, { title: 'Ancient Prophecy', currentStage: 'resolution', status: 'resolved' }, rev);
    rev++;

    // 1. DUPLICATE_PAYOFF: Two foreshadowings using the same payoff scene in the same plotline
    await service.createForeshadowing(world.id, {
      title: 'Prophecy part 1',
      setupSceneId: scene1.id,
      payoffSceneId: scene2.id,
      plotlineId: plotline.id,
      status: 'resolved',
    }, rev);
    rev++;

    await service.createForeshadowing(world.id, {
      title: 'Prophecy part 2',
      setupSceneId: scene1.id,
      payoffSceneId: scene2.id,
      plotlineId: plotline.id,
      status: 'resolved',
    }, rev);
    rev++;

    // 2. UNRESOLVED_FORESHADOWING: Open foreshadowing on a plotline that is already resolved
    await service.createForeshadowing(world.id, {
      title: 'Forgotten Key',
      setupSceneId: scene1.id,
      plotlineId: plotline.id,
      status: 'open',
    }, rev);
    rev++;

    // 3. ORPHANED_PAYOFF: Resolved with no payoff scene
    await service.createForeshadowing(world.id, {
      title: 'Ghostly Message',
      setupSceneId: scene1.id,
      status: 'resolved',
    }, rev);
    rev++;

    const audit = await service.auditForeshadowings(world.id);
    expect(audit.totalForeshadowings).toBe(4);
    expect(audit.openCount).toBe(1);
    expect(audit.resolvedCount).toBe(3);

    expect(audit.issues.some((i) => i.code === 'DUPLICATE_PAYOFF')).toBe(true);
    expect(audit.issues.some((i) => i.code === 'UNRESOLVED_FORESHADOWING')).toBe(true);
    expect(audit.issues.some((i) => i.code === 'ORPHANED_PAYOFF')).toBe(true);
  });
});
