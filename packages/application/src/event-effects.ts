import { assertNonEmpty, assertValidFieldSchema, DEFAULT_BRANCH_ID, DomainError, temporalIdentityField, validateEntityDocument, type Entity, type EntityType, type Fact, type MapFeature, type Relation, type RelationType, type WorldEvent } from '@world-codex/domain';

export interface EventMaterializationState {
  entities: Entity[];
  entityTypes: EntityType[];
  facts: Fact[];
  relations: Relation[];
  relationTypes: RelationType[];
  mapFeatures?: MapFeature[];
}

export interface EventMaterializationUndo {
  entities: Entity[];
  facts: Fact[];
  relations: Relation[];
  mapFeatures: MapFeature[];
}

export interface EventMaterializationResult extends EventMaterializationState {
  undo: EventMaterializationUndo;
}

/**
 * Apply one Canon event to a detached state copy.
 *
 * The function deliberately does not mutate its input. Repositories can use it
 * for preflight validation and then persist the returned records inside their
 * own transaction. Event effects are ordered by sequence and can reference
 * records created by an earlier effect in the same event.
 */
export function materializeEventEffects(event: WorldEvent, input: EventMaterializationState, revision: bigint, now: Date): EventMaterializationResult {
  const entities = input.entities.map(cloneEntity);
  const entityTypes = input.entityTypes.map((entityType) => ({ ...entityType, schema: structuredClone(entityType.schema) }));
  const facts = input.facts.map(cloneFact);
  const relations = input.relations.map(cloneRelation);
  const relationTypes = input.relationTypes.map((relationType) => ({ ...relationType, sourceTypeIds: [...relationType.sourceTypeIds], targetTypeIds: [...relationType.targetTypeIds] }));
  const mapFeatures = (input.mapFeatures ?? []).map(cloneMapFeature);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const entityTypeById = new Map(entityTypes.map((entityType) => [entityType.id, entityType]));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  const relationTypeById = new Map(relationTypes.map((relationType) => [relationType.id, relationType]));
  const mapFeatureById = new Map(mapFeatures.map((feature) => [feature.id, feature]));
  const undoEntities = new Map<string, Entity>();
  const undoFacts = new Map<string, Fact>();
  const undoRelations = new Map<string, Relation>();
  const undoMapFeatures = new Map<string, MapFeature>();
  const captureEntity = (id: string): void => {
    if (undoEntities.has(id)) return;
    const original = input.entities.find((candidate) => candidate.id === id);
    if (original) undoEntities.set(id, cloneEntity(original));
  };
  const captureFact = (id: string): void => {
    if (undoFacts.has(id)) return;
    const original = input.facts.find((candidate) => candidate.id === id);
    if (original) undoFacts.set(id, cloneFact(original));
  };
  const captureRelation = (id: string): void => {
    if (undoRelations.has(id)) return;
    const original = input.relations.find((candidate) => candidate.id === id);
    if (original) undoRelations.set(id, cloneRelation(original));
  };
  const captureMapFeature = (id: string): void => {
    if (undoMapFeatures.has(id)) return;
    const original = input.mapFeatures?.find((candidate) => candidate.id === id);
    if (original) undoMapFeatures.set(id, cloneMapFeature(original));
  };
  const entityIds = new Set(entityById.keys());
  const entityTypeByEntityId = new Map([...entityById.values()].map((candidate) => [candidate.id, candidate.typeId]));
  const validateEntityDocumentOrThrow = (entity: Entity): void => {
    const entityType = entityTypeById.get(entity.typeId);
    if (!entityType) throw new DomainError('VALIDATION_ERROR', 'Entity type does not exist', { typeId: entity.typeId });
    assertValidFieldSchema(entityType.schema);
    const issues = validateEntityDocument(entityType.schema, entity.document, entityIds, entityTypeByEntityId);
    if (issues.length) throw new DomainError('VALIDATION_ERROR', 'Event effect produces an invalid entity document', { entityId: entity.id, issues });
  };

  const requireEntity = (id: unknown, label: string): Entity => {
    if (typeof id !== 'string' || !entityById.has(id)) throw new DomainError('VALIDATION_ERROR', `${label} entity does not exist`, { entityId: id });
    return entityById.get(id)!;
  };
  const requireFact = (id: unknown): Fact => {
    if (typeof id !== 'string' || !factById.has(id)) throw new DomainError('VALIDATION_ERROR', 'Event fact effect target does not exist', { factId: id });
    return factById.get(id)!;
  };
  const requireRelation = (id: unknown): Relation => {
    if (typeof id !== 'string' || !relationById.has(id)) throw new DomainError('VALIDATION_ERROR', 'Event relation effect target does not exist', { relationId: id });
    return relationById.get(id)!;
  };
  const requireMapFeature = (id: unknown): MapFeature => {
    if (typeof id !== 'string' || !mapFeatureById.has(id)) throw new DomainError('VALIDATION_ERROR', 'Event geometry effect target does not exist', { mapFeatureId: id });
    return mapFeatureById.get(id)!;
  };
  const requireCanonEntity = (id: unknown, label: string): Entity => {
    const entity = requireEntity(id, label);
    if (entity.canonStatus !== 'canon' && entity.canonStatus !== 'pending') throw new DomainError('VALIDATION_ERROR', `${label} entity is not Canon`, { entityId: entity.id, canonStatus: entity.canonStatus });
    return entity;
  };
  const requireCanonFact = (id: unknown): Fact => {
    const fact = requireFact(id);
    if (fact.canonStatus !== 'canon' && fact.canonStatus !== 'pending') throw new DomainError('VALIDATION_ERROR', 'Event fact effect target is not Canon', { factId: fact.id, canonStatus: fact.canonStatus });
    return fact;
  };
  const requireCanonRelation = (id: unknown): Relation => {
    const relation = requireRelation(id);
    if (relation.canonStatus !== 'canon' && relation.canonStatus !== 'pending') throw new DomainError('VALIDATION_ERROR', 'Event relation effect target is not Canon', { relationId: relation.id, canonStatus: relation.canonStatus });
    return relation;
  };
  const assertActiveAtEvent = (from: bigint | undefined, to: bigint | undefined, label: string): void => {
    if (from !== undefined && from >= event.startTick) throw new DomainError('VALIDATION_ERROR', `${label} starts after the event`, { startTick: event.startTick.toString() });
    if (to !== undefined && to <= event.startTick) throw new DomainError('VALIDATION_ERROR', `${label} is not active at the event`, { startTick: event.startTick.toString() });
  };
  const assertEntityType = (entity: Entity, relationType: RelationType, side: 'source' | 'target'): void => {
    const allowed = side === 'source' ? relationType.sourceTypeIds : relationType.targetTypeIds;
    if (allowed.length > 0 && !allowed.includes(entity.typeId)) throw new DomainError('VALIDATION_ERROR', `${side} entity type is not allowed for relation effect`, { entityId: entity.id, relationTypeId: relationType.id });
  };
  const endFact = (fact: Fact): void => {
    if (fact.validToTick === undefined || fact.validToTick > event.startTick) fact.validToTick = event.startTick;
  };
  const endRelation = (relation: Relation): void => {
    if (relation.validToTick === undefined || relation.validToTick > event.startTick) relation.validToTick = event.startTick;
  };
  const effectIdAvailable = (id: string): void => {
    const fact = factById.get(id);
    const relation = relationById.get(id);
    const entity = entityById.get(id);
    const mapFeature = mapFeatureById.get(id);
    if ((fact && !isRetconnedProjection(fact, event.id)) || (relation && !isRetconnedProjection(relation, event.id)) || (entity && !isRetconnedProjection(entity, event.id)) || (mapFeature && !isRetconnedProjection(mapFeature, event.id))) throw new DomainError('VALIDATION_ERROR', 'Event effect id collides with an existing record', { effectId: id });
  };

  for (const effect of [...event.effects].sort((left, right) => left.sequence === right.sequence ? left.id.localeCompare(right.id) : left.sequence - right.sequence)) {
    const payload = effect.payload ?? {};
    switch (effect.type) {
      case 'END_FACT': {
        const fact = requireCanonFact(effect.targetId);
        assertActiveAtEvent(fact.validFromTick, fact.validToTick, 'Fact');
        captureFact(fact.id);
        endFact(fact);
        break;
      }
      case 'SET_FIELD': {
        const targetId = effect.targetId;
        if (typeof targetId !== 'string') throw new DomainError('VALIDATION_ERROR', 'SET_FIELD targetId is required', { effectId: effect.id });
        if (factById.has(targetId)) {
          // A SET_FIELD proposal may use a Fact target as a more expressive
          // alias for SET_FACT. Keep both spellings on the same temporal path.
          const current = requireCanonFact(targetId);
          assertActiveAtEvent(current.validFromTick, current.validToTick, 'Fact');
          captureFact(current.id);
          effectIdAvailable(effect.id);
          const previousValidTo = current.validToTick;
          endFact(current);
          const objectKind = payload.objectKind === undefined ? current.objectKind : payload.objectKind;
          if (objectKind !== 'scalar' && objectKind !== 'entity' && objectKind !== 'json') throw new DomainError('VALIDATION_ERROR', 'SET_FIELD objectKind is invalid', { effectId: effect.id });
          const objectEntityId = objectKind === 'entity' ? (typeof payload.objectEntityId === 'string' ? payload.objectEntityId : current.objectEntityId) : undefined;
          if (objectKind === 'entity') requireCanonEntity(objectEntityId, 'Fact target');
          const next: Fact = {
            id: effect.id,
            worldId: event.worldId,
            branchId: event.branchId ?? DEFAULT_BRANCH_ID,
            subjectEntityId: current.subjectEntityId,
            predicateKey: typeof payload.predicateKey === 'string' && payload.predicateKey.trim() ? payload.predicateKey : current.predicateKey,
            objectKind,
            value: objectKind === 'entity' ? null : (payload.value === undefined ? current.value : payload.value),
            ...(objectEntityId === undefined ? {} : { objectEntityId }),
            validFromTick: event.startTick,
            ...(previousValidTo === undefined ? {} : { validToTick: previousValidTo }),
            canonStatus: 'canon',
            sourceKind: 'event',
            sourceRefId: event.id,
            createdRevision: revision,
            revisionFrom: revision,
            revisionTo: null,
          };
          facts.push(next); factById.set(next.id, next);
          break;
        }
        const entity = requireCanonEntity(targetId, 'SET_FIELD target');
        effectIdAvailable(effect.id);
        if (typeof payload.field !== 'string' || !payload.field.trim() || payload.field.length > 200) throw new DomainError('VALIDATION_ERROR', 'SET_FIELD field is required', { effectId: effect.id });
        captureEntity(entity.id);
        entity.document = { ...entity.document, [payload.field]: structuredClone(payload.value) };
        const identity = temporalIdentityField(payload.field);
        if (identity === 'name' && typeof payload.value === 'string') entity.name = payload.value;
        if (identity === 'subtitle' && typeof payload.value === 'string') entity.subtitle = payload.value;
        if (identity === 'parentEntityId') {
          if (payload.value !== null && payload.value !== undefined && typeof payload.value !== 'string') throw new DomainError('VALIDATION_ERROR', 'parentEntityId must be a string or null', { effectId: effect.id });
          const parentId = typeof payload.value === 'string' ? payload.value : null;
          if (parentId) {
            const parent = requireCanonEntity(parentId, 'Parent');
            assertNoParentCycle(entity.id, parent.id, entityById);
          }
          entity.parentEntityId = parentId;
        }
        validateEntityDocumentOrThrow(entity);
        entity.revision = revision;
        entity.sourceKind = 'event';
        entity.sourceRefId = event.id;
        entity.updatedAt = now;
        break;
      }
      case 'SET_FACT': {
        const current = requireCanonFact(effect.targetId);
        assertActiveAtEvent(current.validFromTick, current.validToTick, 'Fact');
        captureFact(current.id);
        effectIdAvailable(effect.id);
        const previousValidTo = current.validToTick;
        endFact(current);
        const objectKind = payload.objectKind === undefined ? current.objectKind : payload.objectKind;
        if (objectKind !== 'scalar' && objectKind !== 'entity' && objectKind !== 'json') throw new DomainError('VALIDATION_ERROR', 'SET_FACT objectKind is invalid', { effectId: effect.id });
        const objectEntityId = objectKind === 'entity' ? (typeof payload.objectEntityId === 'string' ? payload.objectEntityId : current.objectEntityId) : undefined;
        if (objectKind === 'entity') requireCanonEntity(objectEntityId, 'Fact target');
        const next: Fact = {
          id: effect.id,
          worldId: event.worldId,
          branchId: event.branchId ?? DEFAULT_BRANCH_ID,
          subjectEntityId: current.subjectEntityId,
          predicateKey: typeof payload.predicateKey === 'string' && payload.predicateKey.trim() ? payload.predicateKey : current.predicateKey,
          objectKind,
          value: objectKind === 'entity' ? null : (payload.value === undefined ? current.value : payload.value),
          ...(objectEntityId === undefined ? {} : { objectEntityId }),
          validFromTick: event.startTick,
          ...(previousValidTo === undefined ? {} : { validToTick: previousValidTo }),
          canonStatus: 'canon',
          sourceKind: 'event',
          sourceRefId: event.id,
          createdRevision: revision,
          revisionFrom: revision,
          revisionTo: null,
        };
        facts.push(next); factById.set(next.id, next);
        break;
      }
      case 'ADD_FACT': {
        effectIdAvailable(effect.id);
        const subjectEntityId = requireCanonEntity(payload.subjectEntityId, 'Fact subject').id;
        if (typeof payload.predicateKey !== 'string' || !payload.predicateKey.trim()) throw new DomainError('VALIDATION_ERROR', 'ADD_FACT predicateKey is required', { effectId: effect.id });
        const objectKind = payload.objectKind;
        if (objectKind !== 'scalar' && objectKind !== 'entity' && objectKind !== 'json') throw new DomainError('VALIDATION_ERROR', 'ADD_FACT objectKind is invalid', { effectId: effect.id });
        const objectEntityId = objectKind === 'entity' ? requireCanonEntity(payload.objectEntityId, 'Fact target').id : undefined;
        const validToTick = payload.validToTick === undefined ? undefined : parseEffectTick(payload.validToTick, 'validToTick');
        if (validToTick !== undefined && validToTick <= event.startTick) throw new DomainError('VALIDATION_ERROR', 'Fact effect range must be non-empty', { effectId: effect.id });
        const next: Fact = { id: effect.id, worldId: event.worldId, branchId: event.branchId ?? DEFAULT_BRANCH_ID, subjectEntityId, predicateKey: payload.predicateKey.trim(), objectKind, value: objectKind === 'entity' ? null : (payload.value ?? null), ...(objectEntityId === undefined ? {} : { objectEntityId }), validFromTick: event.startTick, ...(validToTick === undefined ? {} : { validToTick }), canonStatus: 'canon', sourceKind: 'event', sourceRefId: event.id, createdRevision: revision, revisionFrom: revision, revisionTo: null };
        facts.push(next); factById.set(next.id, next);
        break;
      }
      case 'END_RELATION':
      case 'REMOVE_RELATION': {
        const relation = requireCanonRelation(effect.targetId);
        assertActiveAtEvent(relation.validFromTick, relation.validToTick, 'Relation');
        captureRelation(relation.id);
        endRelation(relation);
        break;
      }
      case 'ADD_RELATION': {
        effectIdAvailable(effect.id);
        const source = requireCanonEntity(payload.sourceEntityId, 'Relation source');
        const target = requireCanonEntity(payload.targetEntityId, 'Relation target');
        if (source.id === target.id) throw new DomainError('VALIDATION_ERROR', 'Relation effect cannot target itself', { effectId: effect.id });
        if (typeof payload.relationTypeId !== 'string' || !relationTypeById.has(payload.relationTypeId)) throw new DomainError('VALIDATION_ERROR', 'Relation effect type does not exist', { relationTypeId: payload.relationTypeId });
        const relationType = relationTypeById.get(payload.relationTypeId)!;
        assertEntityType(source, relationType, 'source'); assertEntityType(target, relationType, 'target');
        const validToTick = payload.validToTick === undefined ? undefined : parseEffectTick(payload.validToTick, 'validToTick');
        if (validToTick !== undefined && validToTick <= event.startTick) throw new DomainError('VALIDATION_ERROR', 'Relation effect range must be non-empty', { effectId: effect.id });
        const next: Relation = { id: effect.id, worldId: event.worldId, branchId: event.branchId ?? DEFAULT_BRANCH_ID, sourceEntityId: relationType.symmetric && source.id > target.id ? target.id : source.id, targetEntityId: relationType.symmetric && source.id > target.id ? source.id : target.id, relationTypeId: relationType.id, validFromTick: event.startTick, ...(validToTick === undefined ? {} : { validToTick }), description: typeof payload.description === 'string' ? payload.description : '', canonStatus: 'canon', sourceKind: 'event', sourceRefId: event.id, createdRevision: revision, revisionFrom: revision, revisionTo: null };
        relations.push(next); relationById.set(next.id, next);
        break;
      }
      case 'CREATE_ENTITY': {
        effectIdAvailable(effect.id);
        const id = typeof payload.id === 'string' && payload.id ? payload.id : effect.id;
        effectIdAvailable(id);
        const previousEntity = entityById.get(id);
        if (previousEntity && !isRetconnedProjection(previousEntity, event.id)) throw new DomainError('VALIDATION_ERROR', 'CREATE_ENTITY id already exists', { entityId: id });
        if (typeof payload.typeId !== 'string' || !entityTypeById.has(payload.typeId)) throw new DomainError('VALIDATION_ERROR', 'CREATE_ENTITY type does not exist', { typeId: payload.typeId });
        const entityType = entityTypeById.get(payload.typeId)!;
        const entity: Entity = { id, worldId: event.worldId, typeId: payload.typeId, schemaVersion: entityType.schemaVersion, name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : (() => { throw new DomainError('VALIDATION_ERROR', 'CREATE_ENTITY name is required', { effectId: effect.id }); })(), subtitle: typeof payload.subtitle === 'string' ? payload.subtitle : '', parentEntityId: payload.parentEntityId === undefined || payload.parentEntityId === null ? null : (requireCanonEntity(payload.parentEntityId, 'CREATE_ENTITY parent').id), document: isRecord(payload.document) ? structuredClone(payload.document) : {}, documentText: typeof payload.documentText === 'string' ? payload.documentText : '', tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : [], canonStatus: 'canon', revision, createdRevision: revision, canonRevision: revision, sourceKind: 'event', sourceRefId: event.id, createdAt: now, updatedAt: now };
        if (previousEntity) {
          const previousIndex = entities.findIndex((candidate) => candidate.id === id);
          if (previousIndex >= 0) entities[previousIndex] = entity;
          else entities.push(entity);
        } else entities.push(entity);
        entityById.set(entity.id, entity); entityIds.add(entity.id); entityTypeByEntityId.set(entity.id, entity.typeId);
        validateEntityDocumentOrThrow(entity);
        break;
      }
      case 'ARCHIVE_ENTITY': {
        const entity = requireCanonEntity(effect.targetId, 'Archive target');
        captureEntity(entity.id);
        entity.canonStatus = 'archived'; entity.revision = revision; entity.sourceKind = 'event'; entity.sourceRefId = event.id; entity.updatedAt = now;
        break;
      }
      case 'MOVE_ENTITY': {
        const entity = requireCanonEntity(effect.targetId, 'Move target');
        const location = requireCanonEntity(payload.locationEntityId, 'Move location');
        effectIdAvailable(effect.id);
        let alreadyAtLocation = false;
        for (const fact of facts) if (fact.subjectEntityId === entity.id && fact.predicateKey === 'location' && fact.objectKind === 'entity') {
          const active = (fact.validFromTick === undefined || fact.validFromTick <= event.startTick) && (fact.validToTick === undefined || fact.validToTick > event.startTick);
          if (active && fact.objectEntityId === location.id) alreadyAtLocation = true;
          else if (active) { captureFact(fact.id); endFact(fact); }
        }
        if (!alreadyAtLocation) {
          const next: Fact = { id: effect.id, worldId: event.worldId, branchId: event.branchId ?? DEFAULT_BRANCH_ID, subjectEntityId: entity.id, predicateKey: 'location', objectKind: 'entity', objectEntityId: location.id, value: null, validFromTick: event.startTick, canonStatus: 'canon', sourceKind: 'event', sourceRefId: event.id, createdRevision: revision, revisionFrom: revision, revisionTo: null };
          facts.push(next); factById.set(next.id, next);
        }
        break;
      }
      case 'CHANGE_GEOMETRY': {
        const current = requireMapFeature(effect.targetId);
        if (current.entityId !== undefined) requireCanonEntity(current.entityId, 'Geometry entity');
        assertActiveAtEvent(current.validFromTick, current.validToTick, 'Map feature');
        effectIdAvailable(effect.id);
        captureMapFeature(current.id);
        if (!isRecord(payload.geometry)) throw new DomainError('VALIDATION_ERROR', 'CHANGE_GEOMETRY geometry is required', { effectId: effect.id });
        const validToTick = payload.validToTick === undefined ? current.validToTick : parseEffectTick(payload.validToTick, 'validToTick');
        if (validToTick !== undefined && validToTick <= event.startTick) throw new DomainError('VALIDATION_ERROR', 'Geometry effect range must be non-empty', { effectId: effect.id });
        current.validToTick = event.startTick;
        const next: MapFeature = {
          id: effect.id,
          worldId: event.worldId,
          branchId: event.branchId ?? DEFAULT_BRANCH_ID,
          mapId: current.mapId,
          ...(current.layerId === undefined ? {} : { layerId: current.layerId }),
          ...(current.entityId === undefined ? {} : { entityId: current.entityId }),
          kind: current.kind,
          geometry: structuredClone(payload.geometry),
          properties: isRecord(payload.properties) ? structuredClone(payload.properties) : structuredClone(current.properties),
          validFromTick: event.startTick,
          ...(validToTick === undefined ? {} : { validToTick }),
          sourceKind: 'event',
          sourceRefId: event.id,
          createdRevision: revision,
          revisionFrom: revision,
          revisionTo: null,
          createdAt: now,
          updatedAt: now,
        };
        mapFeatures.push(next); mapFeatureById.set(next.id, next);
        break;
      }
      case 'SET_STATUS': {
        const entity = requireCanonEntity(effect.targetId, 'Status target');
        if (typeof payload.status !== 'string' || !payload.status.trim()) throw new DomainError('VALIDATION_ERROR', 'SET_STATUS status is required', { effectId: effect.id });
        captureEntity(entity.id);
        entity.document = { ...entity.document, status: payload.status }; validateEntityDocumentOrThrow(entity); entity.revision = revision; entity.sourceKind = 'event'; entity.sourceRefId = event.id; entity.updatedAt = now;
        break;
      }
      default: {
        const unsupported: never = effect.type;
        throw new DomainError('VALIDATION_ERROR', 'Unsupported event effect', { effectType: unsupported });
      }
    }
  }
  return {
    entities,
    entityTypes,
    facts,
    relations,
    relationTypes,
    mapFeatures,
    undo: {
      entities: [...undoEntities.values()],
      facts: [...undoFacts.values()],
      relations: [...undoRelations.values()],
      mapFeatures: [...undoMapFeatures.values()],
    },
  };
}

function isRetconnedProjection(value: { sourceRefId?: string; canonStatus?: string; retconnedRevision?: bigint }, eventId: string): boolean {
  return value.sourceRefId === eventId && (value.canonStatus === 'retconned' || value.retconnedRevision !== undefined);
}

function parseEffectTick(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new DomainError('VALIDATION_ERROR', `Event effect ${field} must be an integer`, { field });
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function cloneEntity(entity: Entity): Entity { return { ...entity, document: structuredClone(entity.document), tags: [...entity.tags] }; }
function cloneFact(fact: Fact): Fact { return { ...fact, ...(fact.value && typeof fact.value === 'object' ? { value: structuredClone(fact.value) } : {}) }; }
function cloneRelation(relation: Relation): Relation { return { ...relation }; }
function cloneMapFeature(feature: MapFeature): MapFeature { return { ...feature, geometry: structuredClone(feature.geometry), properties: structuredClone(feature.properties) }; }

function assertNoParentCycle(entityId: string, parentId: string, entities: Map<string, Entity>): void {
  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === entityId || visited.has(cursor)) throw new DomainError('VALIDATION_ERROR', 'Entity parent cycle detected', { entityId, parentId });
    visited.add(cursor);
    cursor = entities.get(cursor)?.parentEntityId ?? null;
  }
}
