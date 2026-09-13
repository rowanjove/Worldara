import type { Asset, CanonStatus, Chapter, Claim, CreateChapterInput, CreateEntityInput, CreateEntityTypeInput, CreateForeshadowingInput, CreatePlotlineInput, CreateSceneInput, CreateValidationRuleInput, CreateWorkInput, CreateWorldInput, Entity, EntityType, EntityTypeVersion, Fact, Foreshadowing, MapFeature, MapLayer, Plotline, Relation, Scene, UpdateChapterInput, UpdateForeshadowingInput, UpdatePlotlineInput, UpdateSceneInput, UpdateValidationRuleInput, UpdateWorkInput, ValidationRule, Work, World, WorldEvent, WorldMap } from '@world-codex/domain';
import type { CalendarDefinition } from '@world-codex/calendar';

export interface CalendarRecord {
  id: string;
  worldId: string;
  name: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarVersionRecord {
  id: string;
  worldId: string;
  calendarId: string;
  version: number;
  definition: CalendarDefinition;
  createdRevision: bigint;
  createdAt: Date;
}

export interface CalendarRepository {
  createCalendar(input: { id: string; versionId: string; worldId: string; name: string; definition: CalendarDefinition; now: Date }, expectedWorldRevision: bigint): Promise<{ calendar: CalendarRecord; version: CalendarVersionRecord }>;
  listCalendars(worldId: string): Promise<CalendarRecord[]>;
  listCalendarVersions(worldId: string, calendarId: string): Promise<CalendarVersionRecord[]>;
  getCalendarVersion(worldId: string, versionId: string): Promise<CalendarVersionRecord | null>;
  createCalendarVersion(input: { id: string; worldId: string; calendarId: string; definition: CalendarDefinition; now: Date }, expectedWorldRevision: bigint): Promise<CalendarVersionRecord>;
  setDefaultCalendarVersion(worldId: string, versionId: string, expectedWorldRevision: bigint): Promise<World>;
}

export interface AssetRepository {
  createAsset(input: { id: string; worldId: string; storageKey: string; mediaType: string; byteSize: bigint; sha256: string; metadata: Record<string, unknown>; scanStatus: Asset['scanStatus']; scanMessage: string; now: Date }, expectedWorldRevision: bigint): Promise<Asset>;
  getAsset(worldId: string, assetId: string): Promise<Asset | null>;
  listAssets(worldId: string): Promise<Asset[]>;
}

export interface ValidationRuleRepository {
  createValidationRule(input: CreateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule>;
  getValidationRule(worldId: string, ruleId: string): Promise<ValidationRule | null>;
  listValidationRules(worldId: string): Promise<ValidationRule[]>;
  updateValidationRule(worldId: string, ruleId: string, patch: UpdateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule>;
  deleteValidationRule(worldId: string, ruleId: string, expectedWorldRevision: bigint): Promise<void>;
}

export interface NarrativeRepository {
  createWork(input: CreateWorkInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Work>;
  getWork(worldId: string, workId: string): Promise<Work | null>;
  listWorks(worldId: string): Promise<Work[]>;
  updateWork(worldId: string, workId: string, patch: UpdateWorkInput, expectedWorldRevision: bigint, now: Date): Promise<Work>;
  deleteWork(worldId: string, workId: string, expectedWorldRevision: bigint): Promise<void>;

  createChapter(input: CreateChapterInput & { id: string; worldId: string; workId: string; now: Date }, expectedWorldRevision: bigint): Promise<Chapter>;
  getChapter(worldId: string, chapterId: string): Promise<Chapter | null>;
  listChapters(worldId: string, workId?: string): Promise<Chapter[]>;
  updateChapter(worldId: string, chapterId: string, patch: UpdateChapterInput, expectedWorldRevision: bigint, now: Date): Promise<Chapter>;
  deleteChapter(worldId: string, chapterId: string, expectedWorldRevision: bigint): Promise<void>;

  createScene(input: CreateSceneInput & { id: string; worldId: string; workId: string; chapterId: string; now: Date }, expectedWorldRevision: bigint): Promise<Scene>;
  getScene(worldId: string, sceneId: string): Promise<Scene | null>;
  listScenes(worldId: string, chapterId?: string): Promise<Scene[]>;
  updateScene(worldId: string, sceneId: string, patch: UpdateSceneInput, expectedWorldRevision: bigint, now: Date): Promise<Scene>;
  deleteScene(worldId: string, sceneId: string, expectedWorldRevision: bigint): Promise<void>;

  createPlotline(input: CreatePlotlineInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Plotline>;
  getPlotline(worldId: string, plotlineId: string): Promise<Plotline | null>;
  listPlotlines(worldId: string): Promise<Plotline[]>;
  updatePlotline(worldId: string, plotlineId: string, patch: UpdatePlotlineInput, expectedWorldRevision: bigint, now: Date): Promise<Plotline>;
  deletePlotline(worldId: string, plotlineId: string, expectedWorldRevision: bigint): Promise<void>;

  createForeshadowing(input: CreateForeshadowingInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Foreshadowing>;
  getForeshadowing(worldId: string, foreshadowingId: string): Promise<Foreshadowing | null>;
  listForeshadowings(worldId: string, plotlineId?: string): Promise<Foreshadowing[]>;
  updateForeshadowing(worldId: string, foreshadowingId: string, patch: UpdateForeshadowingInput, expectedWorldRevision: bigint, now: Date): Promise<Foreshadowing>;
  deleteForeshadowing(worldId: string, foreshadowingId: string, expectedWorldRevision: bigint): Promise<void>;
}

export interface WorldRepository extends CalendarRepository, AssetRepository, ValidationRuleRepository, NarrativeRepository {
  createWorld(input: CreateWorldInput): Promise<World>;
  deleteWorld(id: string): Promise<void>;
  listRevisions(worldId: string, limit: number): Promise<RevisionRecord[]>;
  listRevisionChanges(worldId: string, sequence: bigint): Promise<ChangeRecord[]>;
  listWorlds(includeArchived?: boolean): Promise<World[]>;
  getWorld(id: string): Promise<World | null>;
  archiveWorld(id: string, expectedRevision: bigint, archived: boolean): Promise<World>;
  updateWorld(id: string, expectedRevision: bigint, patch: Partial<Pick<World, 'name' | 'description' | 'genre' | 'canonStrategy'>>): Promise<World>;
  updateWorldTime(id: string, expectedRevision: bigint, tick: bigint): Promise<World>;
  createEntity(input: CreateEntityInput, expectedWorldRevision: bigint): Promise<Entity>;
  getEntity(worldId: string, entityId: string): Promise<Entity | null>;
  listEntities(worldId: string): Promise<Entity[]>;
  updateEntity(worldId: string, entityId: string, expectedWorldRevision: bigint, patch: Partial<Pick<Entity, 'name' | 'subtitle' | 'parentEntityId' | 'document' | 'documentText' | 'tags'>>, now: Date): Promise<Entity>;
  createEntityType(input: CreateEntityTypeInput, expectedWorldRevision: bigint): Promise<EntityType>;
  listEntityTypes(worldId: string): Promise<EntityType[]>;
  createEntityTypeVersion(worldId: string, entityTypeId: string, schema: Record<string, unknown>, expectedWorldRevision: bigint, now: Date): Promise<EntityTypeVersion>;
  listEntityTypeVersions(worldId: string, entityTypeId: string): Promise<EntityTypeVersion[]>;
  search(worldId: string, query: string, limit: number): Promise<SearchResult[]>;
  createMap(input: { id: string; worldId: string; name: string; crs: string; width: number; height: number; assetId?: string; now: Date }, expectedWorldRevision: bigint): Promise<WorldMap>;
  listMaps(worldId: string): Promise<WorldMap[]>;
  createMapLayer(input: { id: string; worldId: string; mapId: string; name: string; kind: MapLayer['kind']; sortOrder: number; visible: boolean; opacity: number; style: Record<string, unknown>; now: Date }, expectedWorldRevision: bigint): Promise<MapLayer>;
  listMapLayers(worldId: string, mapId: string): Promise<MapLayer[]>;
  updateMapLayer(worldId: string, mapId: string, layerId: string, patch: Partial<Pick<MapLayer, 'name' | 'kind' | 'sortOrder' | 'visible' | 'opacity' | 'style'>>, expectedWorldRevision: bigint, now: Date): Promise<MapLayer>;
  createMapFeature(input: { id: string; worldId: string; mapId: string; layerId?: string; entityId?: string; kind: MapFeature['kind']; geometry: Record<string, unknown>; properties: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint; now: Date }, expectedWorldRevision: bigint): Promise<MapFeature>;
  createMapFeatures(inputs: Array<{ id: string; worldId: string; mapId: string; layerId?: string; entityId?: string; kind: MapFeature['kind']; geometry: Record<string, unknown>; properties: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint; now: Date }>, expectedWorldRevision: bigint): Promise<MapFeature[]>;
  listMapFeatures(worldId: string, mapId: string): Promise<MapFeature[]>;
}

export interface RevisionRecord {
  id: string;
  worldId: string;
  sequence: bigint;
  actorType: 'user' | 'ai' | 'import' | 'system';
  sourceKind: string;
  reason: string;
  changeSetHash: string;
  recordedAt: Date;
}

export interface ChangeRecord {
  id: string;
  worldId: string;
  revisionId: string;
  sequence: bigint;
  objectType: string;
  objectId: string;
  operation: 'create' | 'update' | 'delete' | 'retcon';
  patch: Record<string, unknown>;
}

export interface SearchResult { kind: 'entity' | 'fact' | 'relation' | 'event' | 'claim' | 'rule' | 'work' | 'scene'; id: string; title: string; snippet: string; }

export type CanonTargetKind = 'entity' | 'fact' | 'relation' | 'event' | 'claim';
export type CanonTarget = Entity | Fact | Relation | WorldEvent | Claim;
export interface CanonStatusChange { kind: CanonTargetKind; id: string; status: CanonStatus; }
export interface CanonRepository {
  getCanonTarget(worldId: string, kind: CanonTargetKind, id: string): Promise<CanonTarget | null>;
  updateCanonStatus(worldId: string, kind: CanonTargetKind, id: string, status: CanonStatus, expectedWorldRevision: bigint, reason: string, now: Date): Promise<CanonTarget>;
  updateCanonStatuses(worldId: string, changes: CanonStatusChange[], expectedWorldRevision: bigint, reason: string, now: Date): Promise<CanonTarget[]>;
}

export interface IdGenerator { next(): string; }
export interface Clock { now(): Date; }

export interface IdempotencyRecord {
  requestHash: string;
  response: unknown;
  statusCode?: number;
  createdAt?: Date;
  state?: 'inflight' | 'completed';
  leaseUntil?: Date;
}

export interface IdempotencyClaim {
  status: 'acquired' | 'completed' | 'inflight' | 'conflict';
  record?: IdempotencyRecord;
}

export interface IdempotencyRepository {
  getIdempotency(worldId: string, key: string): Promise<IdempotencyRecord | null>;
  putIdempotency(worldId: string, key: string, record: IdempotencyRecord): Promise<void>;
  getOperationIdempotency(scope: string, key: string): Promise<IdempotencyRecord | null>;
  putOperationIdempotency(scope: string, key: string, record: IdempotencyRecord): Promise<void>;
  claimOperationIdempotency?(scope: string, key: string, requestHash: string, leaseMs: number): Promise<IdempotencyClaim>;
  releaseOperationIdempotency?(scope: string, key: string, requestHash: string): Promise<void>;
}
