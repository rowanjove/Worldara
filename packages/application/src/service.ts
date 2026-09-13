import {
  assertNonEmpty,
  assertParentIsAllowed,
  assertWorldName,
  assertValidFieldSchema,
  applySchemaMigrations,
  collectEntityText,
  DomainError,
  findUnlinkedMentions,
  linkPlainMention,
  parseWikiLinks,
  resolveWikiLinks,
  rewriteEntityStrings,
  validateEntityDocument,
  type EntityBacklink,
  type ResolvedWikiLink,
  type SchemaMigrationOp,
  type UnlinkedMention,
  type CreateEntityInput,
  type CreateEntityTypeInput,
  type CreateWorldInput,
  type Entity,
  type World,
  type CreateValidationRuleInput,
  type UpdateValidationRuleInput,
  type ValidationRule,
  type Work,
  type Chapter,
  type Scene,
  type CreateWorkInput,
  type UpdateWorkInput,
  type CreateChapterInput,
  type UpdateChapterInput,
  type CreateSceneInput,
  type UpdateSceneInput,
  type SceneReviewResult,
  type CreatePlotlineInput,
  type UpdatePlotlineInput,
  type Plotline,
  type CreateForeshadowingInput,
  type UpdateForeshadowingInput,
  type Foreshadowing,
  type ForeshadowingAuditResult,
  type ForeshadowingReviewIssue,
  type Fact,
  type Relation,
  type Claim,
} from '@world-codex/domain';
import { reviewSceneContinuity } from './continuity';
import type { ChangeRecord, Clock, IdGenerator, RevisionRecord, SearchResult, WorldRepository } from './ports';
import type { CalendarDefinition } from '@world-codex/calendar';
import type { Asset } from '@world-codex/domain';

export class WorldApplicationService {
  constructor(
    private readonly repository: WorldRepository & { listFacts?: (worldId: string) => Promise<Fact[]>; listRelations?: (worldId: string) => Promise<Relation[]>; listClaims?: (worldId: string) => Promise<Claim[]> },
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async createWorld(input: { name: string; slug?: string; description?: string; genre?: string; canonStrategy?: 'strict' | 'lenient' }): Promise<World> {
    assertWorldName(input.name);
    const slug = input.slug ?? slugify(input.name);
    assertNonEmpty(slug, 'slug');
    if (slug.length > 100 || !/^[a-z0-9\u4e00-\u9fff]+(?:-[a-z0-9\u4e00-\u9fff]+)*$/.test(slug)) throw new DomainError('VALIDATION_ERROR', 'slug contains unsupported characters', { field: 'slug' });
    const command: CreateWorldInput = {
      id: this.ids.next(),
      ownerId: null,
      name: input.name.trim(),
      slug,
      description: input.description ?? '',
      genre: input.genre ?? 'Custom',
      canonStrategy: input.canonStrategy ?? 'strict',
      now: this.clock.now(),
    };
    return this.repository.createWorld(command);
  }

  listWorlds(includeArchived = false): Promise<World[]> { return this.repository.listWorlds(includeArchived); }

  async archiveWorld(id: string, expectedRevision: bigint, archived: boolean): Promise<World> {
    return this.repository.archiveWorld(id, expectedRevision, archived);
  }

  async removeWorld(id: string): Promise<void> { await this.repository.deleteWorld(id); }
  async listRevisions(worldId: string, limit = 50): Promise<RevisionRecord[]> { await this.getWorld(worldId); return this.repository.listRevisions(worldId, limit); }
  async listRevisionChanges(worldId: string, sequence: bigint): Promise<ChangeRecord[]> { await this.getWorld(worldId); return this.repository.listRevisionChanges(worldId, sequence); }

  async createCalendar(worldId: string, input: { name: string; definition: CalendarDefinition }, expectedWorldRevision: bigint): Promise<Awaited<ReturnType<WorldRepository['createCalendar']>>> {
    if (!input.name.trim()) throw new DomainError('VALIDATION_ERROR', 'Calendar name must not be empty');
    await this.getWorld(worldId);
    return this.repository.createCalendar({ id: this.ids.next(), versionId: this.ids.next(), worldId, name: input.name.trim(), definition: input.definition, now: this.clock.now() }, expectedWorldRevision);
  }

  async listCalendars(worldId: string) { await this.getWorld(worldId); return this.repository.listCalendars(worldId); }
  async listCalendarVersions(worldId: string, calendarId: string) { await this.getWorld(worldId); return this.repository.listCalendarVersions(worldId, calendarId); }
  async getCalendarVersion(worldId: string, versionId: string) { await this.getWorld(worldId); const version = await this.repository.getCalendarVersion(worldId, versionId); if (!version) throw new DomainError('NOT_FOUND', 'Calendar version not found', { versionId }); return version; }
  async createCalendarVersion(worldId: string, calendarId: string, definition: CalendarDefinition, expectedWorldRevision: bigint) { await this.getWorld(worldId); return this.repository.createCalendarVersion({ id: this.ids.next(), worldId, calendarId, definition, now: this.clock.now() }, expectedWorldRevision); }
  async setDefaultCalendarVersion(worldId: string, versionId: string, expectedWorldRevision: bigint): Promise<World> {
    await this.getWorld(worldId);
    return this.repository.setDefaultCalendarVersion(worldId, versionId, expectedWorldRevision);
  }

  async createAsset(worldId: string, input: { storageKey: string; mediaType: string; byteSize: bigint; sha256: string; metadata: Record<string, unknown>; scanStatus: Asset['scanStatus']; scanMessage: string }, expectedWorldRevision: bigint): Promise<Asset> {
    await this.getWorld(worldId);
    return this.repository.createAsset({ id: this.ids.next(), worldId, ...input, now: this.clock.now() }, expectedWorldRevision);
  }
  async getAsset(worldId: string, assetId: string): Promise<Asset> { await this.getWorld(worldId); const asset = await this.repository.getAsset(worldId, assetId); if (!asset) throw new DomainError('NOT_FOUND', 'Asset not found', { assetId }); return asset; }
  async listAssets(worldId: string): Promise<Asset[]> { await this.getWorld(worldId); return this.repository.listAssets(worldId); }

  async createValidationRule(worldId: string, input: Omit<CreateValidationRuleInput, 'id' | 'worldId' | 'now'>, expectedWorldRevision: bigint): Promise<ValidationRule> {
    await this.getWorld(worldId);
    if (!input.name?.trim()) throw new DomainError('VALIDATION_ERROR', 'Rule name must not be empty');
    return this.repository.createValidationRule({
      id: this.ids.next(),
      worldId,
      name: input.name.trim(),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.targetSelector !== undefined ? { targetSelector: input.targetSelector } : {}),
      ...(input.when !== undefined ? { when: input.when } : {}),
      assert: input.assert,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async getValidationRule(worldId: string, ruleId: string): Promise<ValidationRule> {
    await this.getWorld(worldId);
    const rule = await this.repository.getValidationRule(worldId, ruleId);
    if (!rule) throw new DomainError('NOT_FOUND', 'Validation rule not found', { ruleId });
    return rule;
  }

  async listValidationRules(worldId: string): Promise<ValidationRule[]> {
    await this.getWorld(worldId);
    return this.repository.listValidationRules(worldId);
  }

  async updateValidationRule(worldId: string, ruleId: string, patch: UpdateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule> {
    await this.getValidationRule(worldId, ruleId);
    if (patch.name !== undefined && !patch.name.trim()) throw new DomainError('VALIDATION_ERROR', 'Rule name must not be empty');
    return this.repository.updateValidationRule(worldId, ruleId, {
      ...patch,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    }, expectedWorldRevision);
  }

  async deleteValidationRule(worldId: string, ruleId: string, expectedWorldRevision: bigint): Promise<void> {
    await this.getValidationRule(worldId, ruleId);
    return this.repository.deleteValidationRule(worldId, ruleId, expectedWorldRevision);
  }

  async getWorld(id: string): Promise<World> {
    const world = await this.repository.getWorld(id);
    if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: id });
    return world;
  }

  async updateWorld(id: string, expectedRevision: bigint, patch: Partial<Pick<World, 'name' | 'description' | 'genre' | 'canonStrategy'>>): Promise<World> {
    if (patch.name !== undefined) assertWorldName(patch.name);
    return this.repository.updateWorld(id, expectedRevision, patch);
  }

  async updateWorldTime(id: string, expectedRevision: bigint, tick: bigint): Promise<World> {
    return this.repository.updateWorldTime(id, expectedRevision, tick);
  }

  async getEntity(worldId: string, entityId: string): Promise<Entity> {
    const entity = await this.repository.getEntity(worldId, entityId);
    if (!entity) throw new DomainError('NOT_FOUND', 'Entity not found', { worldId, entityId });
    return entity;
  }

  async listEntities(worldId: string): Promise<Entity[]> { await this.getWorld(worldId); return this.repository.listEntities(worldId); }

  async listEntityBacklinks(worldId: string, entityId: string): Promise<EntityBacklink[]> {
    const target = await this.getEntity(worldId, entityId);
    const entities = await this.repository.listEntities(worldId);
    const backlinks: EntityBacklink[] = [];
    for (const source of entities) {
      if (source.id === target.id) continue;
      const links = resolveWikiLinks(parseWikiLinks(collectEntityText(source)), entities).filter((link) => link.entityId === target.id);
      if (links.length) backlinks.push({ entityId: source.id, name: source.name, links });
    }
    return backlinks;
  }

  async listUnlinkedMentions(worldId: string, entityId: string): Promise<UnlinkedMention[]> {
    const entity = await this.getEntity(worldId, entityId);
    const others = (await this.repository.listEntities(worldId)).filter((candidate) => candidate.id !== entity.id);
    const mentions = findUnlinkedMentions(collectEntityText(entity), others);
    const seen = new Set<string>();
    return mentions.filter((mention) => {
      if (seen.has(mention.entityId)) return false;
      seen.add(mention.entityId);
      return true;
    });
  }

  async linkEntityMention(worldId: string, entityId: string, name: string, expectedWorldRevision: bigint): Promise<Entity> {
    const current = await this.getEntity(worldId, entityId);
    const others = (await this.repository.listEntities(worldId)).filter((candidate) => candidate.id !== entityId);
    const mention = findUnlinkedMentions(collectEntityText(current), others).find((item) => item.name === name || item.entityId === name);
    if (!mention) throw new DomainError('VALIDATION_ERROR', 'Unlinked mention was not found in the entity text', { name });
    const rewritten = rewriteEntityStrings(current, (text) => linkPlainMention(text, mention.name));
    return this.updateEntityDraft(worldId, entityId, { document: rewritten.document, documentText: rewritten.documentText }, expectedWorldRevision);
  }

  async listResolvedOutgoingLinks(worldId: string, entityId: string): Promise<ResolvedWikiLink[]> {
    const entity = await this.getEntity(worldId, entityId);
    const entities = await this.repository.listEntities(worldId);
    return resolveWikiLinks(parseWikiLinks(collectEntityText(entity)), entities);
  }

  async updateEntityDraft(worldId: string, entityId: string, patch: Partial<Pick<Entity, 'name' | 'subtitle' | 'parentEntityId' | 'document' | 'documentText' | 'tags'>>, expectedWorldRevision: bigint): Promise<Entity> {
    if (patch.name !== undefined) assertNonEmpty(patch.name, 'name');
    const current = await this.getEntity(worldId, entityId);
    if (current.canonStatus === 'canon') throw new DomainError('VALIDATION_ERROR', 'Canon entities must be retconned instead of edited');
    if (patch.parentEntityId !== undefined && patch.parentEntityId !== null) {
      const parent = await this.repository.getEntity(worldId, patch.parentEntityId);
      if (!parent) throw new DomainError('NOT_FOUND', 'Parent entity not found', { parentEntityId: patch.parentEntityId });
      assertParentIsAllowed({ ...current, parentEntityId: patch.parentEntityId }, parent);
      await this.assertNoParentCycle(worldId, entityId, patch.parentEntityId);
    }
    const safeDocument = patch.document === undefined ? current.document : sanitizeValue(patch.document);
    const type = (await this.repository.listEntityTypes(worldId)).find((candidate) => candidate.id === current.typeId);
    if (!type) throw new DomainError('VALIDATION_ERROR', 'Entity type not found in world', { typeId: current.typeId });
    assertValidFieldSchema(type.schema);
    const worldEntities = await this.repository.listEntities(worldId);
    const entityIds = new Set(worldEntities.map((entity) => entity.id));
    const entityTypeById = new Map(worldEntities.map((entity) => [entity.id, entity.typeId]));
    const documentIssues = validateEntityDocument(type.schema, safeDocument, entityIds, entityTypeById);
    if (documentIssues.length) throw new DomainError('VALIDATION_ERROR', 'Entity document does not match its type schema', { issues: documentIssues });
    const safePatch = { ...patch, ...(patch.document === undefined ? {} : { document: safeDocument }), ...(patch.documentText === undefined ? {} : { documentText: stripUnsafeMarkup(patch.documentText) }) };
    return this.repository.updateEntity(worldId, entityId, expectedWorldRevision, safePatch, this.clock.now());
  }

  async createEntityDraft(worldId: string, input: Omit<CreateEntityInput, 'id' | 'worldId' | 'now'>, expectedWorldRevision: bigint): Promise<Entity> {
    assertNonEmpty(input.name, 'name');
    const world = await this.getWorld(worldId);
    const parent = input.parentEntityId ? await this.repository.getEntity(worldId, input.parentEntityId) : null;
    if (input.parentEntityId && !parent) throw new DomainError('NOT_FOUND', 'Parent entity not found', { parentEntityId: input.parentEntityId });
    if (input.parentEntityId) await this.assertNoParentCycle(worldId, '', input.parentEntityId);
    const safeDocument = sanitizeValue(input.document);
    const type = (await this.repository.listEntityTypes(worldId)).find((candidate) => candidate.id === input.typeId);
    if (!type) throw new DomainError('VALIDATION_ERROR', 'Entity type not found in world', { typeId: input.typeId });
    const requestedSchemaVersion = input.schemaVersion ?? type.schemaVersion;
    const requestedSchema = requestedSchemaVersion === type.schemaVersion
      ? type.schema
      : (await this.repository.listEntityTypeVersions(worldId, type.id)).find((version) => version.schemaVersion === requestedSchemaVersion)?.schema;
    if (!requestedSchema) throw new DomainError('VALIDATION_ERROR', 'Entity type schema version not found in world', { typeId: type.id, schemaVersion: requestedSchemaVersion });
    assertValidFieldSchema(requestedSchema);
    const worldEntities = await this.repository.listEntities(worldId);
    const entityIds = new Set(worldEntities.map((entity) => entity.id));
    const entityTypeById = new Map(worldEntities.map((entity) => [entity.id, entity.typeId]));
    const documentIssues = validateEntityDocument(requestedSchema, safeDocument, entityIds, entityTypeById);
    if (documentIssues.length) throw new DomainError('VALIDATION_ERROR', 'Entity document does not match its type schema', { issues: documentIssues });
    const entity: CreateEntityInput = {
      ...input,
      schemaVersion: requestedSchemaVersion,
      document: safeDocument,
      documentText: stripUnsafeMarkup(input.documentText),
      id: this.ids.next(),
      worldId,
      name: input.name.trim(),
      now: this.clock.now(),
    };
    const transientEntity: Entity = {
      ...entity,
      canonStatus: 'draft',
      revision: 0n,
      createdAt: entity.now,
      updatedAt: entity.now,
    };
    assertParentIsAllowed(transientEntity, parent);
    if (world.revision !== expectedWorldRevision) {
      throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedWorldRevision.toString(), actual: world.revision.toString() });
    }
    return this.repository.createEntity(entity, expectedWorldRevision);
  }

  async createEntityType(worldId: string, input: { typeKey: string; label: string; schema: Record<string, unknown> }, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').EntityType> {
    assertNonEmpty(input.typeKey, 'typeKey');
    assertNonEmpty(input.label, 'label');
    await this.getWorld(worldId);
    assertValidFieldSchema(input.schema);
    const command: CreateEntityTypeInput = { id: this.ids.next(), worldId, typeKey: input.typeKey.trim(), label: input.label.trim(), schema: input.schema, now: this.clock.now() };
    return this.repository.createEntityType(command, expectedWorldRevision);
  }

  async listEntityTypes(worldId: string): Promise<import('@world-codex/domain').EntityType[]> { await this.getWorld(worldId); return this.repository.listEntityTypes(worldId); }
  async createEntityTypeVersion(worldId: string, entityTypeId: string, schema: Record<string, unknown>, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').EntityTypeVersion> {
    await this.getWorld(worldId);
    assertValidFieldSchema(schema);
    return this.repository.createEntityTypeVersion(worldId, entityTypeId, schema, expectedWorldRevision, this.clock.now());
  }
  async listEntityTypeVersions(worldId: string, entityTypeId: string): Promise<import('@world-codex/domain').EntityTypeVersion[]> {
    await this.getWorld(worldId);
    return this.repository.listEntityTypeVersions(worldId, entityTypeId);
  }

  async migrateEntityTypeSchema(worldId: string, entityTypeId: string, operations: SchemaMigrationOp[], expectedWorldRevision: bigint): Promise<import('@world-codex/domain').EntityTypeVersion> {
    if (!operations.length) throw new DomainError('VALIDATION_ERROR', 'Schema migration requires at least one operation');
    const type = (await this.listEntityTypes(worldId)).find((candidate) => candidate.id === entityTypeId);
    if (!type) throw new DomainError('NOT_FOUND', 'Entity type not found', { entityTypeId });
    const nextSchema = applySchemaMigrations(type.schema, operations);
    assertValidFieldSchema(nextSchema);
    return this.createEntityTypeVersion(worldId, entityTypeId, nextSchema, expectedWorldRevision);
  }
  async search(worldId: string, query: string, limit = 50): Promise<SearchResult[]> { await this.getWorld(worldId); return this.repository.search(worldId, query, limit); }

  async createMap(worldId: string, input: { name: string; crs?: string; width: number; height: number; assetId?: string }, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').WorldMap> {
    if (!input.name.trim() || !Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) throw new DomainError('VALIDATION_ERROR', 'Map name and positive dimensions are required');
    await this.getWorld(worldId);
    if (input.assetId !== undefined) {
      const asset = await this.repository.getAsset(worldId, input.assetId);
      if (!asset) throw new DomainError('NOT_FOUND', 'Map asset not found in world', { assetId: input.assetId });
      if (asset.scanStatus !== 'passed') throw new DomainError('VALIDATION_ERROR', 'Map asset has not passed security scanning', { assetId: input.assetId, scanStatus: asset.scanStatus });
    }
    return this.repository.createMap({ id: this.ids.next(), worldId, name: input.name.trim(), crs: input.crs ?? 'CRS.Simple', width: input.width, height: input.height, ...(input.assetId === undefined ? {} : { assetId: input.assetId }), now: this.clock.now() }, expectedWorldRevision);
  }

  async listMaps(worldId: string): Promise<import('@world-codex/domain').WorldMap[]> { await this.getWorld(worldId); return this.repository.listMaps(worldId); }
  async createMapLayer(worldId: string, mapId: string, input: { name: string; kind: import('@world-codex/domain').MapLayer['kind']; sortOrder?: number; visible?: boolean; opacity?: number; style?: Record<string, unknown> }, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').MapLayer> {
    if (!input.name.trim() || input.name.trim().length > 200) throw new DomainError('VALIDATION_ERROR', 'Map layer name must be between 1 and 200 characters');
    if (!Number.isInteger(input.sortOrder ?? 0) || (input.sortOrder ?? 0) < 0) throw new DomainError('VALIDATION_ERROR', 'Map layer sortOrder must be a non-negative integer');
    if ((input.opacity ?? 1) < 0 || (input.opacity ?? 1) > 1 || !Number.isFinite(input.opacity ?? 1)) throw new DomainError('VALIDATION_ERROR', 'Map layer opacity must be between 0 and 1');
    if (!input.style || Array.isArray(input.style) || Object.keys(input.style).length > 100) throw new DomainError('VALIDATION_ERROR', 'Map layer style must be a bounded object');
    try { if (JSON.stringify(input.style).length > 100_000) throw new DomainError('VALIDATION_ERROR', 'Map layer style is too large'); } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('VALIDATION_ERROR', 'Map layer style is not serializable'); }
    await this.getWorld(worldId);
    return this.repository.createMapLayer({ id: this.ids.next(), worldId, mapId, name: input.name.trim(), kind: input.kind, sortOrder: input.sortOrder ?? 0, visible: input.visible ?? true, opacity: input.opacity ?? 1, style: input.style ?? {}, now: this.clock.now() }, expectedWorldRevision);
  }
  async listMapLayers(worldId: string, mapId: string): Promise<import('@world-codex/domain').MapLayer[]> { await this.getWorld(worldId); return this.repository.listMapLayers(worldId, mapId); }
  async updateMapLayer(worldId: string, mapId: string, layerId: string, input: Partial<Pick<import('@world-codex/domain').MapLayer, 'name' | 'kind' | 'sortOrder' | 'visible' | 'opacity' | 'style'>>, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').MapLayer> {
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 200)) throw new DomainError('VALIDATION_ERROR', 'Map layer name must be between 1 and 200 characters');
    if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) throw new DomainError('VALIDATION_ERROR', 'Map layer sortOrder must be a non-negative integer');
    if (input.opacity !== undefined && (!Number.isFinite(input.opacity) || input.opacity < 0 || input.opacity > 1)) throw new DomainError('VALIDATION_ERROR', 'Map layer opacity must be between 0 and 1');
    if (input.style !== undefined) {
      if (Array.isArray(input.style) || Object.keys(input.style).length > 100) throw new DomainError('VALIDATION_ERROR', 'Map layer style must be a bounded object');
      try { if (JSON.stringify(input.style).length > 100_000) throw new DomainError('VALIDATION_ERROR', 'Map layer style is too large'); } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('VALIDATION_ERROR', 'Map layer style is not serializable'); }
    }
    await this.getWorld(worldId);
    return this.repository.updateMapLayer(worldId, mapId, layerId, { ...input, ...(input.name === undefined ? {} : { name: input.name.trim() }), ...(input.style === undefined ? {} : { style: input.style }) }, expectedWorldRevision, this.clock.now());
  }

  async createMapFeature(worldId: string, mapId: string, input: { layerId?: string; entityId?: string; kind: import('@world-codex/domain').MapFeature['kind']; geometry: Record<string, unknown>; properties?: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint }, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').MapFeature> {
    await this.getWorld(worldId);
    return this.repository.createMapFeature({ id: this.ids.next(), worldId, mapId, ...(input.layerId === undefined ? {} : { layerId: input.layerId }), ...(input.entityId === undefined ? {} : { entityId: input.entityId }), kind: input.kind, geometry: input.geometry, properties: input.properties ?? {}, ...(input.validFromTick === undefined ? {} : { validFromTick: input.validFromTick }), ...(input.validToTick === undefined ? {} : { validToTick: input.validToTick }), now: this.clock.now() }, expectedWorldRevision);
  }

  async createMapFeatures(worldId: string, mapId: string, inputs: Array<{ layerId?: string; entityId?: string; kind: import('@world-codex/domain').MapFeature['kind']; geometry: Record<string, unknown>; properties?: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint }>, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').MapFeature[]> {
    await this.getWorld(worldId);
    const now = this.clock.now();
    return this.repository.createMapFeatures(inputs.map((input) => ({ id: this.ids.next(), worldId, mapId, ...(input.layerId === undefined ? {} : { layerId: input.layerId }), ...(input.entityId === undefined ? {} : { entityId: input.entityId }), kind: input.kind, geometry: input.geometry, properties: input.properties ?? {}, ...(input.validFromTick === undefined ? {} : { validFromTick: input.validFromTick }), ...(input.validToTick === undefined ? {} : { validToTick: input.validToTick }), now })), expectedWorldRevision);
  }

  async listMapFeatures(worldId: string, mapId: string): Promise<import('@world-codex/domain').MapFeature[]> {
    await this.getWorld(worldId);
    if (!(await this.repository.listMaps(worldId)).some((map) => map.id === mapId)) throw new DomainError('NOT_FOUND', 'Map not found', { mapId });
    return this.repository.listMapFeatures(worldId, mapId);
  }

  // --- Narrative: Works ---
  async createWork(worldId: string, input: CreateWorkInput, expectedWorldRevision: bigint): Promise<Work> {
    assertNonEmpty(input.title, 'title');
    await this.getWorld(worldId);
    return this.repository.createWork({
      id: this.ids.next(),
      worldId,
      title: input.title.trim(),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async getWork(worldId: string, workId: string): Promise<Work | null> {
    await this.getWorld(worldId);
    return this.repository.getWork(worldId, workId);
  }

  async listWorks(worldId: string): Promise<Work[]> {
    await this.getWorld(worldId);
    return this.repository.listWorks(worldId);
  }

  async updateWork(worldId: string, workId: string, input: UpdateWorkInput, expectedWorldRevision: bigint): Promise<Work> {
    await this.getWorld(worldId);
    if (input.title !== undefined) assertNonEmpty(input.title, 'title');
    return this.repository.updateWork(worldId, workId, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
    }, expectedWorldRevision, this.clock.now());
  }

  async deleteWork(worldId: string, workId: string, expectedWorldRevision: bigint): Promise<void> {
    await this.getWorld(worldId);
    return this.repository.deleteWork(worldId, workId, expectedWorldRevision);
  }

  // --- Narrative: Chapters ---
  async createChapter(worldId: string, workId: string, input: CreateChapterInput, expectedWorldRevision: bigint): Promise<Chapter> {
    assertNonEmpty(input.title, 'title');
    await this.getWorld(worldId);
    const work = await this.repository.getWork(worldId, workId);
    if (!work) throw new DomainError('NOT_FOUND', 'Work not found', { workId });
    return this.repository.createChapter({
      id: this.ids.next(),
      worldId,
      workId,
      title: input.title.trim(),
      ...(input.orderIndex === undefined ? {} : { orderIndex: input.orderIndex }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async getChapter(worldId: string, chapterId: string): Promise<Chapter | null> {
    await this.getWorld(worldId);
    return this.repository.getChapter(worldId, chapterId);
  }

  async listChapters(worldId: string, workId?: string): Promise<Chapter[]> {
    await this.getWorld(worldId);
    return this.repository.listChapters(worldId, workId);
  }

  async updateChapter(worldId: string, chapterId: string, input: UpdateChapterInput, expectedWorldRevision: bigint): Promise<Chapter> {
    await this.getWorld(worldId);
    if (input.title !== undefined) assertNonEmpty(input.title, 'title');
    return this.repository.updateChapter(worldId, chapterId, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.orderIndex === undefined ? {} : { orderIndex: input.orderIndex }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
    }, expectedWorldRevision, this.clock.now());
  }

  async deleteChapter(worldId: string, chapterId: string, expectedWorldRevision: bigint): Promise<void> {
    await this.getWorld(worldId);
    return this.repository.deleteChapter(worldId, chapterId, expectedWorldRevision);
  }

  // --- Narrative: Scenes ---
  async createScene(worldId: string, chapterId: string, input: CreateSceneInput, expectedWorldRevision: bigint): Promise<Scene> {
    await this.getWorld(worldId);
    const chapter = await this.repository.getChapter(worldId, chapterId);
    if (!chapter) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId });
    if (input.povCharacterId) {
      const pov = await this.repository.getEntity(worldId, input.povCharacterId);
      if (!pov) throw new DomainError('NOT_FOUND', 'POV character not found', { povCharacterId: input.povCharacterId });
    }
    if (input.locationEntityId) {
      const loc = await this.repository.getEntity(worldId, input.locationEntityId);
      if (!loc) throw new DomainError('NOT_FOUND', 'Location entity not found', { locationEntityId: input.locationEntityId });
    }
    if (input.participantEntityIds) {
      for (const pId of input.participantEntityIds) {
        const participant = await this.repository.getEntity(worldId, pId);
        if (!participant) throw new DomainError('NOT_FOUND', 'Participant entity not found', { participantId: pId });
      }
    }
    return this.repository.createScene({
      id: this.ids.next(),
      worldId,
      workId: chapter.workId,
      chapterId,
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.orderIndex === undefined ? {} : { orderIndex: input.orderIndex }),
      ...(input.sceneTick === undefined ? {} : { sceneTick: input.sceneTick }),
      ...(input.povCharacterId === undefined ? {} : { povCharacterId: input.povCharacterId }),
      ...(input.locationEntityId === undefined ? {} : { locationEntityId: input.locationEntityId }),
      ...(input.participantEntityIds === undefined ? {} : { participantEntityIds: input.participantEntityIds }),
      ...(input.plotlineIds === undefined ? {} : { plotlineIds: input.plotlineIds }),
      ...(input.proseText === undefined ? {} : { proseText: input.proseText }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.canonRevision === undefined ? {} : { canonRevision: input.canonRevision }),
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async getScene(worldId: string, sceneId: string): Promise<Scene | null> {
    await this.getWorld(worldId);
    return this.repository.getScene(worldId, sceneId);
  }

  async listScenes(worldId: string, chapterId?: string): Promise<Scene[]> {
    await this.getWorld(worldId);
    return this.repository.listScenes(worldId, chapterId);
  }

  async updateScene(worldId: string, sceneId: string, input: UpdateSceneInput, expectedWorldRevision: bigint): Promise<Scene> {
    await this.getWorld(worldId);
    if (input.povCharacterId) {
      const pov = await this.repository.getEntity(worldId, input.povCharacterId);
      if (!pov) throw new DomainError('NOT_FOUND', 'POV character not found', { povCharacterId: input.povCharacterId });
    }
    if (input.locationEntityId) {
      const loc = await this.repository.getEntity(worldId, input.locationEntityId);
      if (!loc) throw new DomainError('NOT_FOUND', 'Location entity not found', { locationEntityId: input.locationEntityId });
    }
    if (input.participantEntityIds) {
      for (const pId of input.participantEntityIds) {
        const participant = await this.repository.getEntity(worldId, pId);
        if (!participant) throw new DomainError('NOT_FOUND', 'Participant entity not found', { participantId: pId });
      }
    }
    return this.repository.updateScene(worldId, sceneId, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.orderIndex === undefined ? {} : { orderIndex: input.orderIndex }),
      ...(input.sceneTick === undefined ? {} : { sceneTick: input.sceneTick }),
      ...(input.povCharacterId === undefined ? {} : { povCharacterId: input.povCharacterId }),
      ...(input.locationEntityId === undefined ? {} : { locationEntityId: input.locationEntityId }),
      ...(input.participantEntityIds === undefined ? {} : { participantEntityIds: input.participantEntityIds }),
      ...(input.plotlineIds === undefined ? {} : { plotlineIds: input.plotlineIds }),
      ...(input.proseText === undefined ? {} : { proseText: input.proseText }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.canonRevision === undefined ? {} : { canonRevision: input.canonRevision }),
    }, expectedWorldRevision, this.clock.now());
  }

  async deleteScene(worldId: string, sceneId: string, expectedWorldRevision: bigint): Promise<void> {
    await this.getWorld(worldId);
    return this.repository.deleteScene(worldId, sceneId, expectedWorldRevision);
  }

  // --- Narrative: Plotlines ---
  async createPlotline(worldId: string, input: CreatePlotlineInput, expectedWorldRevision: bigint): Promise<Plotline> {
    assertNonEmpty(input.title, 'title');
    await this.getWorld(worldId);
    return this.repository.createPlotline({
      id: this.ids.next(),
      worldId,
      title: input.title.trim(),
      ...(input.summary === undefined ? {} : { summary: input.summary.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.currentStage === undefined ? {} : { currentStage: input.currentStage }),
      ...(input.characterEntityIds === undefined ? {} : { characterEntityIds: input.characterEntityIds }),
      ...(input.eventIds === undefined ? {} : { eventIds: input.eventIds }),
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async getPlotline(worldId: string, plotlineId: string): Promise<Plotline | null> {
    await this.getWorld(worldId);
    return this.repository.getPlotline(worldId, plotlineId);
  }

  async listPlotlines(worldId: string): Promise<Plotline[]> {
    await this.getWorld(worldId);
    return this.repository.listPlotlines(worldId);
  }

  async updatePlotline(worldId: string, plotlineId: string, input: UpdatePlotlineInput, expectedWorldRevision: bigint): Promise<Plotline> {
    await this.getWorld(worldId);
    if (input.title !== undefined) assertNonEmpty(input.title, 'title');
    return this.repository.updatePlotline(worldId, plotlineId, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.summary === undefined ? {} : { summary: input.summary.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.currentStage === undefined ? {} : { currentStage: input.currentStage }),
      ...(input.characterEntityIds === undefined ? {} : { characterEntityIds: input.characterEntityIds }),
      ...(input.eventIds === undefined ? {} : { eventIds: input.eventIds }),
    }, expectedWorldRevision, this.clock.now());
  }

  async deletePlotline(worldId: string, plotlineId: string, expectedWorldRevision: bigint): Promise<void> {
    await this.getWorld(worldId);
    return this.repository.deletePlotline(worldId, plotlineId, expectedWorldRevision);
  }

  // --- Narrative: Foreshadowings ---
  async createForeshadowing(worldId: string, input: CreateForeshadowingInput, expectedWorldRevision: bigint): Promise<Foreshadowing> {
    assertNonEmpty(input.title, 'title');
    await this.getWorld(worldId);
    const setupScene = await this.repository.getScene(worldId, input.setupSceneId);
    if (!setupScene) throw new DomainError('NOT_FOUND', 'Setup scene not found', { sceneId: input.setupSceneId });

    let payoffScene: Scene | null = null;
    if (input.payoffSceneId) {
      payoffScene = await this.repository.getScene(worldId, input.payoffSceneId);
      if (!payoffScene) throw new DomainError('NOT_FOUND', 'Payoff scene not found', { sceneId: input.payoffSceneId });
    }
    if (input.plotlineId) {
      const plotline = await this.repository.getPlotline(worldId, input.plotlineId);
      if (!plotline) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId: input.plotlineId });
    }

    return this.repository.createForeshadowing({
      id: this.ids.next(),
      worldId,
      title: input.title.trim(),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      setupSceneId: input.setupSceneId,
      ...(input.setupTick !== undefined ? { setupTick: input.setupTick } : (setupScene.sceneTick !== undefined ? { setupTick: setupScene.sceneTick } : {})),
      ...(input.payoffSceneId === undefined ? {} : { payoffSceneId: input.payoffSceneId }),
      ...(input.payoffTick !== undefined ? { payoffTick: input.payoffTick } : (payoffScene?.sceneTick !== undefined ? { payoffTick: payoffScene.sceneTick } : {})),
      ...(input.relatedEntityIds === undefined ? {} : { relatedEntityIds: input.relatedEntityIds }),
      ...(input.plotlineId === undefined ? {} : { plotlineId: input.plotlineId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async getForeshadowing(worldId: string, foreshadowingId: string): Promise<Foreshadowing | null> {
    await this.getWorld(worldId);
    return this.repository.getForeshadowing(worldId, foreshadowingId);
  }

  async listForeshadowings(worldId: string, plotlineId?: string): Promise<Foreshadowing[]> {
    await this.getWorld(worldId);
    return this.repository.listForeshadowings(worldId, plotlineId);
  }

  async updateForeshadowing(worldId: string, foreshadowingId: string, input: UpdateForeshadowingInput, expectedWorldRevision: bigint): Promise<Foreshadowing> {
    await this.getWorld(worldId);
    if (input.title !== undefined) assertNonEmpty(input.title, 'title');
    if (input.setupSceneId) {
      const setupScene = await this.repository.getScene(worldId, input.setupSceneId);
      if (!setupScene) throw new DomainError('NOT_FOUND', 'Setup scene not found', { sceneId: input.setupSceneId });
    }
    if (input.payoffSceneId) {
      const payoffScene = await this.repository.getScene(worldId, input.payoffSceneId);
      if (!payoffScene) throw new DomainError('NOT_FOUND', 'Payoff scene not found', { sceneId: input.payoffSceneId });
    }
    if (input.plotlineId) {
      const plotline = await this.repository.getPlotline(worldId, input.plotlineId);
      if (!plotline) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId: input.plotlineId });
    }

    return this.repository.updateForeshadowing(worldId, foreshadowingId, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.setupSceneId === undefined ? {} : { setupSceneId: input.setupSceneId }),
      ...(input.setupTick === undefined ? {} : { setupTick: input.setupTick }),
      ...(input.payoffSceneId === undefined ? {} : { payoffSceneId: input.payoffSceneId }),
      ...(input.payoffTick === undefined ? {} : { payoffTick: input.payoffTick }),
      ...(input.relatedEntityIds === undefined ? {} : { relatedEntityIds: input.relatedEntityIds }),
      ...(input.plotlineId === undefined ? {} : { plotlineId: input.plotlineId }),
      ...(input.status === undefined ? {} : { status: input.status }),
    }, expectedWorldRevision, this.clock.now());
  }

  async deleteForeshadowing(worldId: string, foreshadowingId: string, expectedWorldRevision: bigint): Promise<void> {
    await this.getWorld(worldId);
    return this.repository.deleteForeshadowing(worldId, foreshadowingId, expectedWorldRevision);
  }

  // --- Narrative: Foreshadowing Audit ---
  async auditForeshadowings(worldId: string): Promise<ForeshadowingAuditResult> {
    await this.getWorld(worldId);
    const [foreshadowings, scenes, plotlines] = await Promise.all([
      this.repository.listForeshadowings(worldId),
      this.repository.listScenes(worldId),
      this.repository.listPlotlines(worldId),
    ]);

    const sceneMap = new Map(scenes.map((s) => [s.id, s]));
    const plotlineMap = new Map(plotlines.map((p) => [p.id, p]));

    let openCount = 0;
    let resolvedCount = 0;
    let abandonedCount = 0;
    const issues: ForeshadowingReviewIssue[] = [];

    const payoffUsage = new Map<string, string[]>();

    for (const f of foreshadowings) {
      if (f.status === 'open') openCount++;
      else if (f.status === 'resolved') resolvedCount++;
      else if (f.status === 'abandoned') abandonedCount++;

      const setupScene = sceneMap.get(f.setupSceneId);
      if (!setupScene) {
        issues.push({
          code: 'ORPHANED_PAYOFF',
          severity: 'blocker',
          foreshadowingId: f.id,
          ...(f.setupSceneId ? { setupSceneId: f.setupSceneId } : {}),
          message: `Setup scene "${f.setupSceneId}" does not exist in the world.`,
          evidence: [f.setupSceneId],
        });
      }

      let payoffScene: Scene | undefined;
      if (f.payoffSceneId) {
        payoffScene = sceneMap.get(f.payoffSceneId);
        if (!payoffScene) {
          issues.push({
            code: 'ORPHANED_PAYOFF',
            severity: 'blocker',
            foreshadowingId: f.id,
            payoffSceneId: f.payoffSceneId,
            message: `Payoff scene "${f.payoffSceneId}" does not exist in the world.`,
            evidence: [f.payoffSceneId],
          });
        }
      }

      if (f.status === 'resolved' && !f.payoffSceneId) {
        issues.push({
          code: 'ORPHANED_PAYOFF',
          severity: 'warning',
          foreshadowingId: f.id,
          message: `Foreshadowing "${f.title}" is marked as resolved but has no payoff scene recorded.`,
          evidence: [f.id],
        });
      }

      if (setupScene && payoffScene) {
        const setupTick = f.setupTick ?? setupScene.sceneTick;
        const payoffTick = f.payoffTick ?? payoffScene.sceneTick;

        if (setupTick !== undefined && payoffTick !== undefined && payoffTick < setupTick) {
          issues.push({
            code: 'PREMATURE_PAYOFF',
            severity: 'blocker',
            foreshadowingId: f.id,
            setupSceneId: setupScene.id,
            payoffSceneId: payoffScene.id,
            message: `Payoff tick (${payoffTick.toString()}) occurs before setup tick (${setupTick.toString()}) for foreshadowing "${f.title}".`,
            evidence: [
              `Setup scene: ${setupScene.id} at tick ${setupTick.toString()}`,
              `Payoff scene: ${payoffScene.id} at tick ${payoffTick.toString()}`,
            ],
          });
        } else if (
          setupScene.workId === payoffScene.workId &&
          setupScene.chapterId === payoffScene.chapterId &&
          payoffScene.orderIndex < setupScene.orderIndex
        ) {
          issues.push({
            code: 'PREMATURE_PAYOFF',
            severity: 'blocker',
            foreshadowingId: f.id,
            setupSceneId: setupScene.id,
            payoffSceneId: payoffScene.id,
            message: `Payoff scene orderIndex (${payoffScene.orderIndex}) is earlier than setup scene orderIndex (${setupScene.orderIndex}) within the same chapter.`,
            evidence: [
              `Setup scene order: ${setupScene.orderIndex}`,
              `Payoff scene order: ${payoffScene.orderIndex}`,
            ],
          });
        }
      }

      if (f.payoffSceneId && f.status !== 'abandoned') {
        const key = `${f.plotlineId ?? 'global'}:${f.payoffSceneId}`;
        const existing = payoffUsage.get(key) ?? [];
        existing.push(f.id);
        payoffUsage.set(key, existing);
      }

      if (f.status === 'open' && f.plotlineId) {
        const pl = plotlineMap.get(f.plotlineId);
        if (pl && (pl.status === 'resolved' || pl.currentStage === 'resolution')) {
          issues.push({
            code: 'UNRESOLVED_FORESHADOWING',
            severity: 'warning',
            foreshadowingId: f.id,
            ...(f.setupSceneId ? { setupSceneId: f.setupSceneId } : {}),
            message: `Plotline "${pl.title}" is ${pl.status === 'resolved' ? 'resolved' : 'in resolution stage'}, but foreshadowing "${f.title}" remains unfulfilled (open).`,
            evidence: [
              `Plotline: ${pl.title} (${pl.id})`,
              `Plotline stage: ${pl.currentStage}, status: ${pl.status}`,
              `Foreshadowing: ${f.title} (${f.id})`,
            ],
          });
        }
      }
    }

    for (const [, fIds] of payoffUsage.entries()) {
      if (fIds.length > 1) {
        for (const fId of fIds) {
          const f = foreshadowings.find((item) => item.id === fId);
          issues.push({
            code: 'DUPLICATE_PAYOFF',
            severity: 'warning',
            foreshadowingId: fId,
            ...(f?.payoffSceneId ? { payoffSceneId: f.payoffSceneId } : {}),
            message: `Payoff scene is shared by multiple foreshadowings (${fIds.join(', ')}) within the same narrative plotline scope.`,
            evidence: fIds,
          });
        }
      }
    }

    return {
      totalForeshadowings: foreshadowings.length,
      openCount,
      resolvedCount,
      abandonedCount,
      issues,
    };
  }

  async reviewSceneContinuity(worldId: string, sceneId: string): Promise<SceneReviewResult> {
    const world = await this.getWorld(worldId);
    const scene = await this.repository.getScene(worldId, sceneId);
    if (!scene) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId });
    const [entities, facts, relations, claims, foreshadowings] = await Promise.all([
      this.repository.listEntities(worldId),
      this.repository.listFacts ? this.repository.listFacts(worldId) : Promise.resolve([]),
      this.repository.listRelations ? this.repository.listRelations(worldId) : Promise.resolve([]),
      this.repository.listClaims ? this.repository.listClaims(worldId) : Promise.resolve([]),
      this.repository.listForeshadowings ? this.repository.listForeshadowings(worldId) : Promise.resolve([]),
    ]);
    const reviewResult = reviewSceneContinuity(world, scene, entities, facts, relations, claims);

    // Foreshadowing checks for this specific scene
    const effectiveTick = scene.sceneTick ?? world.currentTick;
    for (const f of foreshadowings) {
      if (f.payoffSceneId === scene.id) {
        const setupScene = await this.repository.getScene(worldId, f.setupSceneId);
        if (!setupScene) {
          reviewResult.issues.push({
            code: 'ORPHANED_PAYOFF',
            severity: 'blocker',
            sceneId: scene.id,
            message: `Scene attempts to payoff foreshadowing "${f.title}", but its setup scene "${f.setupSceneId}" does not exist.`,
            evidence: [`Foreshadowing: ${f.id}`, `Setup scene: ${f.setupSceneId}`],
          });
        } else {
          const setupTick = f.setupTick ?? setupScene.sceneTick;
          if (setupTick !== undefined && effectiveTick < setupTick) {
            reviewResult.issues.push({
              code: 'PREMATURE_PAYOFF',
              severity: 'blocker',
              sceneId: scene.id,
              message: `Scene pays off foreshadowing "${f.title}" at tick ${effectiveTick.toString()}, but setup occurred at later tick ${setupTick.toString()}.`,
              evidence: [`Foreshadowing: ${f.id}`, `Setup tick: ${setupTick.toString()}`, `Scene tick: ${effectiveTick.toString()}`],
            });
          }
        }
      }
    }

    reviewResult.pass = !reviewResult.issues.some((i) => i.severity === 'blocker' || i.severity === 'error');
    return reviewResult;
  }

  private async assertNoParentCycle(worldId: string, entityId: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (entityId && cursor === entityId) throw new DomainError('VALIDATION_ERROR', 'Entity parent cycle detected', { entityId, parentId });
      if (visited.has(cursor)) throw new DomainError('VALIDATION_ERROR', 'Entity parent cycle detected', { entityId, parentId });
      visited.add(cursor);
      const parent = await this.repository.getEntity(worldId, cursor);
      cursor = parent?.parentEntityId ?? null;
    }
  }
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function sanitizeValue(value: unknown): Record<string, unknown> {
  const clean = (input: unknown): unknown => {
    if (typeof input === 'string') return stripUnsafeMarkup(input);
    if (Array.isArray(input)) return input.map(clean);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, clean(item)]));
    return input;
  };
  return (clean(value) ?? {}) as Record<string, unknown>;
}

function stripUnsafeMarkup(value: string): string {
  return value.replace(/<\/?(script|style|iframe|object|embed|svg)(?:\s[^>]*)?>[\s\S]*?<\/?\1\s*>/gi, '').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
}
