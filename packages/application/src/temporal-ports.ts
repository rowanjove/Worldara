import type { CreateEntityTypeInput, Entity, EventCausalLink, EventEffect, EventParticipant, Fact, MapFeature, Relation, RelationType, TemporalExpression, World, WorldEvent, WorldMap } from '@world-codex/domain';

export interface CreateFactInput {
  id: string;
  worldId: string;
  branchId?: string;
  subjectEntityId: string;
  predicateKey: string;
  objectKind: Fact['objectKind'];
  value: unknown;
  objectEntityId?: string;
  validFromTick?: bigint;
  validToTick?: bigint;
  sourceKind: Fact['sourceKind'];
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
}
export interface CreateRelationInput {
  id: string;
  worldId: string;
  branchId?: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationTypeId: string;
  validFromTick?: bigint;
  validToTick?: bigint;
  description: string;
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
}
export interface CreateEventInput {
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
  effectsApplied?: boolean;
  description: string;
}
export interface CreateClaimInput {
  id: string;
  worldId: string;
  branchId?: string;
  subjectEntityId?: string;
  predicateKey: string;
  objectKind: import('@world-codex/domain').Claim['objectKind'];
  value: unknown;
  objectEntityId?: string;
  assertedByEntityId?: string;
  knownByEntityIds: string[];
  validFromTick?: bigint;
  validToTick?: bigint;
  truthStatus: import('@world-codex/domain').ClaimTruthStatus;
  claimKind: import('@world-codex/domain').ClaimKind;
  confidence?: number;
  sourceRefs: string[];
  revisionFrom?: bigint;
  revisionTo?: bigint | null;
}

export interface TemporalRepository {
  getWorld(id: string): Promise<World | null>;
  getEntity(worldId: string, entityId: string): Promise<Entity | null>;
  listEntities(worldId: string): Promise<Entity[]>;
  listSnapshotBaseEntities(worldId: string, asOfRevision?: bigint): Promise<Entity[]>;
  listMaps(worldId: string): Promise<WorldMap[]>;
  listMapFeatures(worldId: string, mapId: string): Promise<MapFeature[]>;
  listAllMapFeatures(worldId: string): Promise<MapFeature[]>;
  listEntityTypes(worldId: string): Promise<import('@world-codex/domain').EntityType[]>;
  createFact(input: CreateFactInput, expectedWorldRevision: bigint): Promise<Fact>;
  listFacts(worldId: string): Promise<Fact[]>;
  createRelationType(input: CreateEntityTypeInput & { forwardLabel: string; inverseLabel: string; symmetric: boolean; sourceTypeIds: string[]; targetTypeIds: string[] }, expectedWorldRevision: bigint): Promise<RelationType>;
  listRelationTypes(worldId: string): Promise<RelationType[]>;
  createRelation(input: CreateRelationInput, expectedWorldRevision: bigint): Promise<Relation>;
  listRelations(worldId: string): Promise<Relation[]>;
  createEvent(input: CreateEventInput, expectedWorldRevision: bigint): Promise<WorldEvent>;
  listEvents(worldId: string): Promise<WorldEvent[]>;
  createClaim(input: CreateClaimInput, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').Claim>;
  getClaim(worldId: string, claimId: string): Promise<import('@world-codex/domain').Claim | null>;
  listClaims(worldId: string): Promise<import('@world-codex/domain').Claim[]>;
  createBranch(input: { id: string; worldId: string; name: string; parentBranchId?: string | null; forkTick?: bigint | null; forkRevision?: bigint | null; status: import('@world-codex/domain').TimelineBranchStatus; now: Date }, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').TimelineBranch>;
  listBranches(worldId: string): Promise<import('@world-codex/domain').TimelineBranch[]>;
  getBranch(worldId: string, branchId: string): Promise<import('@world-codex/domain').TimelineBranch | null>;
}
