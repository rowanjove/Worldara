import { randomUUID } from 'node:crypto';
import { DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, DEFAULT_ENTITY_TYPES, DomainError, type Asset, type Chapter, type Claim, type CreateChapterInput, type CreateEntityInput, type CreateEntityTypeInput, type CreateForeshadowingInput, type CreatePlotlineInput, type CreateSceneInput, type CreateValidationRuleInput, type CreateWorkInput, type CreateWorldInput, type Entity, type EntityType, type EntityTypeVersion, type Fact, type Foreshadowing, type MapFeature, type MapLayer, type Plotline, type Relation, type RelationType, type Scene, type TimelineBranch, type TimelineBranchStatus, type UpdateChapterInput, type UpdateForeshadowingInput, type UpdatePlotlineInput, type UpdateSceneInput, type UpdateValidationRuleInput, type UpdateWorkInput, type ValidationRule, type Work, type World, type WorldEvent, type WorldMap } from '@world-codex/domain';
import type { CalendarDefinition } from '@world-codex/calendar';
import type { CalendarRecord, CalendarVersionRecord, CanonRepository, CanonStatusChange, CanonTarget, CanonTargetKind, ChangeRecord, IdempotencyClaim, IdempotencyRecord, IdempotencyRepository, RevisionRecord, SearchResult, WorldRepository } from './ports';
import type { ProposalRecord, ProposalRepository } from './proposal-ports';
import type { CreateClaimInput, CreateEventInput, CreateFactInput, CreateRelationInput, TemporalRepository } from './temporal-ports';
import { materializeEventEffects, type EventMaterializationUndo } from './event-effects';

export class InMemoryWorldRepository implements WorldRepository, TemporalRepository, CanonRepository, IdempotencyRepository, ProposalRepository {
  private readonly worlds = new Map<string, World>();
  private readonly branches = new Map<string, TimelineBranch>();
  private readonly entities = new Map<string, Entity>();
  private readonly snapshotBaseEntities = new Map<string, Entity>();
  private readonly snapshotBaseEntityHistory = new Map<string, SnapshotBaseEntityVersion[]>();
  private readonly entityTypes = new Map<string, EntityType>();
  private readonly entityTypeVersions = new Map<string, EntityTypeVersion>();
  private readonly facts = new Map<string, Fact>();
  private readonly relationTypes = new Map<string, RelationType>();
  private readonly relations = new Map<string, Relation>();
  private readonly events = new Map<string, WorldEvent>();
  private readonly eventMaterializationUndo = new Map<string, EventMaterializationUndo>();
  private readonly claims = new Map<string, Claim>();
  private readonly rules = new Map<string, ValidationRule>();
  private readonly works = new Map<string, Work>();
  private readonly chapters = new Map<string, Chapter>();
  private readonly scenes = new Map<string, Scene>();
  private readonly plotlines = new Map<string, Plotline>();
  private readonly foreshadowings = new Map<string, Foreshadowing>();
  private readonly maps = new Map<string, WorldMap>();
  private readonly mapLayers = new Map<string, MapLayer>();
  private readonly mapFeatures = new Map<string, MapFeature>();
  private readonly assets = new Map<string, Asset>();
  private readonly calendars = new Map<string, CalendarRecord>();
  private readonly calendarVersions = new Map<string, CalendarVersionRecord>();
  private readonly revisions = new Map<string, RevisionRecord[]>();
  private readonly changes = new Map<string, ChangeRecord[]>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly operationIdempotency = new Map<string, IdempotencyRecord>();
  private readonly proposals = new Map<string, ProposalRecord>();


  async createWorld(input: CreateWorldInput): Promise<World> {
    if ([...this.worlds.values()].some((world) => world.slug === input.slug)) throw new DomainError('VALIDATION_ERROR', 'World slug already exists', { slug: input.slug });
    const world: World = { id: input.id, ownerId: input.ownerId ?? null, name: input.name, slug: input.slug, description: input.description, genre: input.genre, canonStrategy: input.canonStrategy, defaultCalendarVersionId: null, currentTick: 0n, revision: 1n, createdAt: input.now, updatedAt: input.now, archivedAt: null };
    this.worlds.set(world.id, world);
    this.recordRevision(world.id, 1n, 'Create world', { objectType: 'world', objectId: world.id, operation: 'create' });
    const defaultBranch: TimelineBranch = {
      id: DEFAULT_BRANCH_ID,
      worldId: world.id,
      name: DEFAULT_BRANCH_NAME,
      parentBranchId: null,
      forkTick: null,
      forkRevision: null,
      status: 'main',
      createdAt: input.now,
    };
    this.branches.set(defaultBranch.id, defaultBranch);
    for (const [typeKey, label] of DEFAULT_ENTITY_TYPES) {
      const type: EntityType = { id: randomUUID(), worldId: world.id, typeKey, label, schemaVersion: 1, schema: {}, createdAt: input.now, updatedAt: input.now };
      this.entityTypes.set(type.id, type);
      const version: EntityTypeVersion = { id: randomUUID(), worldId: world.id, entityTypeId: type.id, schemaVersion: 1, schema: {}, createdRevision: world.revision, createdAt: input.now };
      this.entityTypeVersions.set(version.id, version);
    }
    return world;
  }

  async deleteWorld(id: string): Promise<void> {
    this.worlds.delete(id);
    this.revisions.delete(id);
    this.changes.delete(id);
    for (const [key, value] of this.entityTypes) if (value.worldId === id) this.entityTypes.delete(key);
    for (const [key, value] of this.entityTypeVersions) if (value.worldId === id) this.entityTypeVersions.delete(key);
    for (const [key, value] of this.branches) if (value.worldId === id) this.branches.delete(key);
    for (const [key, value] of this.entities) if (value.worldId === id) this.entities.delete(key);
    for (const [key, value] of this.snapshotBaseEntities) if (value.worldId === id) this.snapshotBaseEntities.delete(key);
    for (const key of [...this.snapshotBaseEntityHistory.keys()]) if (!this.snapshotBaseEntities.has(key)) this.snapshotBaseEntityHistory.delete(key);
    for (const [key, value] of this.facts) if (value.worldId === id) this.facts.delete(key);
    for (const [key, value] of this.relationTypes) if (value.worldId === id) this.relationTypes.delete(key);
    for (const [key, value] of this.relations) if (value.worldId === id) this.relations.delete(key);
    for (const [key, value] of this.events) if (value.worldId === id) this.events.delete(key);
    for (const [key, undo] of this.eventMaterializationUndo) {
      if (undo.entities.some((entity) => entity.worldId === id) || undo.facts.some((fact) => fact.worldId === id) || undo.relations.some((relation) => relation.worldId === id) || undo.mapFeatures.some((feature) => feature.worldId === id)) this.eventMaterializationUndo.delete(key);
    }
    for (const [key, value] of this.maps) if (value.worldId === id) this.maps.delete(key);
    for (const [key, value] of this.mapLayers) if (value.worldId === id) this.mapLayers.delete(key);
    for (const [key, value] of this.mapFeatures) if (value.worldId === id) this.mapFeatures.delete(key);
    for (const [key, value] of this.assets) if (value.worldId === id) this.assets.delete(key);
    for (const [key, value] of this.rules) if (value.worldId === id) this.rules.delete(key);
    for (const [key, value] of this.claims) if (value.worldId === id) this.claims.delete(key);
    for (const [key, value] of this.works) if (value.worldId === id) this.works.delete(key);
    for (const [key, value] of this.chapters) if (value.worldId === id) this.chapters.delete(key);
    for (const [key, value] of this.scenes) if (value.worldId === id) this.scenes.delete(key);
    for (const [key, value] of this.plotlines) if (value.worldId === id) this.plotlines.delete(key);
    for (const [key, value] of this.foreshadowings) if (value.worldId === id) this.foreshadowings.delete(key);
    for (const [key, value] of this.calendars) if (value.worldId === id) this.calendars.delete(key);
    for (const [key, value] of this.calendarVersions) if (value.worldId === id) this.calendarVersions.delete(key);
    for (const key of this.idempotency.keys()) if (key.startsWith(`${id}:`)) this.idempotency.delete(key);
    for (const [key, proposal] of this.proposals) if (proposal.worldId === id) this.proposals.delete(key);
  }

  async getIdempotency(worldId: string, key: string): Promise<IdempotencyRecord | null> { return this.idempotency.get(`${worldId}:${key}`) ?? null; }

  async putIdempotency(worldId: string, key: string, record: IdempotencyRecord): Promise<void> {
    const storageKey = `${worldId}:${key}`;
    if (!this.idempotency.has(storageKey)) this.idempotency.set(storageKey, record);
  }
  async getOperationIdempotency(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const record = this.operationIdempotency.get(`${scope}:${key}`);
    return record && record.state !== 'inflight' ? structuredClone(record) : null;
  }
  async putOperationIdempotency(scope: string, key: string, record: IdempotencyRecord): Promise<void> {
    const storageKey = `${scope}:${key}`;
    const current = this.operationIdempotency.get(storageKey);
    if (current && current.requestHash !== record.requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload');
    const { leaseUntil: _leaseUntil, ...completedRecord } = structuredClone(record);
    this.operationIdempotency.set(storageKey, { ...completedRecord, state: 'completed' });
  }
  async claimOperationIdempotency(scope: string, key: string, requestHash: string, leaseMs: number): Promise<IdempotencyClaim> {
    const storageKey = `${scope}:${key}`;
    const current = this.operationIdempotency.get(storageKey);
    if (current && current.requestHash !== requestHash) return { status: 'conflict', record: structuredClone(current) };
    if (current && current.state !== 'inflight') return { status: 'completed', record: structuredClone(current) };
    const now = Date.now();
    if (current?.leaseUntil && current.leaseUntil.getTime() > now) return { status: 'inflight', record: structuredClone(current) };
    const record: IdempotencyRecord = { requestHash, response: null, statusCode: 102, state: 'inflight', leaseUntil: new Date(now + leaseMs), createdAt: new Date(now) };
    this.operationIdempotency.set(storageKey, record);
    return { status: 'acquired', record: structuredClone(record) };
  }
  async releaseOperationIdempotency(scope: string, key: string, requestHash: string): Promise<void> {
    const storageKey = `${scope}:${key}`;
    const current = this.operationIdempotency.get(storageKey);
    if (current?.state === 'inflight' && current.requestHash === requestHash) this.operationIdempotency.delete(storageKey);
  }

  async createProposal(proposal: ProposalRecord): Promise<ProposalRecord> {
    if (this.proposals.has(proposal.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Proposal ID already exists', { proposalId: proposal.id });
    const stored = structuredClone(proposal);
    this.proposals.set(proposal.id, stored);
    return structuredClone(stored);
  }

  async getProposal(worldId: string, proposalId: string): Promise<ProposalRecord | null> {
    const proposal = this.proposals.get(proposalId);
    return proposal?.worldId === worldId ? structuredClone(proposal) : null;
  }

  async updateProposal(proposal: ProposalRecord): Promise<ProposalRecord> {
    const current = this.proposals.get(proposal.id);
    if (!current || current.worldId !== proposal.worldId) throw new DomainError('NOT_FOUND', 'Proposal not found', { proposalId: proposal.id });
    const stored = structuredClone(proposal);
    this.proposals.set(proposal.id, stored);
    return structuredClone(stored);
  }

  async listWorlds(includeArchived = false): Promise<World[]> { return [...this.worlds.values()].filter((world) => includeArchived || !world.archivedAt).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()); }
  async archiveWorld(id: string, expectedRevision: bigint, archived: boolean): Promise<World> {
    const world = this.worlds.get(id);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: id });
    if (world.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedRevision.toString(), actual: world.revision.toString() });
    const updated: World = { ...world, archivedAt: archived ? new Date() : null, revision: world.revision + 1n, updatedAt: new Date() };
    this.worlds.set(id, updated); this.recordRevision(id, updated.revision, archived ? 'Archive world' : 'Restore world');
    return updated;
  }
  async createAsset(input: { id: string; worldId: string; storageKey: string; mediaType: string; byteSize: bigint; sha256: string; metadata: Record<string, unknown>; scanStatus: Asset['scanStatus']; scanMessage: string; now: Date }, expectedWorldRevision: bigint): Promise<Asset> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if ([...this.assets.values()].some((asset) => asset.worldId === input.worldId && asset.sha256 === input.sha256)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Asset with the same content already exists', { sha256: input.sha256 });
    const asset: Asset = { ...input, metadata: structuredClone(input.metadata), createdAt: input.now };
    this.assets.set(asset.id, asset); this.bumpWorld(world, world.revision + 1n); return asset;
  }
  async getAsset(worldId: string, assetId: string): Promise<Asset | null> { const asset = this.assets.get(assetId); return asset?.worldId === worldId ? asset : null; }
  async listAssets(worldId: string): Promise<Asset[]> { return [...this.assets.values()].filter((asset) => asset.worldId === worldId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); }

  async createValidationRule(input: CreateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.rules.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Validation rule ID already exists', { ruleId: input.id });
    const now = input.now ?? new Date();
    const revision = world.revision + 1n;
    const rule: ValidationRule = {
      id: input.id,
      worldId: input.worldId,
      name: input.name,
      description: input.description ?? '',
      severity: input.severity ?? 'error',
      target: input.target ?? 'entity',
      ...(input.targetSelector ? { targetSelector: structuredClone(input.targetSelector) } : {}),
      ...(input.when ? { when: structuredClone(input.when) } : {}),
      assert: structuredClone(input.assert),
      ...(input.message ? { message: input.message } : {}),
      enabled: input.enabled ?? true,
      createdRevision: revision,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.set(rule.id, rule);
    this.bumpWorld(world, revision, { objectType: 'validation_rule', objectId: rule.id, operation: 'create' });
    return structuredClone(rule);
  }

  async getValidationRule(worldId: string, ruleId: string): Promise<ValidationRule | null> {
    const rule = this.rules.get(ruleId);
    return rule && rule.worldId === worldId ? structuredClone(rule) : null;
  }

  async listValidationRules(worldId: string): Promise<ValidationRule[]> {
    return [...this.rules.values()].filter((r) => r.worldId === worldId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map((r) => structuredClone(r));
  }

  async updateValidationRule(worldId: string, ruleId: string, patch: UpdateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.rules.get(ruleId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Validation rule not found', { ruleId });
    const now = new Date();
    const revision = world.revision + 1n;
    const updated: ValidationRule = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.target !== undefined ? { target: patch.target } : {}),
      ...(patch.targetSelector !== undefined ? { targetSelector: structuredClone(patch.targetSelector) } : {}),
      ...(patch.when !== undefined ? { when: structuredClone(patch.when) } : {}),
      ...(patch.assert !== undefined ? { assert: structuredClone(patch.assert) } : {}),
      ...(patch.message !== undefined ? { message: patch.message } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: now,
    };
    this.rules.set(ruleId, updated);
    this.bumpWorld(world, revision, { objectType: 'validation_rule', objectId: ruleId, operation: 'update', patch: patch as Record<string, unknown> });
    return structuredClone(updated);
  }

  async deleteValidationRule(worldId: string, ruleId: string, expectedWorldRevision: bigint): Promise<void> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.rules.get(ruleId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Validation rule not found', { ruleId });
    const revision = world.revision + 1n;
    this.rules.delete(ruleId);
    this.bumpWorld(world, revision, { objectType: 'validation_rule', objectId: ruleId, operation: 'delete' });
  }

  // --- Narrative Works ---
  async createWork(input: CreateWorkInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Work> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.works.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Work ID already exists', { workId: input.id });
    const revision = world.revision + 1n;
    const work: Work = {
      id: input.id,
      worldId: input.worldId,
      title: input.title,
      type: input.type ?? 'novel',
      description: input.description ?? '',
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.works.set(work.id, work);
    this.bumpWorld(world, revision, { objectType: 'work', objectId: work.id, operation: 'create' });
    return structuredClone(work);
  }

  async getWork(worldId: string, workId: string): Promise<Work | null> {
    const work = this.works.get(workId);
    return work && work.worldId === worldId ? structuredClone(work) : null;
  }

  async listWorks(worldId: string): Promise<Work[]> {
    return [...this.works.values()].filter((w) => w.worldId === worldId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((w) => structuredClone(w));
  }

  async updateWork(worldId: string, workId: string, patch: UpdateWorkInput, expectedWorldRevision: bigint, now: Date): Promise<Work> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.works.get(workId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Work not found', { workId });
    const revision = world.revision + 1n;
    const updated: Work = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: now,
    };
    this.works.set(workId, updated);
    this.bumpWorld(world, revision, { objectType: 'work', objectId: workId, operation: 'update', patch: patch as Record<string, unknown> });
    return structuredClone(updated);
  }

  async deleteWork(worldId: string, workId: string, expectedWorldRevision: bigint): Promise<void> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.works.get(workId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Work not found', { workId });
    const revision = world.revision + 1n;
    this.works.delete(workId);
    for (const [chapterId, chapter] of this.chapters.entries()) {
      if (chapter.workId === workId) {
        this.chapters.delete(chapterId);
        for (const [sceneId, scene] of this.scenes.entries()) {
          if (scene.chapterId === chapterId) {
            this.scenes.delete(sceneId);
          }
        }
      }
    }
    this.bumpWorld(world, revision, { objectType: 'work', objectId: workId, operation: 'delete' });
  }

  // --- Narrative Chapters ---
  async createChapter(input: CreateChapterInput & { id: string; worldId: string; workId: string; now: Date }, expectedWorldRevision: bigint): Promise<Chapter> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.chapters.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Chapter ID already exists', { chapterId: input.id });
    const work = this.works.get(input.workId);
    if (!work || work.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Work not found', { workId: input.workId });
    const revision = world.revision + 1n;
    const chapter: Chapter = {
      id: input.id,
      worldId: input.worldId,
      workId: input.workId,
      title: input.title,
      orderIndex: input.orderIndex ?? 0,
      description: input.description ?? '',
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.chapters.set(chapter.id, chapter);
    this.bumpWorld(world, revision, { objectType: 'chapter', objectId: chapter.id, operation: 'create' });
    return structuredClone(chapter);
  }

  async getChapter(worldId: string, chapterId: string): Promise<Chapter | null> {
    const chapter = this.chapters.get(chapterId);
    return chapter && chapter.worldId === worldId ? structuredClone(chapter) : null;
  }

  async listChapters(worldId: string, workId?: string): Promise<Chapter[]> {
    return [...this.chapters.values()].filter((c) => c.worldId === worldId && (!workId || c.workId === workId)).sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.getTime() - b.createdAt.getTime()).map((c) => structuredClone(c));
  }

  async updateChapter(worldId: string, chapterId: string, patch: UpdateChapterInput, expectedWorldRevision: bigint, now: Date): Promise<Chapter> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.chapters.get(chapterId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId });
    const revision = world.revision + 1n;
    const updated: Chapter = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.orderIndex !== undefined ? { orderIndex: patch.orderIndex } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: now,
    };
    this.chapters.set(chapterId, updated);
    this.bumpWorld(world, revision, { objectType: 'chapter', objectId: chapterId, operation: 'update', patch: patch as Record<string, unknown> });
    return structuredClone(updated);
  }

  async deleteChapter(worldId: string, chapterId: string, expectedWorldRevision: bigint): Promise<void> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.chapters.get(chapterId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId });
    const revision = world.revision + 1n;
    this.chapters.delete(chapterId);
    for (const [sceneId, scene] of this.scenes.entries()) {
      if (scene.chapterId === chapterId) {
        this.scenes.delete(sceneId);
      }
    }
    this.bumpWorld(world, revision, { objectType: 'chapter', objectId: chapterId, operation: 'delete' });
  }

  // --- Narrative Scenes ---
  async createScene(input: CreateSceneInput & { id: string; worldId: string; workId: string; chapterId: string; now: Date }, expectedWorldRevision: bigint): Promise<Scene> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.scenes.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Scene ID already exists', { sceneId: input.id });
    const chapter = this.chapters.get(input.chapterId);
    if (!chapter || chapter.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId: input.chapterId });
    const revision = world.revision + 1n;
    const scene: Scene = {
      id: input.id,
      worldId: input.worldId,
      workId: input.workId,
      chapterId: input.chapterId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      orderIndex: input.orderIndex ?? 0,
      ...(input.sceneTick !== undefined ? { sceneTick: BigInt(input.sceneTick) } : {}),
      ...(input.povCharacterId !== undefined ? { povCharacterId: input.povCharacterId } : {}),
      ...(input.locationEntityId !== undefined ? { locationEntityId: input.locationEntityId } : {}),
      participantEntityIds: input.participantEntityIds ? [...input.participantEntityIds] : [],
      ...(input.plotlineIds !== undefined ? { plotlineIds: [...input.plotlineIds] } : {}),
      proseText: input.proseText ?? '',
      status: input.status ?? 'draft',
      ...(input.canonRevision !== undefined ? { canonRevision: BigInt(input.canonRevision) } : {}),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.scenes.set(scene.id, scene);
    this.bumpWorld(world, revision, { objectType: 'scene', objectId: scene.id, operation: 'create' });
    return structuredClone(scene);
  }

  async getScene(worldId: string, sceneId: string): Promise<Scene | null> {
    const scene = this.scenes.get(sceneId);
    return scene && scene.worldId === worldId ? structuredClone(scene) : null;
  }

  async listScenes(worldId: string, chapterId?: string): Promise<Scene[]> {
    return [...this.scenes.values()].filter((s) => s.worldId === worldId && (!chapterId || s.chapterId === chapterId)).sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.getTime() - b.createdAt.getTime()).map((s) => structuredClone(s));
  }

  async updateScene(worldId: string, sceneId: string, patch: UpdateSceneInput, expectedWorldRevision: bigint, now: Date): Promise<Scene> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.scenes.get(sceneId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId });
    const revision = world.revision + 1n;
    const updated: Scene = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.orderIndex !== undefined ? { orderIndex: patch.orderIndex } : {}),
      ...(patch.sceneTick !== undefined ? { sceneTick: patch.sceneTick !== null ? BigInt(patch.sceneTick) : undefined } : {}),
      ...(patch.povCharacterId !== undefined ? { povCharacterId: patch.povCharacterId ?? undefined } : {}),
      ...(patch.locationEntityId !== undefined ? { locationEntityId: patch.locationEntityId ?? undefined } : {}),
      ...(patch.participantEntityIds !== undefined ? { participantEntityIds: [...patch.participantEntityIds] } : {}),
      ...(patch.plotlineIds !== undefined ? { plotlineIds: [...patch.plotlineIds] } : {}),
      ...(patch.proseText !== undefined ? { proseText: patch.proseText } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.canonRevision !== undefined ? { canonRevision: patch.canonRevision !== null ? BigInt(patch.canonRevision) : undefined } : {}),
      updatedAt: now,
    };
    this.scenes.set(sceneId, updated);
    this.bumpWorld(world, revision, { objectType: 'scene', objectId: sceneId, operation: 'update', patch: patch as Record<string, unknown> });
    return structuredClone(updated);
  }

  async deleteScene(worldId: string, sceneId: string, expectedWorldRevision: bigint): Promise<void> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.scenes.get(sceneId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId });
    const revision = world.revision + 1n;
    this.scenes.delete(sceneId);
    // cascade on foreshadowings
    for (const [fId, f] of this.foreshadowings.entries()) {
      if (f.setupSceneId === sceneId) {
        this.foreshadowings.delete(fId);
      } else if (f.payoffSceneId === sceneId) {
        delete f.payoffSceneId;
        delete f.payoffTick;
      }
    }
    this.bumpWorld(world, revision, { objectType: 'scene', objectId: sceneId, operation: 'delete' });
  }

  // --- Narrative Plotlines ---
  async createPlotline(input: CreatePlotlineInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Plotline> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.plotlines.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Plotline ID already exists', { plotlineId: input.id });
    const revision = world.revision + 1n;
    const plotline: Plotline = {
      id: input.id,
      worldId: input.worldId,
      title: input.title,
      summary: input.summary ?? '',
      status: input.status ?? 'active',
      currentStage: input.currentStage ?? 'setup',
      characterEntityIds: input.characterEntityIds ? [...input.characterEntityIds] : [],
      eventIds: input.eventIds ? [...input.eventIds] : [],
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.plotlines.set(plotline.id, plotline);
    this.bumpWorld(world, revision, { objectType: 'plotline', objectId: plotline.id, operation: 'create' });
    return structuredClone(plotline);
  }

  async getPlotline(worldId: string, plotlineId: string): Promise<Plotline | null> {
    const plotline = this.plotlines.get(plotlineId);
    return plotline && plotline.worldId === worldId ? structuredClone(plotline) : null;
  }

  async listPlotlines(worldId: string): Promise<Plotline[]> {
    return [...this.plotlines.values()].filter((p) => p.worldId === worldId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((p) => structuredClone(p));
  }

  async updatePlotline(worldId: string, plotlineId: string, patch: UpdatePlotlineInput, expectedWorldRevision: bigint, now: Date): Promise<Plotline> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.plotlines.get(plotlineId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId });
    const revision = world.revision + 1n;
    const updated: Plotline = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.currentStage !== undefined ? { currentStage: patch.currentStage } : {}),
      ...(patch.characterEntityIds !== undefined ? { characterEntityIds: [...patch.characterEntityIds] } : {}),
      ...(patch.eventIds !== undefined ? { eventIds: [...patch.eventIds] } : {}),
      updatedAt: now,
    };
    this.plotlines.set(plotlineId, updated);
    this.bumpWorld(world, revision, { objectType: 'plotline', objectId: plotlineId, operation: 'update', patch: patch as Record<string, unknown> });
    return structuredClone(updated);
  }

  async deletePlotline(worldId: string, plotlineId: string, expectedWorldRevision: bigint): Promise<void> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.plotlines.get(plotlineId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId });
    const revision = world.revision + 1n;
    this.plotlines.delete(plotlineId);
    for (const foreshadowing of this.foreshadowings.values()) {
      if (foreshadowing.plotlineId === plotlineId) {
        delete foreshadowing.plotlineId;
      }
    }
    for (const scene of this.scenes.values()) {
      if (scene.plotlineIds?.includes(plotlineId)) {
        scene.plotlineIds = scene.plotlineIds.filter((id) => id !== plotlineId);
      }
    }
    this.bumpWorld(world, revision, { objectType: 'plotline', objectId: plotlineId, operation: 'delete' });
  }

  // --- Narrative Foreshadowings ---
  async createForeshadowing(input: CreateForeshadowingInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Foreshadowing> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.foreshadowings.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Foreshadowing ID already exists', { foreshadowingId: input.id });
    const setupScene = this.scenes.get(input.setupSceneId);
    if (!setupScene || setupScene.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Setup scene not found', { sceneId: input.setupSceneId });
    let payoffScene: Scene | undefined;
    if (input.payoffSceneId) {
      payoffScene = this.scenes.get(input.payoffSceneId);
      if (!payoffScene || payoffScene.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Payoff scene not found', { sceneId: input.payoffSceneId });
    }
    if (input.plotlineId) {
      const plotline = this.plotlines.get(input.plotlineId);
      if (!plotline || plotline.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId: input.plotlineId });
    }
    const revision = world.revision + 1n;
    const foreshadowing: Foreshadowing = {
      id: input.id,
      worldId: input.worldId,
      title: input.title,
      description: input.description ?? '',
      setupSceneId: input.setupSceneId,
      ...(input.setupTick !== undefined ? { setupTick: BigInt(input.setupTick) } : (setupScene.sceneTick !== undefined ? { setupTick: setupScene.sceneTick } : {})),
      ...(input.payoffSceneId !== undefined ? { payoffSceneId: input.payoffSceneId } : {}),
      ...(input.payoffTick !== undefined ? { payoffTick: BigInt(input.payoffTick) } : (payoffScene?.sceneTick !== undefined ? { payoffTick: payoffScene.sceneTick } : {})),
      relatedEntityIds: input.relatedEntityIds ? [...input.relatedEntityIds] : [],
      ...(input.plotlineId !== undefined ? { plotlineId: input.plotlineId } : {}),
      status: input.status ?? 'open',
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.foreshadowings.set(foreshadowing.id, foreshadowing);
    this.bumpWorld(world, revision, { objectType: 'foreshadowing', objectId: foreshadowing.id, operation: 'create' });
    return structuredClone(foreshadowing);
  }

  async getForeshadowing(worldId: string, foreshadowingId: string): Promise<Foreshadowing | null> {
    const foreshadowing = this.foreshadowings.get(foreshadowingId);
    return foreshadowing && foreshadowing.worldId === worldId ? structuredClone(foreshadowing) : null;
  }

  async listForeshadowings(worldId: string, plotlineId?: string): Promise<Foreshadowing[]> {
    return [...this.foreshadowings.values()].filter((f) => f.worldId === worldId && (!plotlineId || f.plotlineId === plotlineId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((f) => structuredClone(f));
  }

  async updateForeshadowing(worldId: string, foreshadowingId: string, patch: UpdateForeshadowingInput, expectedWorldRevision: bigint, now: Date): Promise<Foreshadowing> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.foreshadowings.get(foreshadowingId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Foreshadowing not found', { foreshadowingId });
    let patchSetupScene: Scene | undefined;
    if (patch.setupSceneId !== undefined) {
      patchSetupScene = this.scenes.get(patch.setupSceneId);
      if (!patchSetupScene || patchSetupScene.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Setup scene not found', { sceneId: patch.setupSceneId });
    }
    let patchPayoffScene: Scene | undefined;
    if (patch.payoffSceneId !== undefined && patch.payoffSceneId !== null) {
      patchPayoffScene = this.scenes.get(patch.payoffSceneId);
      if (!patchPayoffScene || patchPayoffScene.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Payoff scene not found', { sceneId: patch.payoffSceneId });
    }
    if (patch.plotlineId !== undefined && patch.plotlineId !== null) {
      const plotline = this.plotlines.get(patch.plotlineId);
      if (!plotline || plotline.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId: patch.plotlineId });
    }
    const revision = world.revision + 1n;
    const resolvedPayoffTick = patch.payoffTick !== undefined
      ? (patch.payoffTick !== null ? { payoffTick: BigInt(patch.payoffTick) } : {})
      : (patchPayoffScene?.sceneTick !== undefined ? { payoffTick: patchPayoffScene.sceneTick } : (current.payoffTick !== undefined ? { payoffTick: current.payoffTick } : {}));
    const updated: Foreshadowing = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.setupSceneId !== undefined ? { setupSceneId: patch.setupSceneId } : {}),
      ...(patch.setupTick !== undefined ? (patch.setupTick !== null ? { setupTick: BigInt(patch.setupTick) } : {}) : (patchSetupScene?.sceneTick !== undefined ? { setupTick: patchSetupScene.sceneTick } : (current.setupTick !== undefined ? { setupTick: current.setupTick } : {}))),
      ...(patch.payoffSceneId !== undefined ? (patch.payoffSceneId !== null ? { payoffSceneId: patch.payoffSceneId } : {}) : (current.payoffSceneId !== undefined ? { payoffSceneId: current.payoffSceneId } : {})),
      ...resolvedPayoffTick,
      ...(patch.relatedEntityIds !== undefined ? { relatedEntityIds: [...patch.relatedEntityIds] } : {}),
      ...(patch.plotlineId !== undefined ? (patch.plotlineId !== null ? { plotlineId: patch.plotlineId } : {}) : (current.plotlineId !== undefined ? { plotlineId: current.plotlineId } : {})),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: now,
    };
    if (patch.payoffSceneId === null) {
      delete (updated as Partial<Foreshadowing>).payoffSceneId;
    }
    if (patch.payoffTick === null) {
      delete (updated as Partial<Foreshadowing>).payoffTick;
    }
    if (patch.setupTick === null) {
      delete (updated as Partial<Foreshadowing>).setupTick;
    }
    if (patch.plotlineId === null) {
      delete (updated as Partial<Foreshadowing>).plotlineId;
    }
    this.foreshadowings.set(foreshadowingId, updated);
    this.bumpWorld(world, revision, { objectType: 'foreshadowing', objectId: foreshadowingId, operation: 'update', patch: patch as Record<string, unknown> });
    return structuredClone(updated);
  }

  async deleteForeshadowing(worldId: string, foreshadowingId: string, expectedWorldRevision: bigint): Promise<void> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.foreshadowings.get(foreshadowingId);
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Foreshadowing not found', { foreshadowingId });
    const revision = world.revision + 1n;
    this.foreshadowings.delete(foreshadowingId);
    this.bumpWorld(world, revision, { objectType: 'foreshadowing', objectId: foreshadowingId, operation: 'delete' });
  }


  async createCalendar(input: { id: string; versionId: string; worldId: string; name: string; definition: CalendarDefinition; now: Date }, expectedWorldRevision: bigint): Promise<{ calendar: CalendarRecord; version: CalendarVersionRecord }> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const calendar: CalendarRecord = { id: input.id, worldId: input.worldId, name: input.name, currentVersion: 1, createdAt: input.now, updatedAt: input.now };
    const version: CalendarVersionRecord = { id: input.versionId, worldId: input.worldId, calendarId: input.id, version: 1, definition: structuredClone(input.definition), createdRevision: world.revision + 1n, createdAt: input.now };
    this.calendars.set(calendar.id, calendar); this.calendarVersions.set(version.id, version);
    const revision = world.revision + 1n;
    this.worlds.set(world.id, { ...world, defaultCalendarVersionId: world.defaultCalendarVersionId ?? version.id, revision, updatedAt: input.now });
    this.recordRevision(world.id, revision, 'Create calendar');
    return { calendar, version };
  }
  async listCalendars(worldId: string): Promise<CalendarRecord[]> { return [...this.calendars.values()].filter((calendar) => calendar.worldId === worldId).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); }
  async listCalendarVersions(worldId: string, calendarId: string): Promise<CalendarVersionRecord[]> { return [...this.calendarVersions.values()].filter((version) => version.worldId === worldId && version.calendarId === calendarId).sort((a, b) => a.version - b.version); }
  async getCalendarVersion(worldId: string, versionId: string): Promise<CalendarVersionRecord | null> { const version = this.calendarVersions.get(versionId); return version?.worldId === worldId ? structuredClone(version) : null; }
  async createCalendarVersion(input: { id: string; worldId: string; calendarId: string; definition: CalendarDefinition; now: Date }, expectedWorldRevision: bigint): Promise<CalendarVersionRecord> {
    const world = this.worlds.get(input.worldId); const calendar = this.calendars.get(input.calendarId);
    if (!world || !calendar || calendar.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Calendar not found', { calendarId: input.calendarId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const version: CalendarVersionRecord = { id: input.id, worldId: input.worldId, calendarId: input.calendarId, version: calendar.currentVersion + 1, definition: structuredClone(input.definition), createdRevision: world.revision + 1n, createdAt: input.now };
    this.calendarVersions.set(version.id, version); this.calendars.set(calendar.id, { ...calendar, currentVersion: version.version, updatedAt: input.now });
    this.bumpWorld(world, world.revision + 1n);
    return structuredClone(version);
  }
  async setDefaultCalendarVersion(worldId: string, versionId: string, expectedWorldRevision: bigint): Promise<World> {
    const world = this.worlds.get(worldId);
    const version = this.calendarVersions.get(versionId);
    if (!world || !version || version.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Calendar version not found', { versionId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const updated: World = { ...world, defaultCalendarVersionId: versionId, revision: world.revision + 1n, updatedAt: new Date() };
    this.worlds.set(worldId, updated); this.recordRevision(worldId, updated.revision, 'Set default calendar version');
    return updated;
  }
  async listRevisions(worldId: string, limit: number): Promise<RevisionRecord[]> { return (this.revisions.get(worldId) ?? []).slice(-Math.max(1, Math.min(limit, 100))).reverse(); }
  async listRevisionChanges(worldId: string, sequence: bigint): Promise<ChangeRecord[]> { return (this.changes.get(worldId) ?? []).filter((change) => change.sequence === sequence).map((change) => structuredClone(change)); }
  async getWorld(id: string): Promise<World | null> { return this.worlds.get(id) ?? null; }

  async updateWorld(id: string, expectedRevision: bigint, patch: Partial<Pick<World, 'name' | 'description' | 'genre' | 'canonStrategy'>>): Promise<World> {
    const world = this.worlds.get(id);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: id });
    if (world.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const updated: World = { ...world, ...patch, revision: world.revision + 1n, updatedAt: new Date() };
    this.worlds.set(id, updated);
    this.recordRevision(id, updated.revision, 'Update world');
    return updated;
  }

  async updateWorldTime(id: string, expectedRevision: bigint, tick: bigint): Promise<World> {
    const world = this.worlds.get(id); if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: id });
    if (world.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const updated = { ...world, currentTick: tick, revision: world.revision + 1n, updatedAt: new Date() }; this.worlds.set(id, updated); this.recordRevision(id, updated.revision, 'Update world time cursor'); return updated;
  }

  async createEntity(input: CreateEntityInput, expectedWorldRevision: bigint): Promise<Entity> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const type = this.entityTypes.get(input.typeId);
    if (!type || type.worldId !== input.worldId) throw new DomainError('VALIDATION_ERROR', 'Entity type not found in world', { typeId: input.typeId });
    if (this.entities.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Entity ID already exists', { entityId: input.id });
    const createdRevision = world.revision + 1n;
    const entity: Entity = { id: input.id, worldId: input.worldId, typeId: input.typeId, ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }), name: input.name, subtitle: input.subtitle, parentEntityId: input.parentEntityId, document: input.document, documentText: input.documentText, tags: input.tags, canonStatus: 'draft', revision: 1n, createdRevision, sourceKind: 'manual', createdAt: input.now, updatedAt: input.now };
    this.entities.set(entity.id, entity);
    if (input.snapshotBase !== false) this.appendSnapshotBaseVersion(entity, createdRevision);
    this.worlds.set(world.id, { ...world, revision: world.revision + 1n, updatedAt: input.now });
    this.recordRevision(input.worldId, world.revision + 1n, 'Create entity');
    return entity;
  }

  async getEntity(worldId: string, entityId: string): Promise<Entity | null> { const entity = this.entities.get(entityId); return entity?.worldId === worldId ? entity : null; }

  async updateEntity(worldId: string, entityId: string, expectedWorldRevision: bigint, patch: Partial<Pick<Entity, 'name' | 'subtitle' | 'parentEntityId' | 'document' | 'documentText' | 'tags'>>, now: Date): Promise<Entity> {
    const world = this.worlds.get(worldId); if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const current = this.entities.get(entityId); if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Entity not found', { entityId });
    const revision = world.revision + 1n;
    const { sourceRefId: _sourceRefId, ...withoutEventProvenance } = current;
    const updated: Entity = { ...withoutEventProvenance, ...patch, revision: current.revision + 1n, updatedAt: now, sourceKind: 'manual' };
    this.entities.set(entityId, updated);
    if (this.snapshotBaseEntities.has(entityId)) this.appendSnapshotBaseVersion(updated, revision);
    this.worlds.set(worldId, { ...world, revision, updatedAt: now }); this.recordRevision(worldId, revision, 'Update entity'); return updated;
  }

  async listEntities(worldId: string): Promise<Entity[]> { return [...this.entities.values()].filter((entity) => entity.worldId === worldId); }
  async listSnapshotBaseEntities(worldId: string, asOfRevision?: bigint): Promise<Entity[]> {
    const result: Entity[] = [];
    for (const [id, current] of this.snapshotBaseEntities) {
      if (current.worldId !== worldId) continue;
      const versions = this.snapshotBaseEntityHistory.get(id);
      if (!versions?.length) { result.push(structuredClone(current)); continue; }
      const version = asOfRevision === undefined
        ? versions.find((candidate) => candidate.to === null) ?? versions.at(-1)
        : [...versions].reverse().find((candidate) => candidate.from <= asOfRevision && (candidate.to === null || candidate.to > asOfRevision));
      if (version) result.push(structuredClone(version.entity));
    }
    return result;
  }

  private appendSnapshotBaseVersion(entity: Entity, from: bigint): void {
    const versions = this.snapshotBaseEntityHistory.get(entity.id) ?? [];
    const open = versions.find((candidate) => candidate.to === null);
    if (open) open.to = from;
    versions.push({ from, to: null, entity: structuredClone(entity) });
    this.snapshotBaseEntityHistory.set(entity.id, versions);
    this.snapshotBaseEntities.set(entity.id, structuredClone(entity));
  }

  async createEntityType(input: CreateEntityTypeInput, expectedWorldRevision: bigint): Promise<EntityType> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if ([...this.entityTypes.values()].some((type) => type.worldId === input.worldId && type.typeKey === input.typeKey)) throw new DomainError('VALIDATION_ERROR', 'Entity type key already exists', { typeKey: input.typeKey });
    const now = input.now;
    const type: EntityType = { id: input.id, worldId: input.worldId, typeKey: input.typeKey, label: input.label, schemaVersion: 1, schema: input.schema, createdAt: now, updatedAt: now };
    this.entityTypes.set(type.id, type);
    const version: EntityTypeVersion = { id: randomUUID(), worldId: input.worldId, entityTypeId: type.id, schemaVersion: 1, schema: structuredClone(input.schema), createdRevision: world.revision + 1n, createdAt: now };
    this.entityTypeVersions.set(version.id, version);
    this.worlds.set(world.id, { ...world, revision: world.revision + 1n, updatedAt: now });
    this.recordRevision(input.worldId, world.revision + 1n, 'Create entity type');
    return type;
  }

  async listEntityTypes(worldId: string): Promise<EntityType[]> { return [...this.entityTypes.values()].filter((type) => type.worldId === worldId); }

  async createEntityTypeVersion(worldId: string, entityTypeId: string, schema: Record<string, unknown>, expectedWorldRevision: bigint, now: Date): Promise<EntityTypeVersion> {
    const world = this.worlds.get(worldId);
    const type = this.entityTypes.get(entityTypeId);
    if (!world || !type || type.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Entity type not found', { entityTypeId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const revision = world.revision + 1n;
    const next: EntityTypeVersion = { id: randomUUID(), worldId, entityTypeId, schemaVersion: type.schemaVersion + 1, schema: structuredClone(schema), createdRevision: revision, createdAt: now };
    this.entityTypeVersions.set(next.id, next);
    this.entityTypes.set(entityTypeId, { ...type, schemaVersion: next.schemaVersion, schema: structuredClone(schema), updatedAt: now });
    this.bumpWorld(world, revision);
    return structuredClone(next);
  }

  async listEntityTypeVersions(worldId: string, entityTypeId: string): Promise<EntityTypeVersion[]> {
    return [...this.entityTypeVersions.values()].filter((version) => version.worldId === worldId && version.entityTypeId === entityTypeId).sort((a, b) => a.schemaVersion - b.schemaVersion);
  }

  async search(worldId: string, query: string, limit: number): Promise<SearchResult[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const result: SearchResult[] = [];
    for (const entity of await this.listEntities(worldId)) if (`${entity.name} ${entity.subtitle} ${entity.documentText} ${entity.tags.join(' ')}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'entity', id: entity.id, title: entity.name, snippet: entity.documentText.slice(0, 240) });
    for (const fact of await this.listFacts(worldId)) if (`${fact.predicateKey} ${String(fact.value ?? '')}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'fact', id: fact.id, title: fact.predicateKey, snippet: String(fact.value ?? '') });
    for (const relation of await this.listRelations(worldId)) if (relation.description.toLocaleLowerCase().includes(needle)) result.push({ kind: 'relation', id: relation.id, title: relation.relationTypeId, snippet: relation.description });
    for (const event of await this.listEvents(worldId)) if (`${event.name} ${event.description}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'event', id: event.id, title: event.name, snippet: event.description.slice(0, 240) });
    for (const claim of await this.listClaims(worldId)) if (`${claim.predicateKey} ${String(claim.value ?? '')}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'claim', id: claim.id, title: claim.predicateKey, snippet: String(claim.value ?? '') });
    for (const rule of await this.listValidationRules(worldId)) if (`${rule.name} ${rule.description ?? ''}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'rule', id: rule.id, title: rule.name, snippet: (rule.description ?? '').slice(0, 240) });
    for (const work of await this.listWorks(worldId)) if (`${work.title} ${work.description ?? ''}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'work', id: work.id, title: work.title, snippet: (work.description ?? '').slice(0, 240) });
    for (const scene of await this.listScenes(worldId)) if (`${scene.title ?? ''} ${scene.proseText}`.toLocaleLowerCase().includes(needle)) result.push({ kind: 'scene', id: scene.id, title: scene.title ?? 'Untitled Scene', snippet: scene.proseText.slice(0, 240) });
    return result.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async createFact(input: CreateFactInput, expectedWorldRevision: bigint): Promise<Fact> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (input.objectKind === 'entity' && !input.objectEntityId) throw new DomainError('VALIDATION_ERROR', 'Entity facts require objectEntityId');
    if (input.objectKind !== 'entity' && input.objectEntityId !== undefined) throw new DomainError('VALIDATION_ERROR', 'Only entity facts may set objectEntityId');
    if (input.validFromTick !== undefined && input.validToTick !== undefined && input.validFromTick >= input.validToTick) throw new DomainError('VALIDATION_ERROR', 'Fact valid range must be non-empty');
    if (!(await this.getEntity(input.worldId, input.subjectEntityId))) throw new DomainError('NOT_FOUND', 'Fact subject not found', { entityId: input.subjectEntityId });
    if (input.objectKind === 'entity' && (!input.objectEntityId || !(await this.getEntity(input.worldId, input.objectEntityId)))) throw new DomainError('NOT_FOUND', 'Fact target not found', { entityId: input.objectEntityId });
    const revision = world.revision + 1n;
    const fact: Fact = { id: input.id, worldId: input.worldId, branchId: input.branchId ?? DEFAULT_BRANCH_ID, subjectEntityId: input.subjectEntityId, predicateKey: input.predicateKey, objectKind: input.objectKind, value: input.value, ...(input.objectEntityId ? { objectEntityId: input.objectEntityId } : {}), ...(input.validFromTick === undefined ? {} : { validFromTick: input.validFromTick }), ...(input.validToTick === undefined ? {} : { validToTick: input.validToTick }), canonStatus: 'draft', sourceKind: input.sourceKind, createdRevision: revision, revisionFrom: revision, revisionTo: null };
    this.facts.set(fact.id, fact);
    this.bumpWorld(world, revision);
    return fact;
  }

  async listFacts(worldId: string): Promise<Fact[]> { return [...this.facts.values()].filter((fact) => fact.worldId === worldId); }

  async createRelationType(input: CreateEntityTypeInput & { forwardLabel: string; inverseLabel: string; symmetric: boolean; sourceTypeIds: string[]; targetTypeIds: string[] }, expectedWorldRevision: bigint): Promise<RelationType> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (this.relationTypes.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Relation type ID already exists', { relationTypeId: input.id });
    const type: RelationType = { id: input.id, worldId: input.worldId, forwardLabel: input.forwardLabel, inverseLabel: input.inverseLabel, symmetric: input.symmetric, sourceTypeIds: input.sourceTypeIds, targetTypeIds: input.targetTypeIds };
    this.relationTypes.set(type.id, type);
    this.bumpWorld(world, world.revision + 1n);
    return type;
  }

  async listRelationTypes(worldId: string): Promise<RelationType[]> { return [...this.relationTypes.values()].filter((type) => type.worldId === worldId); }

  async createRelation(input: CreateRelationInput, expectedWorldRevision: bigint): Promise<Relation> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (!(await this.getEntity(input.worldId, input.sourceEntityId)) || !(await this.getEntity(input.worldId, input.targetEntityId))) throw new DomainError('NOT_FOUND', 'Relation endpoint not found');
    const relationType = this.relationTypes.get(input.relationTypeId);
    if (!relationType || relationType.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Relation type not found', { relationTypeId: input.relationTypeId });
    const revision = world.revision + 1n;
    const relation: Relation = { ...input, branchId: input.branchId ?? DEFAULT_BRANCH_ID, canonStatus: 'draft', sourceKind: 'manual', createdRevision: revision, revisionFrom: revision, revisionTo: null };
    this.relations.set(relation.id, relation);
    this.bumpWorld(world, revision);
    return relation;
  }

  async listRelations(worldId: string): Promise<Relation[]> { return [...this.relations.values()].filter((relation) => relation.worldId === worldId); }

  async createEvent(input: CreateEventInput, expectedWorldRevision: bigint): Promise<WorldEvent> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    for (const entityId of [...(input.participantRoles ?? input.participantIds.map((entityId) => ({ entityId, role: 'participant' }))).map((participant) => participant.entityId), ...input.locationEntityIds]) if (!(await this.getEntity(input.worldId, entityId))) throw new DomainError('NOT_FOUND', 'Event entity reference not found', { entityId });
    const events = await this.listEvents(input.worldId);
    const eventIds = new Set(events.map((event) => event.id));
    const causalTargetIds = (input.causalLinks ?? []).map((link) => link.targetEventId);
    for (const linkedId of [...input.causeEventIds, ...input.resultEventIds, ...causalTargetIds]) if (linkedId === input.id || !eventIds.has(linkedId)) throw new DomainError('NOT_FOUND', 'Linked event not found', { eventId: linkedId });
    if (new Set(input.effects.map((effect) => effect.sequence)).size !== input.effects.length) throw new DomainError('VALIDATION_ERROR', 'Event effect sequence must be unique');
    const revision = world.revision + 1n;
    const event: WorldEvent = {
      ...input,
      branchId: input.branchId ?? DEFAULT_BRANCH_ID,
      ...(input.causalLinks !== undefined ? { causalLinks: input.causalLinks } : {}),
      ...(input.temporalExpression !== undefined ? { temporalExpression: input.temporalExpression } : {}),
      canonStatus: 'draft',
      createdRevision: revision,
    };
    this.events.set(event.id, event);
    this.bumpWorld(world, revision);
    return event;
  }

  async listEvents(worldId: string): Promise<WorldEvent[]> { return [...this.events.values()].filter((event) => event.worldId === worldId); }

  async createClaim(input: CreateClaimInput, expectedWorldRevision: bigint): Promise<Claim> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const revision = world.revision + 1n;
    const claim: Claim = {
      id: input.id,
      worldId: input.worldId,
      branchId: input.branchId ?? DEFAULT_BRANCH_ID,
      ...(input.subjectEntityId ? { subjectEntityId: input.subjectEntityId } : {}),
      predicateKey: input.predicateKey,
      objectKind: input.objectKind,
      value: input.value,
      ...(input.objectEntityId ? { objectEntityId: input.objectEntityId } : {}),
      ...(input.assertedByEntityId ? { assertedByEntityId: input.assertedByEntityId } : {}),
      knownByEntityIds: [...input.knownByEntityIds],
      ...(input.validFromTick !== undefined ? { validFromTick: input.validFromTick } : {}),
      ...(input.validToTick !== undefined ? { validToTick: input.validToTick } : {}),
      truthStatus: input.truthStatus,
      claimKind: input.claimKind,
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      sourceRefs: [...input.sourceRefs],
      canonStatus: 'draft',
      createdRevision: revision,
      revisionFrom: revision,
      revisionTo: null,
      createdAt: world.updatedAt,
      updatedAt: world.updatedAt,
    };
    this.claims.set(claim.id, claim);
    this.bumpWorld(world, revision);
    return claim;
  }

  async getClaim(worldId: string, claimId: string): Promise<Claim | null> {
    const claim = this.claims.get(claimId);
    return claim?.worldId === worldId ? claim : null;
  }

  async listClaims(worldId: string): Promise<Claim[]> {
    return [...this.claims.values()].filter((c) => c.worldId === worldId);
  }

  async createMap(input: { id: string; worldId: string; name: string; crs: string; width: number; height: number; assetId?: string; now: Date }, expectedWorldRevision: bigint): Promise<WorldMap> {
    const world = this.worlds.get(input.worldId); if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const map: WorldMap = { ...input, ...(input.assetId === undefined ? {} : { assetId: input.assetId }), createdAt: input.now, updatedAt: input.now }; this.maps.set(map.id, map);
    const defaultLayer: MapLayer = { id: randomUUID(), worldId: input.worldId, mapId: map.id, name: 'Default', kind: 'base', sortOrder: 0, visible: true, opacity: 1, style: {}, createdAt: input.now, updatedAt: input.now };
    this.mapLayers.set(defaultLayer.id, defaultLayer);
    this.bumpWorld(world, world.revision + 1n, { objectType: 'map', objectId: map.id, operation: 'create' }); return map;
  }

  async listMaps(worldId: string): Promise<WorldMap[]> { return [...this.maps.values()].filter((map) => map.worldId === worldId); }

  async createMapLayer(input: { id: string; worldId: string; mapId: string; name: string; kind: MapLayer['kind']; sortOrder: number; visible: boolean; opacity: number; style: Record<string, unknown>; now: Date }, expectedWorldRevision: bigint): Promise<MapLayer> {
    const world = this.worlds.get(input.worldId); if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (!this.maps.get(input.mapId) || this.maps.get(input.mapId)?.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Map not found', { mapId: input.mapId });
    if ([...this.mapLayers.values()].some((layer) => layer.worldId === input.worldId && layer.mapId === input.mapId && layer.name === input.name)) throw new DomainError('VALIDATION_ERROR', 'Map layer name already exists');
    const layer: MapLayer = { ...input, style: structuredClone(input.style), createdAt: input.now, updatedAt: input.now };
    this.mapLayers.set(layer.id, layer); this.bumpWorld(world, world.revision + 1n, { objectType: 'map_layer', objectId: layer.id, operation: 'create' }); return layer;
  }

  async listMapLayers(worldId: string, mapId: string): Promise<MapLayer[]> { return [...this.mapLayers.values()].filter((layer) => layer.worldId === worldId && layer.mapId === mapId).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)); }

  async updateMapLayer(worldId: string, mapId: string, layerId: string, patch: Partial<Pick<MapLayer, 'name' | 'kind' | 'sortOrder' | 'visible' | 'opacity' | 'style'>>, expectedWorldRevision: bigint, now: Date): Promise<MapLayer> {
    const world = this.worlds.get(worldId); const current = this.mapLayers.get(layerId);
    if (!world || !current || current.worldId !== worldId || current.mapId !== mapId) throw new DomainError('NOT_FOUND', 'Map layer not found', { layerId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const nextName = patch.name?.trim() ?? current.name;
    if (!nextName || nextName.length > 200) throw new DomainError('VALIDATION_ERROR', 'Map layer name must be between 1 and 200 characters');
    if (patch.sortOrder !== undefined && (!Number.isInteger(patch.sortOrder) || patch.sortOrder < 0)) throw new DomainError('VALIDATION_ERROR', 'Map layer sortOrder must be a non-negative integer');
    if (patch.opacity !== undefined && (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)) throw new DomainError('VALIDATION_ERROR', 'Map layer opacity must be between 0 and 1');
    if ([...this.mapLayers.values()].some((layer) => layer.id !== layerId && layer.worldId === worldId && layer.mapId === mapId && layer.name === nextName)) throw new DomainError('VALIDATION_ERROR', 'Map layer name already exists');
    const updated: MapLayer = { ...current, ...patch, name: nextName, style: patch.style === undefined ? current.style : structuredClone(patch.style), updatedAt: now };
    this.mapLayers.set(layerId, updated); this.bumpWorld(world, world.revision + 1n, { objectType: 'map_layer', objectId: layerId, operation: 'update', patch: patch as Record<string, unknown> }); return updated;
  }

  async createMapFeature(input: { id: string; worldId: string; mapId: string; layerId?: string; entityId?: string; kind: MapFeature['kind']; geometry: Record<string, unknown>; properties: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint; now: Date }, expectedWorldRevision: bigint): Promise<MapFeature> {
    const world = this.worlds.get(input.worldId); if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    if (!this.maps.get(input.mapId) || this.maps.get(input.mapId)?.worldId !== input.worldId) throw new DomainError('NOT_FOUND', 'Map not found', { mapId: input.mapId });
    if (input.layerId && (!this.mapLayers.get(input.layerId) || this.mapLayers.get(input.layerId)?.worldId !== input.worldId || this.mapLayers.get(input.layerId)?.mapId !== input.mapId)) throw new DomainError('NOT_FOUND', 'Map layer not found', { layerId: input.layerId });
    if (input.entityId && (!(await this.getEntity(input.worldId, input.entityId)))) throw new DomainError('NOT_FOUND', 'Map entity not found', { entityId: input.entityId });
    if (input.validFromTick !== undefined && input.validToTick !== undefined && input.validFromTick >= input.validToTick) throw new DomainError('VALIDATION_ERROR', 'Map feature range must be non-empty');
    const revision = world.revision + 1n;
    const feature: MapFeature = { ...input, branchId: DEFAULT_BRANCH_ID, revisionFrom: revision, revisionTo: null, ...(input.entityId === undefined ? {} : { entityId: input.entityId }), ...(input.validFromTick === undefined ? {} : { validFromTick: input.validFromTick }), ...(input.validToTick === undefined ? {} : { validToTick: input.validToTick }), sourceKind: 'manual', createdRevision: revision, createdAt: input.now, updatedAt: input.now }; this.mapFeatures.set(feature.id, feature); this.bumpWorld(world, revision, { objectType: 'map_feature', objectId: feature.id, operation: 'create' }); return feature;
  }

  async createMapFeatures(inputs: Array<{ id: string; worldId: string; mapId: string; layerId?: string; entityId?: string; kind: MapFeature['kind']; geometry: Record<string, unknown>; properties: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint; now: Date }>, expectedWorldRevision: bigint): Promise<MapFeature[]> {
    if (!inputs.length) return [];
    const { worldId, mapId, now } = inputs[0]!;
    if (inputs.some((input) => input.worldId !== worldId || input.mapId !== mapId)) throw new DomainError('VALIDATION_ERROR', 'Batch map features must belong to one map');
    const world = this.worlds.get(worldId);
    if (!world || this.maps.get(mapId)?.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Map not found', { mapId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    for (const input of inputs) {
      if (this.mapFeatures.has(input.id)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Map feature ID already exists', { featureId: input.id });
      if (input.layerId && this.mapLayers.get(input.layerId)?.mapId !== mapId) throw new DomainError('NOT_FOUND', 'Map layer not found', { layerId: input.layerId });
      if (input.entityId && !(await this.getEntity(worldId, input.entityId))) throw new DomainError('NOT_FOUND', 'Map entity not found', { entityId: input.entityId });
      if (input.validFromTick !== undefined && input.validToTick !== undefined && input.validFromTick >= input.validToTick) throw new DomainError('VALIDATION_ERROR', 'Map feature range must be non-empty');
    }
    const revision = world.revision + 1n;
    const created = inputs.map((input): MapFeature => ({ ...input, branchId: DEFAULT_BRANCH_ID, revisionFrom: revision, revisionTo: null, sourceKind: 'import', createdRevision: revision, createdAt: now, updatedAt: now }));
    for (const feature of created) this.mapFeatures.set(feature.id, feature);
    this.bumpWorld(world, revision, { objectType: 'map_feature_batch', objectId: mapId, operation: 'create', patch: { count: created.length } });
    return created;
  }

  async listMapFeatures(worldId: string, mapId: string): Promise<MapFeature[]> { return [...this.mapFeatures.values()].filter((feature) => feature.worldId === worldId && feature.mapId === mapId); }
  async listAllMapFeatures(worldId: string): Promise<MapFeature[]> { return [...this.mapFeatures.values()].filter((feature) => feature.worldId === worldId); }

  async getCanonTarget(worldId: string, kind: CanonTargetKind, id: string): Promise<CanonTarget | null> {
    const collection = kind === 'entity' ? this.entities : kind === 'fact' ? this.facts : kind === 'relation' ? this.relations : kind === 'event' ? this.events : this.claims;
    const target = collection.get(id) as (CanonTarget & { worldId: string }) | undefined;
    return target?.worldId === worldId ? target : null;
  }

  async updateCanonStatus(worldId: string, kind: CanonTargetKind, id: string, status: import('@world-codex/domain').CanonStatus, expectedWorldRevision: bigint, _reason: string, now: Date): Promise<CanonTarget> {
    const world = this.worlds.get(worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const collection = kind === 'entity' ? this.entities : kind === 'fact' ? this.facts : kind === 'relation' ? this.relations : kind === 'event' ? this.events : this.claims;
    const current = collection.get(id) as (CanonTarget & { worldId: string }) | undefined;
    if (!current || current.worldId !== worldId) throw new DomainError('NOT_FOUND', 'Canon target not found', { kind, id });
    let updated: CanonTarget;
    if (kind === 'event' && status === 'canon' && !(current as WorldEvent).effectsApplied) {
      const event = current as WorldEvent;
      const materialized = materializeEventEffects(event, {
        entities: [...this.entities.values()].filter((entity) => entity.worldId === worldId),
        entityTypes: [...this.entityTypes.values()].filter((entityType) => entityType.worldId === worldId),
        facts: [...this.facts.values()].filter((fact) => fact.worldId === worldId),
        relations: [...this.relations.values()].filter((relation) => relation.worldId === worldId),
        relationTypes: [...this.relationTypes.values()].filter((relationType) => relationType.worldId === worldId),
        mapFeatures: [...this.mapFeatures.values()].filter((feature) => feature.worldId === worldId),
      }, world.revision + 1n, now);
      for (const key of [...this.entities.keys()]) if (this.entities.get(key)?.worldId === worldId) this.entities.delete(key);
      for (const item of materialized.entities) this.entities.set(item.id, item);
      for (const key of [...this.facts.keys()]) if (this.facts.get(key)?.worldId === worldId) this.facts.delete(key);
      for (const item of materialized.facts) this.facts.set(item.id, item);
      for (const key of [...this.relations.keys()]) if (this.relations.get(key)?.worldId === worldId) this.relations.delete(key);
      for (const item of materialized.relations) this.relations.set(item.id, item);
      for (const key of [...this.mapFeatures.keys()]) if (this.mapFeatures.get(key)?.worldId === worldId) this.mapFeatures.delete(key);
      for (const item of materialized.mapFeatures ?? []) this.mapFeatures.set(item.id, item);
      this.eventMaterializationUndo.set(id, materialized.undo);
      updated = { ...event, canonStatus: status, effectsApplied: true, canonRevision: world.revision + 1n };
      this.events.set(id, updated as WorldEvent);
    } else if (kind === 'event' && status === 'retconned') {
      const event = current as WorldEvent;
      this.revertMaterializedEvent(event);
      updated = { ...event, canonStatus: status, effectsApplied: false, retconnedRevision: world.revision + 1n };
      this.events.set(id, updated as WorldEvent);
    } else if (kind === 'event' && status === 'canon') {
      updated = { ...current, canonStatus: status, canonRevision: (current as WorldEvent).canonRevision ?? world.revision + 1n } as CanonTarget;
      this.events.set(id, updated as WorldEvent);
    } else {
      const revision = world.revision + 1n;
      updated = {
        ...current,
        canonStatus: status,
        ...(status === 'pending' ? { pendingRevision: revision } : {}),
        ...(status === 'canon' ? { canonRevision: revision } : {}),
        ...(status === 'retconned' ? { retconnedRevision: revision, ...(kind === 'fact' || kind === 'relation' || kind === 'claim' ? { revisionTo: revision } : {}) } : {}),
        ...(kind === 'entity' ? { revision: (current as Entity).revision + 1n, sourceKind: 'manual' as const } : {}),
      } as CanonTarget;
      collection.set(id, updated as never);
      if (kind === 'entity' && this.snapshotBaseEntities.has(id)) this.appendSnapshotBaseVersion(updated as Entity, revision);
    }
    this.worlds.set(worldId, { ...world, revision: world.revision + 1n, updatedAt: now });
    this.recordRevision(worldId, world.revision + 1n, `Canon ${kind}`);
    return updated;
  }

  async updateCanonStatuses(worldId: string, changes: CanonStatusChange[], expectedWorldRevision: bigint, reason: string, now: Date): Promise<CanonTarget[]> {
    const snapshots = {
      worlds: new Map([...this.worlds].map(([key, value]) => [key, structuredClone(value)] as const)),
      entities: new Map([...this.entities].map(([key, value]) => [key, structuredClone(value)] as const)),
      snapshotBaseEntities: new Map([...this.snapshotBaseEntities].map(([key, value]) => [key, structuredClone(value)] as const)),
      snapshotBaseEntityHistory: new Map([...this.snapshotBaseEntityHistory].map(([key, value]) => [key, structuredClone(value)] as const)),
      facts: new Map([...this.facts].map(([key, value]) => [key, structuredClone(value)] as const)),
      relations: new Map([...this.relations].map(([key, value]) => [key, structuredClone(value)] as const)),
      events: new Map([...this.events].map(([key, value]) => [key, structuredClone(value)] as const)),
      claims: new Map([...this.claims].map(([key, value]) => [key, structuredClone(value)] as const)),
      mapFeatures: new Map([...this.mapFeatures].map(([key, value]) => [key, structuredClone(value)] as const)),
      eventMaterializationUndo: new Map([...this.eventMaterializationUndo].map(([key, value]) => [key, structuredClone(value)] as const)),
      revisions: new Map([...this.revisions].map(([key, value]) => [key, structuredClone(value)] as const)),
      changes: new Map([...this.changes].map(([key, value]) => [key, structuredClone(value)] as const)),
    };
    try {
      const initialWorld = this.worlds.get(worldId);
      if (!initialWorld) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
      if (initialWorld.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: initialWorld.revision.toString() });
      this.assertWritable(initialWorld);
      const results: CanonTarget[] = [];
      for (const change of changes) {
        const world = this.worlds.get(worldId);
        if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
        results.push(await this.updateCanonStatus(worldId, change.kind, change.id, change.status, world.revision, reason, now));
      }
      return results;
    } catch (error) {
      this.restoreMap(this.worlds, snapshots.worlds); this.restoreMap(this.entities, snapshots.entities); this.restoreMap(this.snapshotBaseEntities, snapshots.snapshotBaseEntities); this.restoreMap(this.snapshotBaseEntityHistory, snapshots.snapshotBaseEntityHistory); this.restoreMap(this.facts, snapshots.facts); this.restoreMap(this.relations, snapshots.relations); this.restoreMap(this.events, snapshots.events); this.restoreMap(this.claims, snapshots.claims); this.restoreMap(this.mapFeatures, snapshots.mapFeatures); this.restoreMap(this.eventMaterializationUndo, snapshots.eventMaterializationUndo); this.restoreMap(this.revisions, snapshots.revisions); this.restoreMap(this.changes, snapshots.changes);
      throw error;
    }
  }

  private restoreMap<T>(target: Map<string, T>, snapshot: Map<string, T>): void {
    target.clear();
    for (const [key, value] of snapshot) target.set(key, structuredClone(value));
  }

  private revertMaterializedEvent(event: WorldEvent): void {
    const undo = this.eventMaterializationUndo.get(event.id);
    if (!undo) throw new DomainError('VALIDATION_ERROR', 'Cannot retcon an event whose materialization backup is missing', { eventId: event.id });
    for (const [id, entity] of this.entities) if (entity.sourceRefId === event.id) this.entities.delete(id);
    for (const [id, fact] of this.facts) if (fact.sourceRefId === event.id) this.facts.delete(id);
    for (const [id, relation] of this.relations) if (relation.sourceRefId === event.id) this.relations.delete(id);
    for (const [id, feature] of this.mapFeatures) if (feature.sourceRefId === event.id) this.mapFeatures.delete(id);
    for (const entity of undo.entities) this.entities.set(entity.id, structuredClone(entity));
    for (const fact of undo.facts) this.facts.set(fact.id, structuredClone(fact));
    for (const relation of undo.relations) this.relations.set(relation.id, structuredClone(relation));
    for (const feature of undo.mapFeatures) this.mapFeatures.set(feature.id, structuredClone(feature));
    this.eventMaterializationUndo.delete(event.id);
  }

  private bumpWorld(world: World, revision: bigint, change: Partial<Pick<ChangeRecord, 'objectType' | 'objectId' | 'operation' | 'patch'>> = {}): void { this.worlds.set(world.id, { ...world, revision, updatedAt: new Date() }); this.recordRevision(world.id, revision, 'State change', change); }

  private assertWritable(world: World): void {
    if (world.archivedAt) throw new DomainError('VALIDATION_ERROR', 'Archived worlds are read-only', { worldId: world.id });
  }

  private recordRevision(worldId: string, sequence: bigint, reason: string, change: Partial<Pick<ChangeRecord, 'objectType' | 'objectId' | 'operation' | 'patch'>> = {}): void {
    const revisionId = randomUUID();
    const record: RevisionRecord = { id: revisionId, worldId, sequence, actorType: 'system', sourceKind: 'api', reason, changeSetHash: `${worldId}:${sequence.toString()}`, recordedAt: new Date() };
    const list = this.revisions.get(worldId) ?? []; list.push(record); this.revisions.set(worldId, list);
    const changeList = this.changes.get(worldId) ?? [];
    changeList.push({ id: randomUUID(), worldId, revisionId, sequence, objectType: change.objectType ?? 'world', objectId: change.objectId ?? worldId, operation: change.operation ?? 'update', patch: change.patch ?? {} });
    this.changes.set(worldId, changeList);
  }

  async createBranch(input: { id: string; worldId: string; name: string; parentBranchId?: string | null; forkTick?: bigint | null; forkRevision?: bigint | null; status: TimelineBranchStatus; now: Date }, expectedWorldRevision: bigint): Promise<TimelineBranch> {
    const world = this.worlds.get(input.worldId);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
    if (world.revision !== expectedWorldRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    this.assertWritable(world);
    const branch: TimelineBranch = {
      id: input.id,
      worldId: input.worldId,
      name: input.name,
      parentBranchId: input.parentBranchId ?? null,
      forkTick: input.forkTick ?? null,
      forkRevision: input.forkRevision ?? null,
      status: input.status,
      createdAt: input.now,
    };
    this.branches.set(branch.id, branch);
    this.bumpWorld(world, world.revision + 1n, { objectType: 'branch', objectId: branch.id, operation: 'create' });
    return branch;
  }

  async listBranches(worldId: string): Promise<TimelineBranch[]> {
    return [...this.branches.values()].filter((b) => b.worldId === worldId);
  }

  async getBranch(worldId: string, branchId: string): Promise<TimelineBranch | null> {
    const branch = this.branches.get(branchId);
    return branch && branch.worldId === worldId ? branch : null;
  }

  exportSnapshot(): MemoryRepositorySnapshot {
    return {
      worlds: [...this.worlds.values()],
      branches: [...this.branches.values()],
      entities: [...this.entities.values()],
      snapshotBaseEntities: [...this.snapshotBaseEntities.values()],
      snapshotBaseEntityHistory: [...this.snapshotBaseEntityHistory.entries()],
      entityTypes: [...this.entityTypes.values()],
      entityTypeVersions: [...this.entityTypeVersions.values()],
      facts: [...this.facts.values()],
      relationTypes: [...this.relationTypes.values()],
      relations: [...this.relations.values()],
      events: [...this.events.values()],
      eventMaterializationUndo: [...this.eventMaterializationUndo.entries()],
      claims: [...this.claims.values()],
      rules: [...this.rules.values()],
      works: [...this.works.values()],
      chapters: [...this.chapters.values()],
      scenes: [...this.scenes.values()],
      plotlines: [...this.plotlines.values()],
      foreshadowings: [...this.foreshadowings.values()],
      maps: [...this.maps.values()],
      mapLayers: [...this.mapLayers.values()],
      mapFeatures: [...this.mapFeatures.values()],
      assets: [...this.assets.values()],
      calendars: [...this.calendars.values()],
      calendarVersions: [...this.calendarVersions.values()],
      revisions: [...this.revisions.entries()],
      changes: [...this.changes.entries()],
      idempotency: [...this.idempotency.entries()],
      operationIdempotency: [...this.operationIdempotency.entries()],
      proposals: [...this.proposals.values()],
    };
  }

  loadSnapshot(snapshot: MemoryRepositorySnapshot): void {
    const refill = <T>(target: Map<string, T>, items: T[], key: (item: T) => string): void => {
      target.clear();
      for (const item of items) target.set(key(item), item);
    };
    refill(this.worlds, snapshot.worlds, (item) => item.id);
    refill(this.branches, snapshot.branches, (item) => item.id);
    refill(this.entities, snapshot.entities, (item) => item.id);
    refill(this.snapshotBaseEntities, snapshot.snapshotBaseEntities, (item) => item.id);
    this.snapshotBaseEntityHistory.clear();
    for (const [id, versions] of snapshot.snapshotBaseEntityHistory ?? []) this.snapshotBaseEntityHistory.set(id, versions);
    if (!this.snapshotBaseEntityHistory.size) for (const entity of this.snapshotBaseEntities.values()) this.snapshotBaseEntityHistory.set(entity.id, [{ from: entity.createdRevision ?? 1n, to: null, entity: structuredClone(entity) }]);
    refill(this.entityTypes, snapshot.entityTypes, (item) => item.id);
    refill(this.entityTypeVersions, snapshot.entityTypeVersions, (item) => item.id);
    refill(this.facts, snapshot.facts, (item) => item.id);
    refill(this.relationTypes, snapshot.relationTypes, (item) => item.id);
    refill(this.relations, snapshot.relations, (item) => item.id);
    refill(this.events, snapshot.events, (item) => item.id);
    this.eventMaterializationUndo.clear();
    for (const [eventId, undo] of snapshot.eventMaterializationUndo ?? []) this.eventMaterializationUndo.set(eventId, undo);
    refill(this.claims, snapshot.claims, (item) => item.id);
    refill(this.rules, snapshot.rules, (item) => item.id);
    refill(this.works, snapshot.works, (item) => item.id);
    refill(this.chapters, snapshot.chapters, (item) => item.id);
    refill(this.scenes, snapshot.scenes, (item) => item.id);
    refill(this.plotlines, snapshot.plotlines, (item) => item.id);
    refill(this.foreshadowings, snapshot.foreshadowings, (item) => item.id);
    refill(this.maps, snapshot.maps, (item) => item.id);
    refill(this.mapLayers, snapshot.mapLayers, (item) => item.id);
    refill(this.mapFeatures, snapshot.mapFeatures, (item) => item.id);
    refill(this.assets, snapshot.assets, (item) => item.id);
    refill(this.calendars, snapshot.calendars, (item) => item.id);
    refill(this.calendarVersions, snapshot.calendarVersions, (item) => item.id);
    this.revisions.clear();
    for (const [worldId, records] of snapshot.revisions) this.revisions.set(worldId, records);
    this.changes.clear();
    for (const [worldId, records] of snapshot.changes) this.changes.set(worldId, records);
    this.idempotency.clear();
    for (const [key, record] of snapshot.idempotency) this.idempotency.set(key, record);
    this.operationIdempotency.clear();
    for (const [key, record] of snapshot.operationIdempotency) this.operationIdempotency.set(key, record);
    refill(this.proposals, snapshot.proposals, (item) => item.id);
  }
}

export interface MemoryRepositorySnapshot {
  worlds: World[];
  branches: TimelineBranch[];
  entities: Entity[];
  snapshotBaseEntities: Entity[];
  snapshotBaseEntityHistory?: Array<[string, SnapshotBaseEntityVersion[]]>;
  entityTypes: EntityType[];
  entityTypeVersions: EntityTypeVersion[];
  facts: Fact[];
  relationTypes: RelationType[];
  relations: Relation[];
  events: WorldEvent[];
  eventMaterializationUndo?: Array<[string, EventMaterializationUndo]>;
  claims: Claim[];
  rules: ValidationRule[];
  works: Work[];
  chapters: Chapter[];
  scenes: Scene[];
  plotlines: Plotline[];
  foreshadowings: Foreshadowing[];
  maps: WorldMap[];
  mapLayers: MapLayer[];
  mapFeatures: MapFeature[];
  assets: Asset[];
  calendars: CalendarRecord[];
  calendarVersions: CalendarVersionRecord[];
  revisions: Array<[string, RevisionRecord[]]>;
  changes: Array<[string, ChangeRecord[]]>;
  idempotency: Array<[string, IdempotencyRecord]>;
  operationIdempotency: Array<[string, IdempotencyRecord]>;
  proposals: ProposalRecord[];
}

export interface SnapshotBaseEntityVersion {
  from: bigint;
  to: bigint | null;
  entity: Entity;
}
