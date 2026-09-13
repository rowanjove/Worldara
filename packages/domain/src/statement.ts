import { DEFAULT_BRANCH_ID, type CanonStatus, type Fact } from './types';

export interface WorldTickRange {
  from?: bigint;
  to?: bigint;
}

export interface RevisionRange {
  from: bigint;
  to?: bigint | null;
}

/** Unified temporal fact. Storage remains Fact; this is the query/read model. */
export interface Statement {
  id: string;
  worldId: string;
  branchId: string;
  subjectEntityId: string;
  predicateKey: string;
  objectKind: Fact['objectKind'];
  objectValue: unknown;
  objectEntityId?: string;
  validRange: WorldTickRange;
  revisionRange: RevisionRange;
  canonStatus: CanonStatus;
  provenance?: { sourceKind: Fact['sourceKind']; sourceRefId?: string };
}

const OPEN_START = -(1n << 63n) - 1n;
const OPEN_END = 1n << 63n;

export function factToStatement(fact: Fact): Statement {
  const revisionFrom = fact.revisionFrom ?? fact.createdRevision ?? 1n;
  const revisionTo = fact.revisionTo !== undefined ? fact.revisionTo : fact.retconnedRevision ?? null;
  return {
    id: fact.id,
    worldId: fact.worldId,
    branchId: fact.branchId || DEFAULT_BRANCH_ID,
    subjectEntityId: fact.subjectEntityId,
    predicateKey: fact.predicateKey,
    objectKind: fact.objectKind,
    objectValue: fact.value,
    ...(fact.objectEntityId === undefined ? {} : { objectEntityId: fact.objectEntityId }),
    validRange: { ...(fact.validFromTick === undefined ? {} : { from: fact.validFromTick }), ...(fact.validToTick === undefined ? {} : { to: fact.validToTick }) },
    revisionRange: { from: revisionFrom, to: revisionTo },
    canonStatus: fact.canonStatus,
    provenance: { sourceKind: fact.sourceKind, ...(fact.sourceRefId === undefined ? {} : { sourceRefId: fact.sourceRefId }) },
  };
}

export function halfOpenRangesOverlap(aFrom: bigint | undefined, aTo: bigint | undefined | null, bFrom: bigint | undefined, bTo: bigint | undefined | null): boolean {
  const leftFrom = aFrom ?? OPEN_START;
  const leftTo = aTo === undefined || aTo === null ? OPEN_END : aTo;
  const rightFrom = bFrom ?? OPEN_START;
  const rightTo = bTo === undefined || bTo === null ? OPEN_END : bTo;
  return leftFrom < rightTo && rightFrom < leftTo;
}

export function statementValidRangesOverlap(left: Statement, right: Statement): boolean {
  return halfOpenRangesOverlap(left.validRange.from, left.validRange.to, right.validRange.from, right.validRange.to);
}

export function statementRevisionRangesOverlap(left: Statement, right: Statement): boolean {
  return halfOpenRangesOverlap(left.revisionRange.from, left.revisionRange.to, right.revisionRange.from, right.revisionRange.to);
}

export interface TemporalRecord {
  branchId?: string;
  validFromTick?: bigint;
  validToTick?: bigint;
  createdRevision?: bigint;
  retconnedRevision?: bigint;
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
}

export function temporalRecordsConflict(left: TemporalRecord, right: TemporalRecord): boolean {
  if ((left.branchId || DEFAULT_BRANCH_ID) !== (right.branchId || DEFAULT_BRANCH_ID)) return false;
  const leftRevisionFrom = left.revisionFrom ?? left.createdRevision ?? 1n;
  const leftRevisionTo = left.revisionTo !== undefined ? left.revisionTo : left.retconnedRevision ?? null;
  const rightRevisionFrom = right.revisionFrom ?? right.createdRevision ?? 1n;
  const rightRevisionTo = right.revisionTo !== undefined ? right.revisionTo : right.retconnedRevision ?? null;
  return halfOpenRangesOverlap(left.validFromTick, left.validToTick, right.validFromTick, right.validToTick)
    && halfOpenRangesOverlap(leftRevisionFrom, leftRevisionTo, rightRevisionFrom, rightRevisionTo);
}

export function factsTemporallyConflict(left: Fact, right: Fact): boolean {
  return temporalRecordsConflict(left, right);
}

export function isStatementVisible(statement: Statement, tick: bigint, asOfRevision: bigint, branchId?: string): boolean {
  const branch = branchId || DEFAULT_BRANCH_ID;
  if (statement.branchId !== branch && !(branch === DEFAULT_BRANCH_ID && statement.branchId === 'main') && !(branch === 'main' && statement.branchId === DEFAULT_BRANCH_ID)) return false;
  if (statement.canonStatus === 'draft') return false;
  if (!halfOpenRangesOverlap(statement.validRange.from, statement.validRange.to, tick, tick + 1n)) return false;
  return halfOpenRangesOverlap(statement.revisionRange.from, statement.revisionRange.to, asOfRevision, asOfRevision + 1n);
}
