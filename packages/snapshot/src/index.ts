import { DEFAULT_BRANCH_ID, DomainError, temporalIdentityField, type Entity, type Fact, type MapFeature, type Relation, type RelationType, type World, type WorldEvent } from '@world-codex/domain';

export interface SnapshotRelation extends Relation { sourceName: string; targetName: string; relationLabel: string; }
export interface WorldSnapshot {
  worldId: string;
  tick: bigint;
  asOfRevision?: bigint;
  branchId?: string;
  entities: Entity[];
  facts: Fact[];
  relations: SnapshotRelation[];
  mapFeatures: MapFeature[];
  activeEvents: WorldEvent[];
}

export interface ComputeSnapshotOptions {
  asOfRevision?: bigint;
  branchId?: string;
}

const active = (from: bigint | undefined, to: bigint | undefined, tick: bigint): boolean => (from === undefined || tick >= from) && (to === undefined || tick < to);

const isVisibleAtRevision = (
  created: bigint | undefined,
  retconned: bigint | undefined,
  from: bigint | undefined,
  to: bigint | null | undefined,
  asOf: bigint,
): boolean => {
  const effectiveFrom = from ?? created ?? 1n;
  if (effectiveFrom > asOf) return false;
  const effectiveTo = to !== undefined && to !== null ? to : retconned;
  if (effectiveTo !== undefined && effectiveTo !== null && effectiveTo <= asOf) return false;
  return true;
};

const matchesBranch = (itemBranch: string | undefined, targetBranch: string): boolean => {
  const itemB = itemBranch || DEFAULT_BRANCH_ID;
  const targetB = targetBranch || DEFAULT_BRANCH_ID;
  return itemB === targetB || (targetB === 'main' && itemB === DEFAULT_BRANCH_ID) || (targetB === DEFAULT_BRANCH_ID && itemB === 'main');
};

export function computeSnapshot(
  world: World,
  tick: bigint,
  entities: Entity[],
  facts: Fact[],
  relations: Relation[],
  relationTypes: RelationType[],
  events: WorldEvent[],
  mapFeatures: MapFeature[] = [],
  options?: ComputeSnapshotOptions,
): WorldSnapshot {
  const asOf = options?.asOfRevision ?? world.revision;
  const branch = options?.branchId ?? DEFAULT_BRANCH_ID;
  const entityMap = new Map(entities.filter((entity) => (entity.canonStatus === 'canon' || entity.canonStatus === 'pending') && isEntityVisibleAtRevision(entity, asOf)).map((entity) => [entity.id, cloneEntity(entity)]));
  const factMap = new Map(facts.filter((fact) => fact.canonStatus !== 'draft' && isVisibleAtRevision(fact.createdRevision, fact.retconnedRevision, fact.revisionFrom, fact.revisionTo, asOf)).map((fact) => [fact.id, cloneFact(fact)]));
  const relationMap = new Map(relations.filter((relation) => relation.canonStatus !== 'draft' && isVisibleAtRevision(relation.createdRevision, relation.retconnedRevision, relation.revisionFrom, relation.revisionTo, asOf)).map((relation) => [relation.id, { ...relation }]));
  const mapFeatureMap = new Map(mapFeatures.map((feature) => [feature.id, { ...feature, geometry: structuredClone(feature.geometry), properties: structuredClone(feature.properties) }]));
  const archivedEntities = new Set<string>();
  const endedFacts = new Map<string, bigint>();
  const endedRelations = new Map<string, bigint>();
  const typeMap = new Map(relationTypes.map((type) => [type.id, type]));
  const canonicalEvents = events
    .filter((event) => isCanonEventAtRevision(event, asOf) && event.startTick <= tick && matchesBranch(event.branchId, branch))
    .sort((left, right) => left.startTick === right.startTick ? left.id.localeCompare(right.id) : left.startTick < right.startTick ? -1 : 1);
  for (const event of canonicalEvents) {
    for (const effect of [...event.effects].sort((left, right) => left.sequence === right.sequence ? left.id.localeCompare(right.id) : left.sequence - right.sequence)) {
      const targetId = effect.targetId;
      if (effect.type === 'END_FACT' && targetId && factMap.has(targetId)) endedFacts.set(targetId, minRequiredTick(endedFacts.get(targetId), event.startTick));
      if ((effect.type === 'END_RELATION' || effect.type === 'REMOVE_RELATION') && targetId && relationMap.has(targetId)) endedRelations.set(targetId, minRequiredTick(endedRelations.get(targetId), event.startTick));
      if (effect.type === 'ARCHIVE_ENTITY' && targetId && entityMap.has(targetId)) archivedEntities.add(targetId);
      if ((effect.type === 'SET_FACT' || effect.type === 'SET_FIELD') && targetId && factMap.has(targetId)) {
        // Canon promotion materializes the replacement fact using the effect id.
        // Do not project it a second time when the repository already contains
        // that derived record; this keeps snapshots idempotent across storage
        // and pure-projection paths.
        if (factMap.has(effect.id)) continue;
        const current = factMap.get(targetId)!;
        const payload = effect.payload;
        const hasObjectKind = typeof payload.objectKind === 'string' && ['scalar', 'entity', 'json'].includes(payload.objectKind);
        const objectKind = hasObjectKind ? payload.objectKind as Fact['objectKind'] : current.objectKind;
        const nextObjectEntityId = objectKind === 'entity'
          ? (typeof payload.objectEntityId === 'string' ? payload.objectEntityId : hasObjectKind ? undefined : current.objectEntityId)
          : undefined;
        const previousValidTo = current.validToTick;
        if (current.validToTick === undefined || current.validToTick > event.startTick) current.validToTick = event.startTick;
        const syntheticId = `effect:${effect.id}`;
        const next = {
          ...current,
          id: syntheticId,
          ...(payload.value === undefined ? {} : { value: payload.value }),
          objectKind,
          validFromTick: event.startTick,
          ...(previousValidTo === undefined ? {} : { validToTick: previousValidTo }),
          canonStatus: 'canon' as const,
          sourceKind: 'event' as const,
          sourceRefId: event.id,
          ...(event.createdRevision === undefined ? {} : { createdRevision: event.createdRevision }),
        };
        if (nextObjectEntityId === undefined) delete next.objectEntityId;
        else next.objectEntityId = nextObjectEntityId;
        factMap.set(syntheticId, next);
      }
      if (effect.type === 'SET_FIELD' && targetId && entityMap.has(targetId) && typeof effect.payload.field === 'string' && effect.payload.field.trim()) {
         const current = entityMap.get(targetId)!;
        const document = { ...current.document, [effect.payload.field]: structuredClone(effect.payload.value) };
         const next = applyIdentityField({ ...current, document, documentText: documentText(document), revision: event.canonRevision ?? event.createdRevision ?? current.revision, updatedAt: world.updatedAt }, effect.payload.field, effect.payload.value);
         if (next.parentEntityId) assertNoParentCycle(next.id, next.parentEntityId, entityMap);
         entityMap.set(targetId, next);
      }
      if (effect.type === 'ADD_FACT' && !factMap.has(effect.id)) {
        const payload = effect.payload;
        const objectKind = payload.objectKind;
        if (typeof payload.subjectEntityId === 'string' && typeof payload.predicateKey === 'string' && (objectKind === 'scalar' || objectKind === 'entity' || objectKind === 'json')) {
          const objectEntityId = objectKind === 'entity' && typeof payload.objectEntityId === 'string' ? payload.objectEntityId : undefined;
          const validToTick = parseProjectionTick(payload.validToTick);
          const syntheticId = `effect:${effect.id}`;
          factMap.set(syntheticId, { id: syntheticId, worldId: world.id, subjectEntityId: payload.subjectEntityId, predicateKey: payload.predicateKey, objectKind, value: objectKind === 'entity' ? null : (payload.value ?? null), ...(objectEntityId === undefined ? {} : { objectEntityId }), validFromTick: event.startTick, ...(validToTick === undefined ? {} : { validToTick }), canonStatus: 'canon', sourceKind: 'event', sourceRefId: event.id, ...(event.createdRevision === undefined ? {} : { createdRevision: event.createdRevision }) });
        }
      }
      if (effect.type === 'MOVE_ENTITY' && targetId && entityMap.has(targetId) && typeof effect.payload.locationEntityId === 'string') {
        if (factMap.has(effect.id)) continue;
        for (const fact of factMap.values()) {
          if (fact.subjectEntityId !== targetId || fact.predicateKey !== 'location') continue;
          if (fact.validFromTick !== undefined && fact.validFromTick > event.startTick) continue;
          if (fact.validToTick !== undefined && fact.validToTick <= event.startTick) continue;
          endedFacts.set(fact.id, minRequiredTick(endedFacts.get(fact.id), event.startTick));
        }
        const syntheticId = `effect:${effect.id}`;
        factMap.set(syntheticId, { id: syntheticId, worldId: world.id, subjectEntityId: targetId, predicateKey: 'location', objectKind: 'entity', objectEntityId: effect.payload.locationEntityId, value: null, validFromTick: event.startTick, canonStatus: 'canon', sourceKind: 'event', sourceRefId: event.id, ...(event.createdRevision === undefined ? {} : { createdRevision: event.createdRevision }) });
      }
      if (effect.type === 'ADD_RELATION') {
        if (relationMap.has(effect.id)) continue;
        const payload = effect.payload;
        if (typeof payload.sourceEntityId === 'string' && typeof payload.targetEntityId === 'string' && typeof payload.relationTypeId === 'string') {
          const syntheticId = `effect:${effect.id}`;
          const symmetric = typeMap.get(payload.relationTypeId)?.symmetric === true;
          const [sourceEntityId, targetEntityId] = symmetric && payload.sourceEntityId > payload.targetEntityId ? [payload.targetEntityId, payload.sourceEntityId] : [payload.sourceEntityId, payload.targetEntityId];
          const validToTick = parseProjectionTick(payload.validToTick);
          if (!relationMap.has(syntheticId)) relationMap.set(syntheticId, { id: syntheticId, worldId: world.id, sourceEntityId, targetEntityId, relationTypeId: payload.relationTypeId, ...(typeof payload.description === 'string' ? { description: payload.description } : { description: '' }), validFromTick: event.startTick, ...(validToTick === undefined ? {} : { validToTick }), canonStatus: 'canon', sourceKind: 'event', sourceRefId: event.id, ...(event.createdRevision === undefined ? {} : { createdRevision: event.createdRevision }) });
        }
      }
      if (effect.type === 'CREATE_ENTITY') {
        const payload = effect.payload;
        const entityId = typeof payload.id === 'string' && payload.id ? payload.id : effect.id;
        if (typeof payload.typeId === 'string' && typeof payload.name === 'string' && !entityMap.has(entityId)) entityMap.set(entityId, { id: entityId, worldId: world.id, typeId: payload.typeId, ...(typeof payload.schemaVersion === 'number' && Number.isInteger(payload.schemaVersion) ? { schemaVersion: payload.schemaVersion } : {}), name: payload.name, subtitle: typeof payload.subtitle === 'string' ? payload.subtitle : '', parentEntityId: typeof payload.parentEntityId === 'string' ? payload.parentEntityId : null, document: isRecord(payload.document) ? payload.document : {}, documentText: typeof payload.documentText === 'string' ? payload.documentText : '', tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : [], canonStatus: 'canon', revision: event.createdRevision ?? world.revision, createdAt: world.updatedAt, updatedAt: world.updatedAt });
      }
      if (effect.type === 'SET_STATUS' && targetId && entityMap.has(targetId) && typeof effect.payload.status === 'string') {
        const current = entityMap.get(targetId)!;
        const document = { ...current.document, status: effect.payload.status };
        entityMap.set(targetId, { ...current, document, documentText: documentText(document) });
      }
      if (effect.type === 'CHANGE_GEOMETRY' && targetId && mapFeatureMap.has(targetId) && isRecord(effect.payload.geometry)) {
        if (mapFeatureMap.has(effect.id)) continue;
        const current = mapFeatureMap.get(targetId)!;
        const previousValidTo = current.validToTick;
        if (current.validToTick === undefined || current.validToTick > event.startTick) current.validToTick = event.startTick;
        const validToTick = parseProjectionTick(effect.payload.validToTick) ?? previousValidTo;
        const derivedId = `effect:${effect.id}`;
        mapFeatureMap.set(derivedId, {
          id: derivedId,
          worldId: world.id,
          mapId: current.mapId,
          ...(current.entityId === undefined ? {} : { entityId: current.entityId }),
          kind: current.kind,
          geometry: structuredClone(effect.payload.geometry),
          properties: isRecord(effect.payload.properties) ? structuredClone(effect.payload.properties) : structuredClone(current.properties),
          validFromTick: event.startTick,
          ...(validToTick === undefined ? {} : { validToTick }),
          sourceKind: 'event',
          sourceRefId: event.id,
          ...(event.createdRevision === undefined ? {} : { createdRevision: event.createdRevision }),
          createdAt: world.updatedAt,
          updatedAt: world.updatedAt,
        });
      }
    }
  }
  let entitiesAtTick = [...entityMap.values()].filter((entity) => !archivedEntities.has(entity.id));
  const visibleEntityIds = new Set(entitiesAtTick.map((entity) => entity.id));
  const factsAtTick = [...factMap.values()].filter((fact) => (
    fact.canonStatus !== 'draft' &&
    active(fact.validFromTick, minTick(fact.validToTick, endedFacts.get(fact.id)), tick) &&
    isVisibleAtRevision(fact.createdRevision, fact.retconnedRevision, fact.revisionFrom, fact.revisionTo, asOf) &&
    matchesBranch(fact.branchId, branch) &&
    visibleEntityIds.has(fact.subjectEntityId) &&
    (fact.objectKind !== 'entity' || (fact.objectEntityId && visibleEntityIds.has(fact.objectEntityId)))
  ));
  entitiesAtTick = entitiesAtTick.map((entity) => projectTemporalIdentity(entity, factsAtTick));
  const projectedEntities = new Map(entitiesAtTick.map((entity) => [entity.id, entity]));
  const relationsAtTick = [...relationMap.values()].filter((relation) => (
    relation.canonStatus !== 'draft' &&
    active(relation.validFromTick, minTick(relation.validToTick, endedRelations.get(relation.id)), tick) &&
    isVisibleAtRevision(relation.createdRevision, relation.retconnedRevision, relation.revisionFrom, relation.revisionTo, asOf) &&
    matchesBranch(relation.branchId, branch) &&
    visibleEntityIds.has(relation.sourceEntityId) &&
    visibleEntityIds.has(relation.targetEntityId)
  )).map((relation) => ({ ...relation, sourceName: projectedEntities.get(relation.sourceEntityId)?.name ?? '', targetName: projectedEntities.get(relation.targetEntityId)?.name ?? '', relationLabel: typeMap.get(relation.relationTypeId)?.forwardLabel ?? 'related' }));
  const mapFeaturesAtTick = [...mapFeatureMap.values()].filter((feature) => (
    active(feature.validFromTick, feature.validToTick, tick) &&
    isVisibleAtRevision(feature.createdRevision, feature.retconnedRevision, feature.revisionFrom, feature.revisionTo, asOf) &&
    matchesBranch(feature.branchId, branch)
  ));
  const activeEvents = events.filter((event) => (
    isEventVisibleAtRevision(event, asOf) &&
    event.startTick <= tick &&
    (event.endTick === undefined || tick <= event.endTick) &&
    (event.createdRevision === undefined || event.createdRevision <= asOf) &&
    matchesBranch(event.branchId, branch)
  ));
  return { worldId: world.id, tick, asOfRevision: asOf, branchId: branch, entities: entitiesAtTick, facts: factsAtTick, relations: relationsAtTick, mapFeatures: mapFeaturesAtTick, activeEvents };
}

function minTick(left: bigint | undefined, right: bigint | undefined): bigint | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left < right ? left : right;
}

function documentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(documentText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(documentText).filter(Boolean).join(' ');
  return '';
}

function minRequiredTick(left: bigint | undefined, right: bigint): bigint {
  return left === undefined || right < left ? right : left;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseProjectionTick(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function cloneFact(fact: Fact): Fact {
  return { ...fact, ...(fact.value && typeof fact.value === 'object' ? { value: structuredClone(fact.value) } : {}) };
}

function cloneEntity(entity: Entity): Entity {
  return { ...entity, document: structuredClone(entity.document), tags: [...entity.tags] };
}

function isEntityVisibleAtRevision(entity: Entity, asOf: bigint): boolean {
  if (entity.createdRevision !== undefined && entity.createdRevision > asOf) return false;
  if (entity.retconnedRevision !== undefined && entity.retconnedRevision <= asOf) return false;
  if (entity.canonStatus === 'pending') return entity.pendingRevision === undefined || entity.pendingRevision <= asOf;
  if (entity.canonStatus === 'canon') return entity.canonRevision === undefined || entity.canonRevision <= asOf;
  return false;
}

function isCanonEventAtRevision(event: WorldEvent, asOf: bigint): boolean {
  if (event.canonStatus !== 'canon' && event.canonStatus !== 'retconned') return false;
  if (event.createdRevision !== undefined && event.createdRevision > asOf) return false;
  const canonRevision = event.canonRevision ?? event.createdRevision;
  if (canonRevision !== undefined && canonRevision > asOf) return false;
  return event.retconnedRevision === undefined || event.retconnedRevision > asOf;
}

function isEventVisibleAtRevision(event: WorldEvent, asOf: bigint): boolean {
  if (event.createdRevision !== undefined && event.createdRevision > asOf) return false;
  if (event.canonStatus === 'pending') return event.pendingRevision === undefined || event.pendingRevision <= asOf;
  return isCanonEventAtRevision(event, asOf);
}

function applyIdentityField(entity: Entity, field: string, value: unknown): Entity {
  const identity = temporalIdentityField(field);
  if (identity === 'name' && typeof value === 'string') return { ...entity, name: value };
  if (identity === 'subtitle' && typeof value === 'string') return { ...entity, subtitle: value };
  if (identity === 'parentEntityId') {
    if (value === null || value === undefined) return { ...entity, parentEntityId: null };
    if (typeof value === 'string') return { ...entity, parentEntityId: value };
  }
  return entity;
}

function projectTemporalIdentity(entity: Entity, facts: Fact[]): Entity {
  let next = entity;
  for (const fact of facts) {
    if (fact.subjectEntityId !== entity.id) continue;
    const identity = temporalIdentityField(fact.predicateKey);
    if (!identity) continue;
    if (identity === 'parentEntityId') next = applyIdentityField(next, fact.predicateKey, fact.objectKind === 'entity' ? fact.objectEntityId ?? null : fact.value);
    else next = applyIdentityField(next, fact.predicateKey, fact.value);
  }
  return next;
}

function assertNoParentCycle(entityId: string, parentId: string, entities: Map<string, Entity>): void {
  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === entityId || visited.has(cursor)) throw new DomainError('INTERNAL_ERROR', 'Snapshot contains an entity parent cycle', { entityId, parentId });
    visited.add(cursor);
    cursor = entities.get(cursor)?.parentEntityId ?? null;
  }
}
