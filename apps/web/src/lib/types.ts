export type CanonStatus = 'draft' | 'pending' | 'canon' | 'retconned' | 'archived';

export interface World {
  id: string;
  name: string;
  genre: string;
  description: string;
  revision: string;
  currentTick?: string;
  archivedAt?: string | null;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SchemaField {
  id?: string;
  key?: string;
  label?: string;
  type?: string;
  value_type?: string;
  cardinality?: 'one' | 'many';
  required?: boolean;
  description?: string;
  storage_mode?: string;
  validation_json?: Record<string, unknown>;
}

export interface EntityType {
  id: string;
  worldId: string;
  typeKey: string;
  label: string;
  schemaVersion: number;
  schema: {
    fields?: SchemaField[];
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface Entity {
  id: string;
  worldId: string;
  typeId: string;
  name: string;
  subtitle: string;
  parentEntityId?: string | null;
  document: Record<string, unknown>;
  documentText?: string;
  tags?: string[];
  canonStatus: CanonStatus;
  revision: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RelationType {
  id: string;
  worldId: string;
  forwardLabel: string;
  inverseLabel?: string;
  symmetric: boolean;
  sourceTypeIds: string[];
  targetTypeIds: string[];
}

export interface Relation {
  id: string;
  worldId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationTypeId: string;
  validFromTick?: string;
  validToTick?: string;
  description: string;
  canonStatus: CanonStatus;
}

export interface WorldEvent {
  id: string;
  worldId: string;
  name: string;
  eventType: string;
  startTick: string;
  endTick?: string;
  participantIds?: string[];
  participantRoles?: Array<{ entityId: string; role: string }>;
  effects?: Array<{
    id?: string;
    type: string;
    targetId?: string;
    payload?: Record<string, unknown>;
    sequence?: number;
  }>;
  canonStatus: CanonStatus;
  description: string;
}

export interface WorldMap {
  id: string;
  worldId: string;
  name: string;
  crs: string;
  width: number;
  height: number;
  assetId?: string;
}

export interface MapLayer {
  id: string;
  mapId: string;
  name: string;
  kind: 'base' | 'overlay' | 'annotation';
  sortOrder: number;
  visible: boolean;
  opacity: number;
  style: Record<string, unknown>;
}

export interface MapFeature {
  id: string;
  mapId: string;
  layerId?: string;
  entityId?: string;
  kind: 'marker' | 'polygon';
  geometry: {
    type: string;
    coordinates: number[] | number[][][];
  };
  style?: Record<string, unknown>;
}

export interface ValidationIssue {
  ruleCode: string;
  severity: 'error' | 'warning' | 'info' | string;
  message: string;
  subjectId?: string;
}

export interface SearchResult {
  kind: string;
  id: string;
  title: string;
  snippet: string;
}

export interface ProposalChange {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  dependsOn: string[];
  evidenceRefs: string[];
  confidence: number;
  userDecision: 'pending' | 'accepted' | 'rejected';
}

export interface Proposal {
  id: string;
  status: string;
  request: string;
  baseRevision: string;
  provider: string;
  model?: string;
  promptVersion: string;
  changes: ProposalChange[];
  citations: string[];
  unknowns: string[];
}

export interface TimelineBranch {
  id: string;
  worldId: string;
  name: string;
  parentBranchId?: string;
  status: 'main' | 'sandbox' | 'alternate' | 'archived';
  createdAt?: string;
}

export interface Claim {
  id: string;
  worldId: string;
  branchId?: string;
  subjectEntityId?: string;
  predicateKey: string;
  objectKind: 'scalar' | 'entity' | 'json';
  value?: unknown;
  objectEntityId?: string;
  assertedByEntityId?: string;
  knownByEntityIds: string[];
  truthStatus: 'true' | 'false' | 'disputed' | 'unknown' | 'author_undecided';
  claimKind: 'belief' | 'rumor' | 'official_record' | 'testimony' | 'prophecy' | 'legend' | 'secret' | 'hypothesis';
  canonStatus: CanonStatus;
}

export interface ValidationRule {
  id: string;
  worldId: string;
  name: string;
  description?: string;
  severity: string;
  target: string;
  assert: Record<string, unknown>;
  message?: string;
  enabled: boolean;
}

export interface Work {
  id: string;
  worldId: string;
  title: string;
  type: string;
  description?: string;
}

export interface Chapter {
  id: string;
  worldId: string;
  workId: string;
  title: string;
  orderIndex: number;
}

export interface Scene {
  id: string;
  worldId: string;
  workId: string;
  chapterId: string;
  title?: string;
  orderIndex: number;
  sceneTick?: string;
  povCharacterId?: string;
  locationEntityId?: string;
  participantEntityIds: string[];
  plotlineIds: string[];
  proseText: string;
  status: string;
}

export interface Plotline {
  id: string;
  worldId: string;
  title: string;
  summary: string;
  status: string;
  currentStage: string;
  characterEntityIds: string[];
  eventIds: string[];
}

export interface ContinuityReview {
  sceneId: string;
  pass: boolean;
  issues: Array<{ code: string; severity: string; message: string }>;
}

export interface WorldSnapshot {
  atTick: string;
  worldRevision: string;
  entities: Entity[];
  facts: Array<{
    id: string;
    subjectEntityId: string;
    predicateKey: string;
    objectKind: string;
    value?: unknown;
    canonStatus: CanonStatus;
  }>;
  relations: Relation[];
  activeEvents: WorldEvent[];
  mapFeatures: MapFeature[];
}
