import { describe, expect, it, vi } from 'vitest';
import type { Entity, Relation, ValidationIssue } from '@world-codex/domain';
import { CanonApplicationService } from './canon-service';
import type { CanonRepository, CanonStatusChange, CanonTarget, CanonTargetKind } from './ports';

const now = new Date('2026-01-01T00:00:00.000Z');

const entity = (id: string, canonStatus: Entity['canonStatus']): Entity => ({
  id,
  worldId: 'world-1',
  typeId: 'character',
  name: id,
  subtitle: '',
  parentEntityId: null,
  document: {},
  documentText: '',
  tags: [],
  canonStatus,
  revision: 1n,
  createdAt: now,
  updatedAt: now,
});

const relation = (id: string, sourceEntityId: string, targetEntityId: string, canonStatus: Relation['canonStatus']): Relation => ({
  id,
  worldId: 'world-1',
  sourceEntityId,
  targetEntityId,
  relationTypeId: 'knows',
  description: '',
  canonStatus,
});

class TestCanonRepository implements CanonRepository {
  public readonly updates: CanonStatusChange[][] = [];

  constructor(private readonly targets: Record<CanonTargetKind, CanonTarget[]>) {}

  async getCanonTarget(_worldId: string, kind: CanonTargetKind, id: string): Promise<CanonTarget | null> {
    return this.targets[kind].find((target) => target.id === id) ?? null;
  }

  async updateCanonStatus(_worldId: string, kind: CanonTargetKind, id: string, status: CanonTarget['canonStatus']): Promise<CanonTarget> {
    const target = await this.getCanonTarget(_worldId, kind, id);
    if (!target) throw new Error('missing target');
    const updated = { ...target, canonStatus: status } as CanonTarget;
    this.targets[kind] = this.targets[kind].map((item) => item.id === id ? updated : item);
    return updated;
  }

  async updateCanonStatuses(_worldId: string, changes: CanonStatusChange[]): Promise<CanonTarget[]> {
    this.updates.push(changes);
    const result: CanonTarget[] = [];
    for (const change of changes) result.push(await this.updateCanonStatus(_worldId, change.kind, change.id, change.status));
    return result;
  }
}

const blocking = (message: string): ValidationIssue => ({
  ruleCode: 'TEST_BLOCK',
  severity: 'error',
  relatedIds: [],
  message,
  evidence: [],
});

describe('CanonApplicationService batch validation', () => {
  it('validates every promotion against the complete staged target set', async () => {
    const hero = entity('hero', 'pending');
    const ally = entity('ally', 'pending');
    const friendship = relation('friendship', hero.id, ally.id, 'pending');
    const repository = new TestCanonRepository({ entity: [hero, ally], fact: [], relation: [friendship], event: [], claim: [] });
    const seenBatches: CanonTarget[][] = [];
    const validate = vi.fn(async (_worldId: string, target: CanonTarget, _status: Entity['canonStatus'], stagedTargets?: CanonTarget[]) => {
      seenBatches.push(stagedTargets ?? []);
      if ('sourceEntityId' in target) {
        const stagedIds = new Set((stagedTargets ?? []).filter((item) => item.canonStatus === 'canon').map((item) => item.id));
        if (!stagedIds.has(target.sourceEntityId) || !stagedIds.has(target.targetEntityId)) return [blocking('relation endpoint is not Canon')];
      }
      return [];
    });
    const service = new CanonApplicationService(repository, { now: () => now }, validate);

    const result = await service.changeStatuses('world-1', [
      { kind: 'entity', id: hero.id, status: 'canon' },
      { kind: 'entity', id: ally.id, status: 'canon' },
      { kind: 'relation', id: friendship.id, status: 'canon' },
    ], 1n, 'Approve connected records');

    expect(result.map((item) => item.id)).toEqual([hero.id, ally.id, friendship.id]);
    expect(repository.updates).toHaveLength(1);
    expect(validate).toHaveBeenCalledTimes(3);
    expect(seenBatches).toHaveLength(3);
    for (const batch of seenBatches) expect(batch.map((item) => [item.id, item.canonStatus])).toEqual([
      [hero.id, 'canon'],
      [ally.id, 'canon'],
      [friendship.id, 'canon'],
    ]);
  });

  it('keeps rejecting a batch whose dependency remains draft', async () => {
    const hero = entity('hero', 'draft');
    const friendship = relation('friendship', hero.id, hero.id, 'pending');
    const repository = new TestCanonRepository({ entity: [hero], fact: [], relation: [friendship], event: [], claim: [] });
    const validate = async (_worldId: string, target: CanonTarget, _status: Entity['canonStatus'], stagedTargets?: CanonTarget[]) => {
      if ('sourceEntityId' in target) {
        const stagedHero = stagedTargets?.find((item) => item.id === target.sourceEntityId);
        if (stagedHero?.canonStatus !== 'canon') return [blocking('relation endpoint is not Canon')];
      }
      return [];
    };
    const service = new CanonApplicationService(repository, { now: () => now }, validate);

    await expect(service.changeStatuses('world-1', [{ kind: 'relation', id: friendship.id, status: 'canon' }], 1n, 'Approve relation')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.updates).toHaveLength(0);
  });

  it('retains the single-target validation call shape', async () => {
    const hero = entity('hero', 'pending');
    const repository = new TestCanonRepository({ entity: [hero], fact: [], relation: [], event: [], claim: [] });
    const validate = vi.fn(async (_worldId: string, _target: CanonTarget, _status: Entity['canonStatus']) => []);
    const service = new CanonApplicationService(repository, { now: () => now }, validate);

    await service.changeStatus('world-1', 'entity', hero.id, 'canon', 1n, 'Approve entity');

    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0]).toHaveLength(3);
    expect(repository.updates).toHaveLength(0);
  });
});
