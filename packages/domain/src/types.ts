export type CanonStatus = 'draft' | 'pending' | 'canon' | 'retconned' | 'archived';
export type CanonStrategy = 'strict' | 'lenient';

export type TimelineBranchStatus = 'main' | 'sandbox' | 'alternate' | 'archived';
export const DEFAULT_BRANCH_ID = '00000000-0000-0000-0000-000000000001';
export const DEFAULT_BRANCH_NAME = 'main';

export interface TimelineBranch {
  id: string;
  worldId: string;
  name: string;
  parentBranchId?: string | null;
  forkTick?: bigint | null;
  forkRevision?: bigint | null;
  status: TimelineBranchStatus;
  createdAt: Date;
}

export interface World {
  id: string;
  ownerId: string | null;
  name: string;
  slug: string;
  description: string;
  genre: string;
  canonStrategy: CanonStrategy;
  /** The immutable calendar version used when a caller does not provide one. */
  defaultCalendarVersionId?: string | null;
  currentTick: bigint;
  revision: bigint;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
}

export interface Entity {
  id: string;
  worldId: string;
  typeId: string;
  /** Schema version used when this entity was last written/validated. */
  schemaVersion?: number;
  name: string;
  subtitle: string;
  parentEntityId: string | null;
  document: Record<string, unknown>;
  documentText: string;
  tags: string[];
  canonStatus: CanonStatus;
  revision: bigint;
  /** Transaction-time provenance for historical snapshots. */
  createdRevision?: bigint;
  pendingRevision?: bigint;
  canonRevision?: bigint;
  retconnedRevision?: bigint;
  sourceKind?: 'manual' | 'ai' | 'import' | 'event';
  sourceRefId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityType {
  id: string;
  worldId: string;
  typeKey: string;
  label: string;
  schemaVersion: number;
  schema: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityTypeVersion {
  id: string;
  worldId: string;
  entityTypeId: string;
  schemaVersion: number;
  schema: Record<string, unknown>;
  createdRevision: bigint;
  createdAt: Date;
}

export interface Fact {
  id: string;
  worldId: string;
  branchId?: string;
  subjectEntityId: string;
  predicateKey: string;
  objectKind: 'scalar' | 'entity' | 'json';
  value: unknown;
  objectEntityId?: string;
  validFromTick?: bigint;
  validToTick?: bigint;
  canonStatus: CanonStatus;
  sourceKind: 'manual' | 'ai' | 'import' | 'event';
  sourceRefId?: string;
  createdRevision?: bigint;
  pendingRevision?: bigint;
  canonRevision?: bigint;
  retconnedRevision?: bigint;
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
}

export type ClaimTruthStatus = 'true' | 'false' | 'disputed' | 'unknown' | 'author_undecided';

export type ClaimKind =
  | 'belief'
  | 'rumor'
  | 'official_record'
  | 'testimony'
  | 'prophecy'
  | 'legend'
  | 'secret'
  | 'hypothesis';

export interface Claim {
  id: string;
  worldId: string;
  branchId?: string;
  subjectEntityId?: string;
  predicateKey: string;
  objectKind: 'scalar' | 'entity' | 'json';
  value: unknown;
  objectEntityId?: string;
  assertedByEntityId?: string;
  knownByEntityIds: string[];
  validFromTick?: bigint;
  validToTick?: bigint;
  truthStatus: ClaimTruthStatus;
  claimKind: ClaimKind;
  confidence?: number;
  sourceRefs: string[];
  canonStatus: CanonStatus;
  createdRevision?: bigint;
  pendingRevision?: bigint;
  canonRevision?: bigint;
  retconnedRevision?: bigint;
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelationType {
  id: string;
  worldId: string;
  forwardLabel: string;
  inverseLabel: string;
  symmetric: boolean;
  sourceTypeIds: string[];
  targetTypeIds: string[];
}

export interface Relation {
  id: string;
  worldId: string;
  branchId?: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationTypeId: string;
  validFromTick?: bigint;
  validToTick?: bigint;
  description: string;
  canonStatus: CanonStatus;
  sourceKind?: 'manual' | 'ai' | 'import' | 'event';
  sourceRefId?: string;
  createdRevision?: bigint;
  pendingRevision?: bigint;
  canonRevision?: bigint;
  retconnedRevision?: bigint;
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
}

export type EventEffectType = 'SET_FACT' | 'SET_FIELD' | 'ADD_FACT' | 'END_FACT' | 'ADD_RELATION' | 'END_RELATION' | 'REMOVE_RELATION' | 'CREATE_ENTITY' | 'ARCHIVE_ENTITY' | 'MOVE_ENTITY' | 'CHANGE_GEOMETRY' | 'SET_STATUS';

export interface EventEffect {
  id: string;
  type: EventEffectType;
  targetId?: string;
  payload: Record<string, unknown>;
  sequence: number;
}

export interface EventParticipant {
  entityId: string;
  role: string;
}

export type WorldDatePrecision =
  | 'exact'
  | 'day'
  | 'month'
  | 'year'
  | 'decade'
  | 'century'
  | 'era'
  | 'approximate'
  | 'unknown';

export interface TemporalExpression {
  kind: 'point' | 'span' | 'approximate' | 'relative' | 'unknown';
  startTick?: bigint;
  endTick?: bigint;
  precision?: WorldDatePrecision;
  relativeToEventId?: string;
  relativeOffsetTicks?: bigint;
  displayLabel?: string;
}

export type EventCausalRelationKind =
  | 'causes'
  | 'triggers'
  | 'enables'
  | 'prevents'
  | 'results_in'
  | 'contradicts';

export interface EventCausalLink {
  targetEventId: string;
  kind: EventCausalRelationKind;
  description?: string;
}

export interface WorldEvent {
  id: string;
  worldId: string;
  branchId?: string;
  name: string;
  eventType: string;
  startTick: bigint;
  endTick?: bigint;
  temporalExpression?: TemporalExpression;
  causalLinks?: EventCausalLink[];
  participantIds: string[];
  participantRoles?: EventParticipant[];
  requiredRoles?: string[];
  locationEntityIds: string[];
  causeEventIds: string[];
  resultEventIds: string[];
  effects: EventEffect[];
  /** True when the effects are already represented by materialized records. */
  effectsApplied?: boolean;
  description: string;
  canonStatus: CanonStatus;
  createdRevision?: bigint;
  pendingRevision?: bigint;
  canonRevision?: bigint;
  retconnedRevision?: bigint;
}

export interface WorldMap {
  id: string;
  worldId: string;
  name: string;
  crs: string;
  width: number;
  height: number;
  assetId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MapLayer {
  id: string;
  worldId: string;
  mapId: string;
  name: string;
  kind: 'base' | 'overlay' | 'annotation';
  sortOrder: number;
  visible: boolean;
  opacity: number;
  style: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type AssetScanStatus = 'passed' | 'rejected';
export interface Asset {
  id: string;
  worldId: string;
  storageKey: string;
  mediaType: string;
  byteSize: bigint;
  sha256: string;
  metadata: Record<string, unknown>;
  scanStatus: AssetScanStatus;
  scanMessage: string;
  createdAt: Date;
}

export interface MapFeature {
  id: string;
  worldId: string;
  branchId?: string;
  mapId: string;
  layerId?: string;
  entityId?: string;
  kind: 'marker' | 'polygon' | 'polyline' | 'label';
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
  validFromTick?: bigint;
  validToTick?: bigint;
  sourceKind?: 'manual' | 'ai' | 'import' | 'event';
  sourceRefId?: string;
  createdRevision?: bigint;
  pendingRevision?: bigint;
  canonRevision?: bigint;
  retconnedRevision?: bigint;
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ValidationSeverity = 'info' | 'suggestion' | 'warning' | 'error' | 'blocker';
export interface ValidationIssue {
  ruleCode: string;
  severity: ValidationSeverity;
  subjectId?: string;
  relatedIds: string[];
  eventId?: string;
  message: string;
  evidence: string[];
}

export type RuleTargetKind = 'entity' | 'fact' | 'relation' | 'event' | 'world';

export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { field: string; equals?: unknown }
  | { field: string; not_equals?: unknown }
  | { field: string; exists: boolean }
  | { field: string; not_exists: boolean }
  | { field: string; lt: number | string | bigint }
  | { field: string; lte: number | string | bigint }
  | { field: string; gt: number | string | bigint }
  | { field: string; gte: number | string | bigint }
  | { fact: string; equals?: unknown }
  | { fact: string; not_equals?: unknown }
  | { fact: string; exists: boolean }
  | { fact: string; not_exists: boolean }
  | { fact: string; lt: number | string | bigint }
  | { fact: string; lte: number | string | bigint }
  | { fact: string; gt: number | string | bigint }
  | { fact: string; gte: number | string | bigint }
  | {
      count: {
        target: 'facts' | 'relations' | 'events' | 'participants';
        where?: RuleCondition | undefined;
        equals?: number | undefined;
        not_equals?: number | undefined;
        lt?: number | undefined;
        lte?: number | undefined;
        gt?: number | undefined;
        gte?: number | undefined;
      };
    }
  | {
      duration_between: {
        from: string;
        to: string;
        equals?: number | string | bigint | undefined;
        not_equals?: number | string | bigint | undefined;
        lt?: number | string | bigint | undefined;
        lte?: number | string | bigint | undefined;
        gt?: number | string | bigint | undefined;
        gte?: number | string | bigint | undefined;
      };
    }
  | {
      relation_exists: {
        relationTypeId?: string | undefined;
        forwardLabel?: string | undefined;
        targetEntityId?: string | undefined;
        direction?: 'outgoing' | 'incoming' | 'both' | undefined;
      };
    }
  | {
      active_at: {
        tick?: bigint | string | number | undefined;
        field?: string | undefined;
      };
    };

export interface RuleTargetSelector {
  typeKey?: string | undefined;
  typeId?: string | undefined;
  predicateKey?: string | undefined;
  relationTypeId?: string | undefined;
  eventType?: string | undefined;
}

export interface ValidationRule {
  id: string;
  worldId: string;
  name: string;
  description?: string | undefined;
  severity: ValidationSeverity;
  target: RuleTargetKind;
  targetSelector?: RuleTargetSelector | undefined;
  when?: RuleCondition | undefined;
  assert: RuleCondition;
  message?: string | undefined;
  enabled: boolean;
  createdRevision?: bigint | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateValidationRuleInput {
  id: string;
  worldId: string;
  name: string;
  description?: string | undefined;
  severity?: ValidationSeverity | undefined;
  target?: RuleTargetKind | undefined;
  targetSelector?: RuleTargetSelector | undefined;
  when?: RuleCondition | undefined;
  assert: RuleCondition;
  message?: string | undefined;
  enabled?: boolean | undefined;
  now?: Date | undefined;
}

export interface UpdateValidationRuleInput {
  name?: string | undefined;
  description?: string | undefined;
  severity?: ValidationSeverity | undefined;
  target?: RuleTargetKind | undefined;
  targetSelector?: RuleTargetSelector | undefined;
  when?: RuleCondition | undefined;
  assert?: RuleCondition | undefined;
  message?: string | undefined;
  enabled?: boolean | undefined;
}

export interface ChangeSet {
  entityIds?: string[] | undefined;
  factIds?: string[] | undefined;
  predicates?: string[] | undefined;
  relationIds?: string[] | undefined;
  relationTypeIds?: string[] | undefined;
  eventIds?: string[] | undefined;
  ruleIds?: string[] | undefined;
}

export interface RuleDependency {
  ruleCode: string;
  predicates?: string[] | undefined;
  entityTypes?: string[] | undefined;
  relationTypeIds?: string[] | undefined;
  eventTypes?: string[] | undefined;
  targetKinds?: RuleTargetKind[] | undefined;
  touchesEntities?: boolean | undefined;
  touchesRelations?: boolean | undefined;
  touchesEvents?: boolean | undefined;
}

export interface IncrementalValidationResult {
  issues: ValidationIssue[];
  affectedRuleCodes: string[];
  skippedRuleCodes: string[];
  impactedEntityIds: string[];
  isIncremental: boolean;
}

export interface CreateEntityTypeInput {
  id: string;
  worldId: string;
  typeKey: string;
  label: string;
  schema: Record<string, unknown>;
  now: Date;
}

export interface CreateWorldInput {
  id: string;
  ownerId?: string | null;
  name: string;
  slug: string;
  description: string;
  genre: string;
  canonStrategy: CanonStrategy;
  now: Date;
}

export interface CreateEntityInput {
  id: string;
  worldId: string;
  typeId: string;
  schemaVersion?: number;
  /** False only when restoring an entity already materialized by an imported Canon event. */
  snapshotBase?: boolean;
  name: string;
  subtitle: string;
  parentEntityId: string | null;
  document: Record<string, unknown>;
  documentText: string;
  tags: string[];
  now: Date;
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
  }
}

export function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new DomainError('VALIDATION_ERROR', `${field} must not be empty`, { field });
}

export function assertWorldName(name: string): void {
  assertNonEmpty(name, 'name');
  if (name.length > 200) throw new DomainError('VALIDATION_ERROR', 'World name is too long', { field: 'name' });
}

export function assertParentIsAllowed(entity: Entity, parent: Entity | null): void {
  if (!parent) return;
  if (parent.worldId !== entity.worldId) {
    throw new DomainError('WORLD_ACCESS_DENIED', 'Parent entity belongs to another world', { parentId: parent.id });
  }
  if (parent.id === entity.id) {
    throw new DomainError('VALIDATION_ERROR', 'Entity cannot be its own parent', { entityId: entity.id });
  }
}

export type WorkType = 'novel' | 'screenplay' | 'game' | 'campaign' | 'comic' | 'other';
export type SceneStatus = 'outline' | 'draft' | 'revised' | 'final';

export interface Work {
  id: string;
  worldId: string;
  title: string;
  type: WorkType;
  description?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chapter {
  id: string;
  worldId: string;
  workId: string;
  title: string;
  orderIndex: number;
  description?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface Scene {
  id: string;
  worldId: string;
  workId: string;
  chapterId: string;
  title?: string | undefined;
  orderIndex: number;
  sceneTick?: bigint | undefined;
  povCharacterId?: string | undefined;
  locationEntityId?: string | undefined;
  participantEntityIds: string[];
  plotlineIds?: string[] | undefined;
  proseText: string;
  status: SceneStatus;
  canonRevision?: bigint | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export type PlotlineStage = 'setup' | 'development' | 'climax' | 'resolution' | 'unresolved';
export type PlotlineStatus = 'active' | 'resolved' | 'abandoned';

export interface Plotline {
  id: string;
  worldId: string;
  title: string;
  summary: string;
  status: PlotlineStatus;
  currentStage: PlotlineStage;
  characterEntityIds: string[];
  eventIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type ForeshadowingStatus = 'open' | 'resolved' | 'abandoned';

export interface Foreshadowing {
  id: string;
  worldId: string;
  title: string;
  description: string;
  setupSceneId: string;
  setupTick?: bigint | undefined;
  payoffSceneId?: string | undefined;
  payoffTick?: bigint | undefined;
  relatedEntityIds: string[];
  plotlineId?: string | undefined;
  status: ForeshadowingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlotlineInput {
  title: string;
  summary?: string | undefined;
  status?: PlotlineStatus | undefined;
  currentStage?: PlotlineStage | undefined;
  characterEntityIds?: string[] | undefined;
  eventIds?: string[] | undefined;
}

export interface UpdatePlotlineInput {
  title?: string | undefined;
  summary?: string | undefined;
  status?: PlotlineStatus | undefined;
  currentStage?: PlotlineStage | undefined;
  characterEntityIds?: string[] | undefined;
  eventIds?: string[] | undefined;
}

export interface CreateForeshadowingInput {
  title: string;
  description?: string | undefined;
  setupSceneId: string;
  setupTick?: bigint | number | string | undefined;
  payoffSceneId?: string | undefined;
  payoffTick?: bigint | number | string | undefined;
  relatedEntityIds?: string[] | undefined;
  plotlineId?: string | undefined;
  status?: ForeshadowingStatus | undefined;
}

export interface UpdateForeshadowingInput {
  title?: string | undefined;
  description?: string | undefined;
  setupSceneId?: string | undefined;
  setupTick?: bigint | number | string | null | undefined;
  payoffSceneId?: string | null | undefined;
  payoffTick?: bigint | number | string | null | undefined;
  relatedEntityIds?: string[] | undefined;
  plotlineId?: string | null | undefined;
  status?: ForeshadowingStatus | undefined;
}

export interface ForeshadowingReviewIssue {
  code: 'PREMATURE_PAYOFF' | 'DUPLICATE_PAYOFF' | 'ORPHANED_PAYOFF' | 'UNRESOLVED_FORESHADOWING';
  severity: 'warning' | 'error' | 'blocker';
  foreshadowingId: string;
  setupSceneId?: string | undefined;
  payoffSceneId?: string | undefined;
  message: string;
  evidence: string[];
}

export interface ForeshadowingAuditResult {
  totalForeshadowings: number;
  openCount: number;
  resolvedCount: number;
  abandonedCount: number;
  issues: ForeshadowingReviewIssue[];
}

export type ContinuityIssueSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface ContinuityIssue {
  code: string;
  severity: ContinuityIssueSeverity;
  sceneId: string;
  subjectId?: string | undefined;
  message: string;
  evidence: string[];
}

export interface SceneReviewResult {
  sceneId: string;
  pass: boolean;
  issues: ContinuityIssue[];
}

export interface CreateWorkInput {
  title: string;
  type?: WorkType | undefined;
  description?: string | undefined;
}

export interface UpdateWorkInput {
  title?: string | undefined;
  type?: WorkType | undefined;
  description?: string | undefined;
}

export interface CreateChapterInput {
  title: string;
  orderIndex?: number | undefined;
  description?: string | undefined;
}

export interface UpdateChapterInput {
  title?: string | undefined;
  orderIndex?: number | undefined;
  description?: string | undefined;
}

export interface CreateSceneInput {
  title?: string | undefined;
  orderIndex?: number | undefined;
  sceneTick?: bigint | number | string | undefined;
  povCharacterId?: string | undefined;
  locationEntityId?: string | undefined;
  participantEntityIds?: string[] | undefined;
  plotlineIds?: string[] | undefined;
  proseText?: string | undefined;
  status?: SceneStatus | undefined;
  canonRevision?: bigint | number | string | undefined;
}

export interface UpdateSceneInput {
  title?: string | undefined;
  orderIndex?: number | undefined;
  sceneTick?: bigint | number | string | null | undefined;
  povCharacterId?: string | null | undefined;
  locationEntityId?: string | null | undefined;
  participantEntityIds?: string[] | undefined;
  plotlineIds?: string[] | undefined;
  proseText?: string | undefined;
  status?: SceneStatus | undefined;
  canonRevision?: bigint | number | string | null | undefined;
}
