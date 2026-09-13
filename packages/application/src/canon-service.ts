import { DomainError, type CanonStatus, type ChangeSet, type ValidationIssue } from '@world-codex/domain';
import type { CanonRepository, CanonStatusChange, CanonTarget, CanonTargetKind, Clock } from './ports';

export function buildChangeSetFromTargets(targets: CanonTarget[]): ChangeSet {
  const entityIds = new Set<string>();
  const factIds = new Set<string>();
  const predicates = new Set<string>();
  const relationIds = new Set<string>();
  const relationTypeIds = new Set<string>();
  const eventIds = new Set<string>();

  for (const target of targets) {
    if ('typeId' in target) {
      entityIds.add(target.id);
    } else if ('predicateKey' in target) {
      factIds.add(target.id);
      predicates.add(target.predicateKey);
      if ('subjectEntityId' in target) {
        entityIds.add(target.subjectEntityId);
        if (target.objectKind === 'entity' && target.objectEntityId) {
          entityIds.add(target.objectEntityId);
        }
      } else if ('subjectId' in target && typeof target.subjectId === 'string') {
        entityIds.add(target.subjectId);
      }
    } else if ('relationTypeId' in target) {
      relationIds.add(target.id);
      relationTypeIds.add(target.relationTypeId);
      entityIds.add(target.sourceEntityId);
      entityIds.add(target.targetEntityId);
    } else if ('eventType' in target) {
      eventIds.add(target.id);
      for (const pId of target.participantIds) {
        entityIds.add(pId);
      }
    }
  }

  return {
    entityIds: entityIds.size ? [...entityIds] : undefined,
    factIds: factIds.size ? [...factIds] : undefined,
    predicates: predicates.size ? [...predicates] : undefined,
    relationIds: relationIds.size ? [...relationIds] : undefined,
    relationTypeIds: relationTypeIds.size ? [...relationTypeIds] : undefined,
    eventIds: eventIds.size ? [...eventIds] : undefined,
  };
}

/**
 * The optional fourth argument contains every target affected by the current
 * batch, with its staged status. Consumers that validate the whole world can
 * use it to replace all of the changed records in one pass.
 * The optional fifth argument contains the inferred ChangeSet for incremental validation.
 */
export type CanonValidator = (
  worldId: string,
  target: CanonTarget,
  nextStatus: CanonStatus,
  stagedTargets?: CanonTarget[],
  changeSet?: ChangeSet,
) => Promise<ValidationIssue[]>;

const transitions: Record<CanonStatus, CanonStatus[]> = {
  draft: ['pending', 'archived'],
  pending: ['canon', 'draft', 'archived'],
  canon: ['retconned', 'archived'],
  retconned: ['archived'],
  archived: [],
};

export class CanonApplicationService {
  constructor(private readonly repository: CanonRepository, private readonly clock: Clock, private readonly validate: CanonValidator) {}

  async changeStatus(worldId: string, kind: CanonTargetKind, id: string, status: CanonStatus, expectedWorldRevision: bigint, reason: string): Promise<CanonTarget> {
    if (!reason.trim()) throw new DomainError('VALIDATION_ERROR', 'A reason is required for Canon status changes', { field: 'reason' });
    const current = await this.lookup(worldId, kind, id);
    if (!transitions[current.canonStatus].includes(status)) throw new DomainError('VALIDATION_ERROR', `Invalid Canon transition ${current.canonStatus} -> ${status}`, { kind, id });
    if (status === 'canon') {
      const stagedTarget = { ...current, canonStatus: status } as CanonTarget;
      const issues = await this.validate(worldId, stagedTarget, status);
      const blocking = issues.filter((issue) => issue.severity === 'error' || issue.severity === 'blocker');
      if (blocking.length) throw new DomainError('VALIDATION_ERROR', 'Canon promotion is blocked by validation issues', { issues: blocking });
    }
    return this.repository.updateCanonStatus(worldId, kind, id, status, expectedWorldRevision, reason.trim(), this.clock.now());
  }

  async changeStatuses(worldId: string, changes: CanonStatusChange[], expectedWorldRevision: bigint, reason: string): Promise<CanonTarget[]> {
    if (!reason.trim()) throw new DomainError('VALIDATION_ERROR', 'A reason is required for Canon status changes', { field: 'reason' });
    if (!changes.length) throw new DomainError('VALIDATION_ERROR', 'At least one Canon status change is required');

    // First stage every transition without validating against the repository's
    // still-unchanged state. A relation/event promoted in the same batch as
    // its entity dependencies must see those dependencies as Canon too.
    const stagedStatus = new Map<string, CanonStatus>();
    const stagedTargets = new Map<string, CanonTarget>();
    const canonCandidates: Array<{ target: CanonTarget; status: CanonStatus; kind: CanonTargetKind; id: string }> = [];
    for (const change of changes) {
      const key = `${change.kind}:${change.id}`;
      const current = await this.lookup(worldId, change.kind, change.id);
      const currentStatus = stagedStatus.get(key) ?? current.canonStatus;
      if (!transitions[currentStatus].includes(change.status)) throw new DomainError('VALIDATION_ERROR', `Invalid Canon transition ${currentStatus} -> ${change.status}`, { kind: change.kind, id: change.id });
      const staged = { ...current, canonStatus: change.status } as CanonTarget;
      stagedTargets.set(key, staged);
      stagedStatus.set(key, change.status);
      if (change.status === 'canon') {
        canonCandidates.push({ target: staged, status: change.status, kind: change.kind, id: change.id });
      }
    }

    const staged = [...stagedTargets.values()];
    const changeSet = buildChangeSetFromTargets(staged);
    const allBlocking: ValidationIssue[] = [];
    for (const candidate of canonCandidates) {
      const issues = await this.validate(worldId, candidate.target, candidate.status, staged, changeSet);
      const blocking = issues.filter((issue) => issue.severity === 'error' || issue.severity === 'blocker');
      if (blocking.length) {
        allBlocking.push(...blocking);
      }
    }
    if (allBlocking.length) {
      const seen = new Set<string>();
      const uniqueBlocking = allBlocking.filter((issue) => {
        const key = `${issue.ruleCode}:${issue.message}:${(issue.relatedIds ?? []).sort().join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      throw new DomainError('VALIDATION_ERROR', 'Canon promotion is blocked by validation issues', { issues: uniqueBlocking });
    }
    return this.repository.updateCanonStatuses(worldId, changes, expectedWorldRevision, reason.trim(), this.clock.now());
  }

  private async lookup(worldId: string, kind: CanonTargetKind, id: string): Promise<CanonTarget & { canonStatus: CanonStatus }> {
    // The repository exposes the mutation as the single write boundary. A dry-run is not needed here;
    // transition validity is also enforced by the concrete repository's current-state lookup.
    const target = await this.repository.getCanonTarget(worldId, kind, id);
    if (!target) throw new DomainError('NOT_FOUND', 'Canon target not found', { kind, id });
    return target;
  }
}
