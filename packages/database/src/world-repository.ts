import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_BRANCH_ID,
  DEFAULT_BRANCH_NAME,
  DEFAULT_ENTITY_TYPES,
  DomainError,
  type Asset,
  type CreateEntityInput,
  type CreateEntityTypeInput,
  type CreateWorldInput,
  type Entity,
  type EntityType,
  type EntityTypeVersion,
  type EventEffect,
  type Fact,
  type MapFeature,
  type MapLayer,
  type Relation,
  type RelationType,
  type TimelineBranch,
  type TimelineBranchStatus,
  type World,
  type WorldMap,
  type WorldEvent,
  type Claim,
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
  type CreatePlotlineInput,
  type UpdatePlotlineInput,
  type Plotline,
  type CreateForeshadowingInput,
  type UpdateForeshadowingInput,
  type Foreshadowing,
} from '@world-codex/domain';
import type { CalendarDefinition } from '@world-codex/calendar';
import type { CalendarRecord, CalendarVersionRecord, CanonStatusChange, CanonTarget, CanonTargetKind, ChangeRecord, CreateClaimInput, CreateEventInput, CreateFactInput, CreateRelationInput, IdempotencyClaim, IdempotencyRecord, IdempotencyRepository, ProposalRecord, ProposalRepository, RevisionRecord, SearchResult, TemporalRepository, WorldRepository } from '@world-codex/application';
import { materializeEventEffects, type EventMaterializationUndo } from '@world-codex/application';

type Row = Record<string, unknown>;

function worldFromRow(row: Row): World {
  return {
    id: String(row.id), ownerId: row.owner_id ? String(row.owner_id) : null, name: String(row.name), slug: String(row.slug),
    description: String(row.description), genre: String(row.genre), canonStrategy: row.canon_strategy as World['canonStrategy'],
    defaultCalendarVersionId: row.default_calendar_version_id ? String(row.default_calendar_version_id) : null,
    currentTick: BigInt(row.current_tick as string | number | bigint), revision: BigInt(row.revision_seq as string | number | bigint),
    createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)), archivedAt: row.archived_at ? new Date(String(row.archived_at)) : null,
  };
}

function entityFromRow(row: Row): Entity {
  return {
    id: String(row.id), worldId: String(row.world_id), typeId: String(row.type_id), ...(row.schema_version === undefined || row.schema_version === null ? {} : { schemaVersion: Number(row.schema_version) }), name: String(row.name), subtitle: String(row.subtitle),
    parentEntityId: row.parent_entity_id ? String(row.parent_entity_id) : null, document: (row.document_json ?? {}) as Record<string, unknown>,
    documentText: String(row.document_text), tags: (row.tags ?? []) as string[], canonStatus: row.canon_status as Entity['canonStatus'],
    revision: BigInt(row.revision as string | number | bigint),
    ...(row.created_revision !== undefined && row.created_revision !== null ? { createdRevision: BigInt(row.created_revision as string | number | bigint) } : {}),
    ...(row.pending_revision !== undefined && row.pending_revision !== null ? { pendingRevision: BigInt(row.pending_revision as string | number | bigint) } : {}),
    ...(row.canon_revision !== undefined && row.canon_revision !== null ? { canonRevision: BigInt(row.canon_revision as string | number | bigint) } : {}),
    ...(row.retconned_revision !== undefined && row.retconned_revision !== null ? { retconnedRevision: BigInt(row.retconned_revision as string | number | bigint) } : {}),
    ...(row.source_kind ? { sourceKind: row.source_kind as NonNullable<Entity['sourceKind']> } : {}),
    ...(row.source_ref_id ? { sourceRefId: String(row.source_ref_id) } : {}),
    createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  };
}

function entityTypeFromRow(row: Row): EntityType {
  return {
    id: String(row.id), worldId: String(row.world_id), typeKey: String(row.type_key), label: String(row.label), schemaVersion: Number(row.schema_version),
    schema: (row.schema_json ?? {}) as Record<string, unknown>, createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  };
}

function entityTypeVersionFromRow(row: Row): EntityTypeVersion {
  return { id: String(row.id), worldId: String(row.world_id), entityTypeId: String(row.entity_type_id), schemaVersion: Number(row.schema_version), schema: (row.schema_json ?? {}) as Record<string, unknown>, createdRevision: BigInt(row.created_revision as string | number | bigint), createdAt: new Date(String(row.created_at)) };
}

function rangeFromRow(row: Row): { validFromTick?: bigint; validToTick?: bigint } {
  const text = String(row.valid_range_text ?? row.valid_range ?? '[,)');
  const match = text.match(/^[[(]([^,]*),([^\)\]]*)[)\]]$/);
  if (!match) throw new DomainError('INTERNAL_ERROR', 'Invalid temporal range returned by database', { range: text });
  const [, from, to] = match;
  return { ...(from ? { validFromTick: BigInt(from) } : {}), ...(to ? { validToTick: BigInt(to) } : {}) };
}

function temporalRange(from: bigint | undefined, to: bigint | undefined): string {
  return `[${from === undefined ? '' : from.toString()},${to === undefined ? '' : to.toString()})`;
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? `${nested}n` : nested) ?? 'null';
}

function reviveStoredJson(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+n$/.test(value)) return BigInt(value.slice(0, -1));
  if (Array.isArray(value)) return value.map(reviveStoredJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, reviveStoredJson(nested)]));
  return value;
}

function storedBigInt(value: unknown): bigint | undefined {
  const revived = reviveStoredJson(value);
  if (revived === undefined || revived === null) return undefined;
  if (typeof revived === 'bigint') return revived;
  if (typeof revived === 'number' && Number.isSafeInteger(revived)) return BigInt(revived);
  if (typeof revived === 'string' && /^-?\d+$/.test(revived)) return BigInt(revived);
  return undefined;
}

function calendarJson(definition: CalendarDefinition): string {
  return JSON.stringify(definition, (_key, nested) => typeof nested === 'bigint' ? nested.toString() : nested) ?? '{}';
}

function calendarBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string') return BigInt(value.endsWith('n') ? value.slice(0, -1) : value);
  throw new DomainError('INTERNAL_ERROR', 'Invalid calendar tick stored in database');
}

function calendarDefinitionFromJson(value: unknown): CalendarDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INTERNAL_ERROR', 'Invalid calendar definition stored in database');
  const raw = value as Record<string, unknown>;
  const eras = Array.isArray(raw.eras) ? raw.eras.map((era) => {
    if (!era || typeof era !== 'object' || Array.isArray(era)) throw new DomainError('INTERNAL_ERROR', 'Invalid calendar era stored in database');
    const item = era as Record<string, unknown>;
    return { id: String(item.id), name: String(item.name), abbreviation: String(item.abbreviation), startTick: calendarBigInt(item.startTick), ...(item.endTick === undefined ? {} : { endTick: calendarBigInt(item.endTick) }) };
  }) : [];
  const months = Array.isArray(raw.months) ? raw.months.map((month) => {
    const item = month as Record<string, unknown>;
    return { id: String(item.id), name: String(item.name), days: Number(item.days) };
  }) : [];
  const leap = raw.leapRule && typeof raw.leapRule === 'object' ? raw.leapRule as Record<string, unknown> : undefined;
  return { id: String(raw.id), name: String(raw.name), yearZero: Number(raw.yearZero), daysPerWeek: Number(raw.daysPerWeek), weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.map(String) : [], months, eras, ...(leap === undefined ? {} : { leapRule: { everyYears: Number(leap.everyYears), extraDays: Number(leap.extraDays), ...(leap.monthId === undefined ? {} : { monthId: String(leap.monthId) }) } }) };
}

function calendarFromRow(row: Row): CalendarRecord {
  return { id: String(row.id), worldId: String(row.world_id), name: String(row.name), currentVersion: Number(row.current_version), createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)) };
}

function calendarVersionFromRow(row: Row): CalendarVersionRecord {
  return { id: String(row.id), worldId: String(row.world_id), calendarId: String(row.calendar_id), version: Number(row.version), definition: calendarDefinitionFromJson(row.definition_json), createdRevision: BigInt(row.created_revision as string | number | bigint), createdAt: new Date(String(row.created_at)) };
}

function factFromRow(row: Row): Fact {
  return {
    id: String(row.id), worldId: String(row.world_id), branchId: row.branch_id ? String(row.branch_id) : DEFAULT_BRANCH_ID, subjectEntityId: String(row.subject_entity_id), predicateKey: String(row.predicate_key),
    objectKind: row.object_kind as Fact['objectKind'], value: row.object_kind === 'entity' ? null : row.value_json,
    ...(row.object_entity_id ? { objectEntityId: String(row.object_entity_id) } : {}), ...rangeFromRow(row),
    ...(row.source_ref_id ? { sourceRefId: String(row.source_ref_id) } : {}),
    ...(row.created_revision === undefined || row.created_revision === null ? {} : { createdRevision: BigInt(row.created_revision as string | number | bigint) }),
    ...(row.pending_revision !== undefined && row.pending_revision !== null ? { pendingRevision: BigInt(row.pending_revision as string | number | bigint) } : {}),
    ...(row.canon_revision !== undefined && row.canon_revision !== null ? { canonRevision: BigInt(row.canon_revision as string | number | bigint) } : {}),
    ...(row.retconned_revision === undefined || row.retconned_revision === null ? {} : { retconnedRevision: BigInt(row.retconned_revision as string | number | bigint) }),
    ...(row.revision_from !== undefined && row.revision_from !== null ? { revisionFrom: BigInt(row.revision_from as string | number | bigint) } : row.created_revision !== undefined && row.created_revision !== null ? { revisionFrom: BigInt(row.created_revision as string | number | bigint) } : {}),
    ...(row.revision_to !== undefined && row.revision_to !== null ? { revisionTo: BigInt(row.revision_to as string | number | bigint) } : row.retconned_revision !== undefined && row.retconned_revision !== null ? { revisionTo: BigInt(row.retconned_revision as string | number | bigint) } : { revisionTo: null }),
    canonStatus: row.canon_status as Fact['canonStatus'], sourceKind: row.source_kind as Fact['sourceKind'],
  };
}

function relationTypeFromRow(row: Row): RelationType {
  return {
    id: String(row.id), worldId: String(row.world_id), forwardLabel: String(row.forward_label), inverseLabel: String(row.inverse_label),
    symmetric: Boolean(row.symmetric), sourceTypeIds: (row.source_type_ids ?? []) as string[], targetTypeIds: (row.target_type_ids ?? []) as string[],
  };
}

function relationFromRow(row: Row): Relation {
  return {
    id: String(row.id), worldId: String(row.world_id), branchId: row.branch_id ? String(row.branch_id) : DEFAULT_BRANCH_ID, sourceEntityId: String(row.source_entity_id), targetEntityId: String(row.target_entity_id),
    relationTypeId: String(row.relation_type_id), ...rangeFromRow(row), description: String(row.description), canonStatus: row.canon_status as Relation['canonStatus'],
    ...(row.source_kind ? { sourceKind: row.source_kind as NonNullable<Relation['sourceKind']> } : {}),
    ...(row.source_ref_id ? { sourceRefId: String(row.source_ref_id) } : {}),
    ...(row.created_revision === undefined || row.created_revision === null ? {} : { createdRevision: BigInt(row.created_revision as string | number | bigint) }),
    ...(row.pending_revision !== undefined && row.pending_revision !== null ? { pendingRevision: BigInt(row.pending_revision as string | number | bigint) } : {}),
    ...(row.canon_revision !== undefined && row.canon_revision !== null ? { canonRevision: BigInt(row.canon_revision as string | number | bigint) } : {}),
    ...(row.retconned_revision === undefined || row.retconned_revision === null ? {} : { retconnedRevision: BigInt(row.retconned_revision as string | number | bigint) }),
    ...(row.revision_from !== undefined && row.revision_from !== null ? { revisionFrom: BigInt(row.revision_from as string | number | bigint) } : row.created_revision !== undefined && row.created_revision !== null ? { revisionFrom: BigInt(row.created_revision as string | number | bigint) } : {}),
    ...(row.revision_to !== undefined && row.revision_to !== null ? { revisionTo: BigInt(row.revision_to as string | number | bigint) } : row.retconned_revision !== undefined && row.retconned_revision !== null ? { revisionTo: BigInt(row.retconned_revision as string | number | bigint) } : { revisionTo: null }),
  };
}

function claimFromRow(row: Row): Claim {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    branchId: row.branch_id ? String(row.branch_id) : DEFAULT_BRANCH_ID,
    ...(row.subject_entity_id ? { subjectEntityId: String(row.subject_entity_id) } : {}),
    predicateKey: String(row.predicate_key),
    objectKind: row.object_kind as Claim['objectKind'],
    value: row.value,
    ...(row.object_entity_id ? { objectEntityId: String(row.object_entity_id) } : {}),
    ...(row.asserted_by_entity_id ? { assertedByEntityId: String(row.asserted_by_entity_id) } : {}),
    knownByEntityIds: Array.isArray(row.known_by_entity_ids) ? row.known_by_entity_ids.map(String) : [],
    ...(row.valid_from_tick !== null && row.valid_from_tick !== undefined ? { validFromTick: BigInt(row.valid_from_tick as string | number | bigint) } : {}),
    ...(row.valid_to_tick !== null && row.valid_to_tick !== undefined ? { validToTick: BigInt(row.valid_to_tick as string | number | bigint) } : {}),
    truthStatus: row.truth_status as Claim['truthStatus'],
    claimKind: row.claim_kind as Claim['claimKind'],
    ...(row.confidence !== null && row.confidence !== undefined ? { confidence: Number(row.confidence) } : {}),
    sourceRefs: Array.isArray(row.source_refs) ? row.source_refs.map(String) : [],
    canonStatus: row.canon_status as Claim['canonStatus'],
    createdRevision: BigInt(row.created_revision as string | number | bigint),
    ...(row.pending_revision !== null && row.pending_revision !== undefined ? { pendingRevision: BigInt(row.pending_revision as string | number | bigint) } : {}),
    ...(row.canon_revision !== null && row.canon_revision !== undefined ? { canonRevision: BigInt(row.canon_revision as string | number | bigint) } : {}),
    ...(row.retconned_revision !== null && row.retconned_revision !== undefined ? { retconnedRevision: BigInt(row.retconned_revision as string | number | bigint) } : {}),
    revisionFrom: BigInt(row.revision_from as string | number | bigint),
    ...(row.revision_to !== undefined ? { revisionTo: row.revision_to !== null ? BigInt(row.revision_to as string | number | bigint) : null } : {}),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapFromRow(row: Row): WorldMap {
  return { id: String(row.id), worldId: String(row.world_id), name: String(row.name), crs: String(row.crs), width: Number(row.width), height: Number(row.height), ...(row.asset_id ? { assetId: String(row.asset_id) } : {}), createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)) };
}

function mapLayerFromRow(row: Row): MapLayer {
  return { id: String(row.id), worldId: String(row.world_id), mapId: String(row.map_id), name: String(row.name), kind: row.kind as MapLayer['kind'], sortOrder: Number(row.sort_order), visible: Boolean(row.visible), opacity: Number(row.opacity), style: (row.style_json ?? {}) as Record<string, unknown>, createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)) };
}

function mapFeatureFromRow(row: Row): MapFeature {
  return {
    id: String(row.id), worldId: String(row.world_id), branchId: row.branch_id ? String(row.branch_id) : DEFAULT_BRANCH_ID, mapId: String(row.map_id), ...(row.layer_id ? { layerId: String(row.layer_id) } : {}), ...(row.entity_id ? { entityId: String(row.entity_id) } : {}), kind: row.kind as MapFeature['kind'], geometry: (row.geometry_json ?? {}) as Record<string, unknown>, properties: (row.properties_json ?? {}) as Record<string, unknown>, ...rangeFromRow(row),
    ...(row.source_kind ? { sourceKind: row.source_kind as NonNullable<MapFeature['sourceKind']> } : {}),
    ...(row.source_ref_id ? { sourceRefId: String(row.source_ref_id) } : {}),
    ...(row.created_revision === undefined || row.created_revision === null ? {} : { createdRevision: BigInt(row.created_revision as string | number | bigint) }),
    ...(row.pending_revision !== undefined && row.pending_revision !== null ? { pendingRevision: BigInt(row.pending_revision as string | number | bigint) } : {}),
    ...(row.canon_revision !== undefined && row.canon_revision !== null ? { canonRevision: BigInt(row.canon_revision as string | number | bigint) } : {}),
    ...(row.retconned_revision === undefined || row.retconned_revision === null ? {} : { retconnedRevision: BigInt(row.retconned_revision as string | number | bigint) }),
    ...(row.revision_from !== undefined && row.revision_from !== null ? { revisionFrom: BigInt(row.revision_from as string | number | bigint) } : row.created_revision !== undefined && row.created_revision !== null ? { revisionFrom: BigInt(row.created_revision as string | number | bigint) } : {}),
    ...(row.revision_to !== undefined && row.revision_to !== null ? { revisionTo: BigInt(row.revision_to as string | number | bigint) } : row.retconned_revision !== undefined && row.retconned_revision !== null ? { revisionTo: BigInt(row.retconned_revision as string | number | bigint) } : { revisionTo: null }),
    createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  };
}

function assetFromRow(row: Row): Asset {
  return { id: String(row.id), worldId: String(row.world_id), storageKey: String(row.storage_key), mediaType: String(row.media_type), byteSize: BigInt(row.byte_size as string | number | bigint), sha256: String(row.sha256), metadata: (row.metadata_json ?? {}) as Record<string, unknown>, scanStatus: row.scan_status as Asset['scanStatus'], scanMessage: String(row.scan_message ?? ''), createdAt: new Date(String(row.created_at)) };
}

function parseTemporalExpressionRow(raw: unknown): import('@world-codex/domain').TemporalExpression | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const te = raw as Record<string, unknown>;
  if (typeof te.kind !== 'string') return undefined;
  return {
    kind: te.kind as import('@world-codex/domain').TemporalExpression['kind'],
    ...(te.startTick !== undefined && te.startTick !== null ? { startTick: BigInt(te.startTick as string | number | bigint) } : {}),
    ...(te.endTick !== undefined && te.endTick !== null ? { endTick: BigInt(te.endTick as string | number | bigint) } : {}),
    ...(te.precision ? { precision: te.precision as import('@world-codex/domain').WorldDatePrecision } : {}),
    ...(te.relativeToEventId ? { relativeToEventId: String(te.relativeToEventId) } : {}),
    ...(te.relativeOffsetTicks !== undefined && te.relativeOffsetTicks !== null ? { relativeOffsetTicks: BigInt(te.relativeOffsetTicks as string | number | bigint) } : {}),
    ...(te.displayLabel ? { displayLabel: String(te.displayLabel) } : {}),
  };
}

function serializeTemporalExpression(te: import('@world-codex/domain').TemporalExpression | undefined): Record<string, unknown> | null {
  if (!te) return null;
  return {
    kind: te.kind,
    ...(te.startTick !== undefined ? { startTick: te.startTick.toString() } : {}),
    ...(te.endTick !== undefined ? { endTick: te.endTick.toString() } : {}),
    ...(te.precision !== undefined ? { precision: te.precision } : {}),
    ...(te.relativeToEventId !== undefined ? { relativeToEventId: te.relativeToEventId } : {}),
    ...(te.relativeOffsetTicks !== undefined ? { relativeOffsetTicks: te.relativeOffsetTicks.toString() } : {}),
    ...(te.displayLabel !== undefined ? { displayLabel: te.displayLabel } : {}),
  };
}

function parseCausalLinksRow(raw: unknown, linkRows: Row[]): import('@world-codex/domain').EventCausalLink[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        targetEventId: String(obj.targetEventId),
        kind: obj.kind as import('@world-codex/domain').EventCausalRelationKind,
        ...(obj.description ? { description: String(obj.description) } : {}),
      };
    });
  }
  return linkRows
    .filter((row) => ['causes', 'triggers', 'enables', 'prevents', 'results_in', 'contradicts'].includes(String(row.link_kind)))
    .map((row) => ({
      targetEventId: String(row.linked_event_id),
      kind: String(row.link_kind) as import('@world-codex/domain').EventCausalRelationKind,
      ...(row.description ? { description: String(row.description) } : {}),
    }));
}

function eventFromRows(event: Row, participantRows: Row[], locationRows: Row[], effectRows: Row[], linkRows: Row[]): WorldEvent {
  const participantRoles = participantRows.map((row) => ({ entityId: String(row.entity_id), role: String(row.role ?? 'participant') }));
  const causalLinks = parseCausalLinksRow(event.causal_links, linkRows);
  const temporalExpression = parseTemporalExpressionRow(event.temporal_expression);
  return {
    id: String(event.id), worldId: String(event.world_id), branchId: event.branch_id ? String(event.branch_id) : DEFAULT_BRANCH_ID, name: String(event.name), eventType: String(event.event_type), startTick: BigInt(event.start_tick as string | number | bigint),
    ...(event.end_tick === null || event.end_tick === undefined ? {} : { endTick: BigInt(event.end_tick as string | number | bigint) }),
    ...(temporalExpression ? { temporalExpression } : {}),
    ...(causalLinks.length > 0 ? { causalLinks } : {}),
    participantIds: [...new Set(participantRoles.map((participant) => participant.entityId))], participantRoles, ...(Array.isArray(event.required_roles) && event.required_roles.length ? { requiredRoles: (event.required_roles as unknown[]).map(String) } : {}), locationEntityIds: locationRows.map((row) => String(row.entity_id)),
    causeEventIds: linkRows.filter((row) => row.link_kind === 'cause').map((row) => String(row.linked_event_id)),
    resultEventIds: linkRows.filter((row) => row.link_kind === 'result').map((row) => String(row.linked_event_id)),
    effects: effectRows.map((row): EventEffect => ({ id: String(row.id), type: row.effect_type as EventEffect['type'], ...(row.target_id ? { targetId: String(row.target_id) } : {}), payload: (row.payload_json ?? {}) as Record<string, unknown>, sequence: Number(row.sequence) })),
    ...(effectRows.length && effectRows.every((row) => row.applied_revision !== null && row.applied_revision !== undefined) ? { effectsApplied: true } : {}),
    description: String(event.description), canonStatus: event.canon_status as WorldEvent['canonStatus'],
    ...(event.created_revision === undefined || event.created_revision === null ? {} : { createdRevision: BigInt(event.created_revision as string | number | bigint) }),
    ...(event.pending_revision === undefined || event.pending_revision === null ? {} : { pendingRevision: BigInt(event.pending_revision as string | number | bigint) }),
    ...(event.canon_revision === undefined || event.canon_revision === null ? {} : { canonRevision: BigInt(event.canon_revision as string | number | bigint) }),
    ...(event.retconned_revision === undefined || event.retconned_revision === null ? {} : { retconnedRevision: BigInt(event.retconned_revision as string | number | bigint) }),
  };
}

function timelineBranchFromRow(row: Row): TimelineBranch {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    name: String(row.name),
    parentBranchId: row.parent_branch_id ? String(row.parent_branch_id) : null,
    forkTick: row.fork_tick === null || row.fork_tick === undefined ? null : BigInt(row.fork_tick as string | number | bigint),
    forkRevision: row.fork_revision === null || row.fork_revision === undefined ? null : BigInt(row.fork_revision as string | number | bigint),
    status: row.status as TimelineBranchStatus,
    createdAt: new Date(String(row.created_at)),
  };
}

function validationRuleFromRow(row: Row): ValidationRule {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    name: String(row.name),
    ...(row.description !== null && row.description !== undefined ? { description: String(row.description) } : {}),
    severity: row.severity as ValidationRule['severity'],
    target: row.target as ValidationRule['target'],
    ...(row.target_selector_json ? { targetSelector: row.target_selector_json as ValidationRule['targetSelector'] } : {}),
    ...(row.when_json ? { when: row.when_json as ValidationRule['when'] } : {}),
    assert: row.assert_json as ValidationRule['assert'],
    ...(row.message ? { message: String(row.message) } : {}),
    enabled: Boolean(row.enabled),
    createdRevision: BigInt(row.created_revision as string | number | bigint),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function workFromRow(row: Row): Work {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    title: String(row.title),
    type: row.type as Work['type'],
    ...(row.description !== null && row.description !== undefined ? { description: String(row.description) } : {}),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function chapterFromRow(row: Row): Chapter {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    workId: String(row.work_id),
    title: String(row.title),
    orderIndex: Number(row.order_index ?? 0),
    ...(row.description !== null && row.description !== undefined ? { description: String(row.description) } : {}),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function sceneFromRow(row: Row): Scene {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    workId: String(row.work_id),
    chapterId: String(row.chapter_id),
    ...(row.title !== null && row.title !== undefined ? { title: String(row.title) } : {}),
    orderIndex: Number(row.order_index ?? 0),
    ...(row.scene_tick !== null && row.scene_tick !== undefined ? { sceneTick: BigInt(row.scene_tick as string | number | bigint) } : {}),
    ...(row.pov_character_id ? { povCharacterId: String(row.pov_character_id) } : {}),
    ...(row.location_entity_id ? { locationEntityId: String(row.location_entity_id) } : {}),
    participantEntityIds: Array.isArray(row.participant_entity_ids) ? row.participant_entity_ids.map(String) : [],
    ...(row.plotline_ids && Array.isArray(row.plotline_ids) && row.plotline_ids.length > 0 ? { plotlineIds: row.plotline_ids.map(String) } : {}),
    proseText: String(row.prose_text ?? ''),
    status: row.status as Scene['status'],
    ...(row.canon_revision !== null && row.canon_revision !== undefined ? { canonRevision: BigInt(row.canon_revision as string | number | bigint) } : {}),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function plotlineFromRow(row: Row): Plotline {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    title: String(row.title),
    summary: String(row.summary ?? ''),
    status: row.status as Plotline['status'],
    currentStage: row.current_stage as Plotline['currentStage'],
    characterEntityIds: Array.isArray(row.character_entity_ids) ? row.character_entity_ids.map(String) : [],
    eventIds: Array.isArray(row.event_ids) ? row.event_ids.map(String) : [],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function foreshadowingFromRow(row: Row): Foreshadowing {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    title: String(row.title),
    description: String(row.description ?? ''),
    setupSceneId: String(row.setup_scene_id),
    ...(row.setup_tick !== null && row.setup_tick !== undefined ? { setupTick: BigInt(row.setup_tick as string | number | bigint) } : {}),
    ...(row.payoff_scene_id ? { payoffSceneId: String(row.payoff_scene_id) } : {}),
    ...(row.payoff_tick !== null && row.payoff_tick !== undefined ? { payoffTick: BigInt(row.payoff_tick as string | number | bigint) } : {}),
    relatedEntityIds: Array.isArray(row.related_entity_ids) ? row.related_entity_ids.map(String) : [],
    ...(row.plotline_id ? { plotlineId: String(row.plotline_id) } : {}),
    status: row.status as Foreshadowing['status'],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function isPg(error: unknown, code: string): boolean { return (error as { code?: string }).code === code; }

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function revisionFromRow(row: Row): RevisionRecord {
  return { id: String(row.id), worldId: String(row.world_id), sequence: BigInt(row.sequence as string | number | bigint), actorType: row.actor_type as RevisionRecord['actorType'], sourceKind: String(row.source_kind), reason: String(row.reason), changeSetHash: String(row.change_set_hash), recordedAt: new Date(String(row.recorded_at)) };
}

function changeFromRow(row: Row): ChangeRecord {
  return { id: String(row.id), worldId: String(row.world_id), revisionId: String(row.revision_id), sequence: BigInt(row.sequence as string | number | bigint), objectType: String(row.object_type), objectId: String(row.object_id), operation: row.operation as ChangeRecord['operation'], patch: (row.patch_json ?? {}) as Record<string, unknown> };
}

function proposalFromRows(header: Row, changeRows: Row[]): ProposalRecord {
  const citations = Array.isArray(header.citations_json) ? header.citations_json.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)) : [];
  const unknowns = Array.isArray(header.unknowns) ? header.unknowns.filter((value): value is string => typeof value === 'string') : [];
  return {
    id: String(header.id), worldId: String(header.world_id), baseRevision: BigInt(header.base_revision as string | number | bigint), request: String(header.request),
    ...(header.at_tick === null || header.at_tick === undefined ? {} : { atTick: BigInt(header.at_tick as string | number | bigint) }),
    status: header.status as ProposalRecord['status'], provider: String(header.provider),
    ...(header.model ? { model: String(header.model) } : {}), promptVersion: String(header.prompt_version ?? 'canon-context-v1'), contextRefs: Array.isArray(header.context_refs) ? header.context_refs.map(String) : [],
    changes: changeRows.map((row) => ({ id: String(row.id), command: String(row.command), payload: (row.payload_json ?? {}) as Record<string, unknown>, dependsOn: Array.isArray(row.depends_on) ? row.depends_on.map(String) : [], evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs.map(String) : [], confidence: Number(row.confidence), userDecision: row.user_decision as ProposalRecord['changes'][number]['userDecision'] })),
    citations, unknowns, createdAt: new Date(String(header.created_at)).toISOString(),
  };
}

export class PostgresWorldRepository implements WorldRepository, TemporalRepository, IdempotencyRepository, ProposalRepository {
  constructor(private readonly pool: Pool) {}

  async createAsset(input: { id: string; worldId: string; storageKey: string; mediaType: string; byteSize: bigint; sha256: string; metadata: Record<string, unknown>; scanStatus: Asset['scanStatus']; scanMessage: string; now: Date }, expectedWorldRevision: bigint): Promise<Asset> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n;
      const result = await client.query('INSERT INTO assets(id,world_id,storage_key,media_type,byte_size,sha256,metadata_json,scan_status,scan_message,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [input.id, input.worldId, input.storageKey, input.mediaType, input.byteSize.toString(), input.sha256, jsonStringify(input.metadata), input.scanStatus, input.scanMessage, input.now]);
      await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'asset', input.id, 'create', 'Create asset', input.now, {}); await client.query('COMMIT'); return assetFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Asset storage key or content already exists', { sha256: input.sha256 }); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId }); throw error; } finally { client.release(); }
  }
  async getAsset(worldId: string, assetId: string): Promise<Asset | null> { const result = await this.pool.query('SELECT * FROM assets WHERE world_id=$1 AND id=$2', [worldId, assetId]); return result.rowCount ? assetFromRow(result.rows[0] as Row) : null; }
  async listAssets(worldId: string): Promise<Asset[]> { const result = await this.pool.query('SELECT * FROM assets WHERE world_id=$1 ORDER BY created_at,id', [worldId]); return result.rows.map((row) => assetFromRow(row as Row)); }

  async createValidationRule(input: CreateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const now = input.now ?? new Date();
      const result = await client.query(
        `INSERT INTO validation_rules (id, world_id, name, description, severity, target, target_selector_json, when_json, assert_json, message, enabled, created_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
        [
          input.id,
          input.worldId,
          input.name,
          input.description ?? '',
          input.severity ?? 'error',
          input.target ?? 'entity',
          input.targetSelector ? jsonStringify(input.targetSelector) : null,
          input.when ? jsonStringify(input.when) : null,
          jsonStringify(input.assert),
          input.message ?? null,
          input.enabled ?? true,
          revision.toString(),
          now,
        ]
      );
      await this.bumpWorld(client, input.worldId, revision, now);
      await this.recordRevision(client, input.worldId, revision, 'validation_rule', input.id, 'create', 'Create validation rule', now, {});
      await client.query('COMMIT');
      return validationRuleFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Validation rule ID already exists', { ruleId: input.id });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
      throw error;
    } finally {
      client.release();
    }
  }

  async getValidationRule(worldId: string, ruleId: string): Promise<ValidationRule | null> {
    const result = await this.pool.query('SELECT * FROM validation_rules WHERE world_id = $1 AND id = $2', [worldId, ruleId]);
    return result.rowCount ? validationRuleFromRow(result.rows[0] as Row) : null;
  }

  async listValidationRules(worldId: string): Promise<ValidationRule[]> {
    const result = await this.pool.query('SELECT * FROM validation_rules WHERE world_id = $1 ORDER BY created_at ASC, id ASC', [worldId]);
    return result.rows.map((row) => validationRuleFromRow(row as Row));
  }

  async updateValidationRule(worldId: string, ruleId: string, patch: UpdateValidationRuleInput, expectedWorldRevision: bigint): Promise<ValidationRule> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM validation_rules WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, ruleId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Validation rule not found', { ruleId });
      const current = validationRuleFromRow(existingResult.rows[0] as Row);
      const revision = world.revision + 1n;
      const now = new Date();

      const updatedName = patch.name !== undefined ? patch.name : current.name;
      const updatedDescription = patch.description !== undefined ? patch.description : (current.description ?? '');
      const updatedSeverity = patch.severity !== undefined ? patch.severity : current.severity;
      const updatedTarget = patch.target !== undefined ? patch.target : current.target;
      const updatedTargetSelector = patch.targetSelector !== undefined ? patch.targetSelector : current.targetSelector;
      const updatedWhen = patch.when !== undefined ? patch.when : current.when;
      const updatedAssert = patch.assert !== undefined ? patch.assert : current.assert;
      const updatedMessage = patch.message !== undefined ? patch.message : current.message;
      const updatedEnabled = patch.enabled !== undefined ? patch.enabled : current.enabled;

      const result = await client.query(
        `UPDATE validation_rules
         SET name = $3, description = $4, severity = $5, target = $6, target_selector_json = $7, when_json = $8, assert_json = $9, message = $10, enabled = $11, updated_at = $12
         WHERE world_id = $1 AND id = $2 RETURNING *`,
        [
          worldId,
          ruleId,
          updatedName,
          updatedDescription,
          updatedSeverity,
          updatedTarget,
          updatedTargetSelector ? jsonStringify(updatedTargetSelector) : null,
          updatedWhen ? jsonStringify(updatedWhen) : null,
          jsonStringify(updatedAssert),
          updatedMessage ?? null,
          updatedEnabled,
          now,
        ]
      );
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'validation_rule', ruleId, 'update', 'Update validation rule', now, patch as Record<string, unknown>);
      await client.query('COMMIT');
      return validationRuleFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteValidationRule(worldId: string, ruleId: string, expectedWorldRevision: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM validation_rules WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, ruleId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Validation rule not found', { ruleId });
      const revision = world.revision + 1n;
      const now = new Date();
      await client.query('DELETE FROM validation_rules WHERE world_id = $1 AND id = $2', [worldId, ruleId]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'validation_rule', ruleId, 'delete', 'Delete validation rule', now, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Narrative Works ---
  async createWork(input: CreateWorkInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Work> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const result = await client.query(
        `INSERT INTO works (id, world_id, title, type, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
        [input.id, input.worldId, input.title, input.type ?? 'novel', input.description ?? '', input.now]
      );
      await this.bumpWorld(client, input.worldId, revision, input.now);
      await this.recordRevision(client, input.worldId, revision, 'work', input.id, 'create', 'Create narrative work', input.now, {});
      await client.query('COMMIT');
      return workFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Work ID already exists', { workId: input.id });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId });
      throw error;
    } finally {
      client.release();
    }
  }

  async getWork(worldId: string, workId: string): Promise<Work | null> {
    const result = await this.pool.query('SELECT * FROM works WHERE world_id = $1 AND id = $2', [worldId, workId]);
    return result.rowCount ? workFromRow(result.rows[0] as Row) : null;
  }

  async listWorks(worldId: string): Promise<Work[]> {
    const result = await this.pool.query('SELECT * FROM works WHERE world_id = $1 ORDER BY created_at ASC, id ASC', [worldId]);
    return result.rows.map((row) => workFromRow(row as Row));
  }

  async updateWork(worldId: string, workId: string, patch: UpdateWorkInput, expectedWorldRevision: bigint, now: Date): Promise<Work> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM works WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, workId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Work not found', { workId });
      const current = workFromRow(existingResult.rows[0] as Row);
      const revision = world.revision + 1n;
      const updatedTitle = patch.title !== undefined ? patch.title : current.title;
      const updatedType = patch.type !== undefined ? patch.type : current.type;
      const updatedDescription = patch.description !== undefined ? patch.description : (current.description ?? '');
      const result = await client.query(
        `UPDATE works SET title=$3, type=$4, description=$5, updated_at=$6 WHERE world_id=$1 AND id=$2 RETURNING *`,
        [worldId, workId, updatedTitle, updatedType, updatedDescription, now]
      );
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'work', workId, 'update', 'Update narrative work', now, patch as Record<string, unknown>);
      await client.query('COMMIT');
      return workFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWork(worldId: string, workId: string, expectedWorldRevision: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM works WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, workId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Work not found', { workId });
      const revision = world.revision + 1n;
      const now = new Date();
      await client.query('DELETE FROM works WHERE world_id = $1 AND id = $2', [worldId, workId]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'work', workId, 'delete', 'Delete narrative work', now, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Narrative Chapters ---
  async createChapter(input: CreateChapterInput & { id: string; worldId: string; workId: string; now: Date }, expectedWorldRevision: bigint): Promise<Chapter> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const result = await client.query(
        `INSERT INTO chapters (id, world_id, work_id, title, order_index, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
        [input.id, input.worldId, input.workId, input.title, input.orderIndex ?? 0, input.description ?? '', input.now]
      );
      await this.bumpWorld(client, input.worldId, revision, input.now);
      await this.recordRevision(client, input.worldId, revision, 'chapter', input.id, 'create', 'Create chapter', input.now, {});
      await client.query('COMMIT');
      return chapterFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Chapter ID already exists', { chapterId: input.id });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Work not found', { workId: input.workId });
      throw error;
    } finally {
      client.release();
    }
  }

  async getChapter(worldId: string, chapterId: string): Promise<Chapter | null> {
    const result = await this.pool.query('SELECT * FROM chapters WHERE world_id = $1 AND id = $2', [worldId, chapterId]);
    return result.rowCount ? chapterFromRow(result.rows[0] as Row) : null;
  }

  async listChapters(worldId: string, workId?: string): Promise<Chapter[]> {
    if (workId) {
      const result = await this.pool.query('SELECT * FROM chapters WHERE world_id = $1 AND work_id = $2 ORDER BY order_index ASC, created_at ASC', [worldId, workId]);
      return result.rows.map((row) => chapterFromRow(row as Row));
    }
    const result = await this.pool.query('SELECT * FROM chapters WHERE world_id = $1 ORDER BY order_index ASC, created_at ASC', [worldId]);
    return result.rows.map((row) => chapterFromRow(row as Row));
  }

  async updateChapter(worldId: string, chapterId: string, patch: UpdateChapterInput, expectedWorldRevision: bigint, now: Date): Promise<Chapter> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM chapters WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, chapterId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId });
      const current = chapterFromRow(existingResult.rows[0] as Row);
      const revision = world.revision + 1n;
      const updatedTitle = patch.title !== undefined ? patch.title : current.title;
      const updatedOrder = patch.orderIndex !== undefined ? patch.orderIndex : current.orderIndex;
      const updatedDesc = patch.description !== undefined ? patch.description : (current.description ?? '');
      const result = await client.query(
        `UPDATE chapters SET title=$3, order_index=$4, description=$5, updated_at=$6 WHERE world_id=$1 AND id=$2 RETURNING *`,
        [worldId, chapterId, updatedTitle, updatedOrder, updatedDesc, now]
      );
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'chapter', chapterId, 'update', 'Update chapter', now, patch as Record<string, unknown>);
      await client.query('COMMIT');
      return chapterFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteChapter(worldId: string, chapterId: string, expectedWorldRevision: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM chapters WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, chapterId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId });
      const revision = world.revision + 1n;
      const now = new Date();
      await client.query('DELETE FROM chapters WHERE world_id = $1 AND id = $2', [worldId, chapterId]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'chapter', chapterId, 'delete', 'Delete chapter', now, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Narrative Scenes ---
  async createScene(input: CreateSceneInput & { id: string; worldId: string; workId: string; chapterId: string; now: Date }, expectedWorldRevision: bigint): Promise<Scene> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const result = await client.query(
        `INSERT INTO scenes (id, world_id, work_id, chapter_id, title, order_index, scene_tick, pov_character_id, location_entity_id, participant_entity_ids, plotline_ids, prose_text, status, canon_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING *`,
        [
          input.id,
          input.worldId,
          input.workId,
          input.chapterId,
          input.title ?? '',
          input.orderIndex ?? 0,
          input.sceneTick !== undefined ? input.sceneTick.toString() : null,
          input.povCharacterId ?? null,
          input.locationEntityId ?? null,
          input.participantEntityIds ?? [],
          input.plotlineIds ?? [],
          input.proseText ?? '',
          input.status ?? 'draft',
          input.canonRevision !== undefined ? input.canonRevision.toString() : null,
          input.now,
        ]
      );
      await this.bumpWorld(client, input.worldId, revision, input.now);
      await this.recordRevision(client, input.worldId, revision, 'scene', input.id, 'create', 'Create scene', input.now, {});
      await client.query('COMMIT');
      return sceneFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Scene ID already exists', { sceneId: input.id });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Chapter, entity, or work not found', { chapterId: input.chapterId });
      throw error;
    } finally {
      client.release();
    }
  }

  async getScene(worldId: string, sceneId: string): Promise<Scene | null> {
    const result = await this.pool.query('SELECT * FROM scenes WHERE world_id = $1 AND id = $2', [worldId, sceneId]);
    return result.rowCount ? sceneFromRow(result.rows[0] as Row) : null;
  }

  async listScenes(worldId: string, chapterId?: string): Promise<Scene[]> {
    if (chapterId) {
      const result = await this.pool.query('SELECT * FROM scenes WHERE world_id = $1 AND chapter_id = $2 ORDER BY order_index ASC, created_at ASC', [worldId, chapterId]);
      return result.rows.map((row) => sceneFromRow(row as Row));
    }
    const result = await this.pool.query('SELECT * FROM scenes WHERE world_id = $1 ORDER BY order_index ASC, created_at ASC', [worldId]);
    return result.rows.map((row) => sceneFromRow(row as Row));
  }

  async updateScene(worldId: string, sceneId: string, patch: UpdateSceneInput, expectedWorldRevision: bigint, now: Date): Promise<Scene> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM scenes WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, sceneId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId });
      const current = sceneFromRow(existingResult.rows[0] as Row);
      const revision = world.revision + 1n;
      const updatedTitle = patch.title !== undefined ? patch.title : (current.title ?? '');
      const updatedOrder = patch.orderIndex !== undefined ? patch.orderIndex : current.orderIndex;
      const updatedTick = patch.sceneTick !== undefined ? (patch.sceneTick !== null ? patch.sceneTick.toString() : null) : (current.sceneTick !== undefined ? current.sceneTick.toString() : null);
      const updatedPov = patch.povCharacterId !== undefined ? patch.povCharacterId : (current.povCharacterId ?? null);
      const updatedLoc = patch.locationEntityId !== undefined ? patch.locationEntityId : (current.locationEntityId ?? null);
      const updatedParticipants = patch.participantEntityIds !== undefined ? patch.participantEntityIds : current.participantEntityIds;
      const updatedPlotlines = patch.plotlineIds !== undefined ? patch.plotlineIds : (current.plotlineIds ?? []);
      const updatedProse = patch.proseText !== undefined ? patch.proseText : current.proseText;
      const updatedStatus = patch.status !== undefined ? patch.status : current.status;
      const updatedCanonRev = patch.canonRevision !== undefined ? (patch.canonRevision !== null ? patch.canonRevision.toString() : null) : (current.canonRevision !== undefined ? current.canonRevision.toString() : null);

      const result = await client.query(
        `UPDATE scenes SET title=$3, order_index=$4, scene_tick=$5, pov_character_id=$6, location_entity_id=$7, participant_entity_ids=$8, plotline_ids=$9, prose_text=$10, status=$11, canon_revision=$12, updated_at=$13 WHERE world_id=$1 AND id=$2 RETURNING *`,
        [
          worldId,
          sceneId,
          updatedTitle,
          updatedOrder,
          updatedTick,
          updatedPov,
          updatedLoc,
          updatedParticipants,
          updatedPlotlines,
          updatedProse,
          updatedStatus,
          updatedCanonRev,
          now,
        ]
      );
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'scene', sceneId, 'update', 'Update scene', now, patch as Record<string, unknown>);
      await client.query('COMMIT');
      return sceneFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Entity reference not found', {});
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteScene(worldId: string, sceneId: string, expectedWorldRevision: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM scenes WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, sceneId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId });
      const revision = world.revision + 1n;
      const now = new Date();
      await client.query('DELETE FROM scenes WHERE world_id = $1 AND id = $2', [worldId, sceneId]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'scene', sceneId, 'delete', 'Delete scene', now, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Narrative Plotlines ---
  async createPlotline(input: CreatePlotlineInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Plotline> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const result = await client.query(
        `INSERT INTO plotlines (id, world_id, title, summary, status, current_stage, character_entity_ids, event_ids, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
        [
          input.id,
          input.worldId,
          input.title,
          input.summary ?? '',
          input.status ?? 'active',
          input.currentStage ?? 'setup',
          input.characterEntityIds ?? [],
          input.eventIds ?? [],
          input.now,
        ]
      );
      await this.bumpWorld(client, input.worldId, revision, input.now);
      await this.recordRevision(client, input.worldId, revision, 'plotline', input.id, 'create', 'Create plotline', input.now, {});
      await client.query('COMMIT');
      return plotlineFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Plotline ID already exists', { plotlineId: input.id });
      throw error;
    } finally {
      client.release();
    }
  }

  async getPlotline(worldId: string, plotlineId: string): Promise<Plotline | null> {
    const result = await this.pool.query('SELECT * FROM plotlines WHERE world_id = $1 AND id = $2', [worldId, plotlineId]);
    return result.rowCount ? plotlineFromRow(result.rows[0] as Row) : null;
  }

  async listPlotlines(worldId: string): Promise<Plotline[]> {
    const result = await this.pool.query('SELECT * FROM plotlines WHERE world_id = $1 ORDER BY created_at ASC', [worldId]);
    return result.rows.map((row) => plotlineFromRow(row as Row));
  }

  async updatePlotline(worldId: string, plotlineId: string, patch: UpdatePlotlineInput, expectedWorldRevision: bigint, now: Date): Promise<Plotline> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM plotlines WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, plotlineId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId });
      const current = plotlineFromRow(existingResult.rows[0] as Row);
      const revision = world.revision + 1n;
      const updatedTitle = patch.title !== undefined ? patch.title : current.title;
      const updatedSummary = patch.summary !== undefined ? patch.summary : current.summary;
      const updatedStatus = patch.status !== undefined ? patch.status : current.status;
      const updatedStage = patch.currentStage !== undefined ? patch.currentStage : current.currentStage;
      const updatedCharacters = patch.characterEntityIds !== undefined ? patch.characterEntityIds : current.characterEntityIds;
      const updatedEvents = patch.eventIds !== undefined ? patch.eventIds : current.eventIds;

      const result = await client.query(
        `UPDATE plotlines SET title=$3, summary=$4, status=$5, current_stage=$6, character_entity_ids=$7, event_ids=$8, updated_at=$9 WHERE world_id=$1 AND id=$2 RETURNING *`,
        [
          worldId,
          plotlineId,
          updatedTitle,
          updatedSummary,
          updatedStatus,
          updatedStage,
          updatedCharacters,
          updatedEvents,
          now,
        ]
      );
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'plotline', plotlineId, 'update', 'Update plotline', now, patch as Record<string, unknown>);
      await client.query('COMMIT');
      return plotlineFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePlotline(worldId: string, plotlineId: string, expectedWorldRevision: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM plotlines WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, plotlineId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId });
      const revision = world.revision + 1n;
      const now = new Date();
      await client.query('DELETE FROM plotlines WHERE world_id = $1 AND id = $2', [worldId, plotlineId]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'plotline', plotlineId, 'delete', 'Delete plotline', now, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Narrative Foreshadowings ---
  async createForeshadowing(input: CreateForeshadowingInput & { id: string; worldId: string; now: Date }, expectedWorldRevision: bigint): Promise<Foreshadowing> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;

      const sceneRes = await client.query('SELECT scene_tick FROM scenes WHERE world_id = $1 AND id = $2', [input.worldId, input.setupSceneId]);
      if (!sceneRes.rowCount) throw new DomainError('NOT_FOUND', 'Setup scene not found', { sceneId: input.setupSceneId });
      const sceneTick = sceneRes.rows[0]?.scene_tick;
      const resolvedSetupTick = input.setupTick !== undefined ? input.setupTick.toString() : (sceneTick !== null && sceneTick !== undefined ? String(sceneTick) : null);

      let resolvedPayoffTick: string | null = null;
      if (input.payoffSceneId) {
        const payoffRes = await client.query('SELECT scene_tick FROM scenes WHERE world_id = $1 AND id = $2', [input.worldId, input.payoffSceneId]);
        if (!payoffRes.rowCount) throw new DomainError('NOT_FOUND', 'Payoff scene not found', { sceneId: input.payoffSceneId });
        const payoffSceneTick = payoffRes.rows[0]?.scene_tick;
        resolvedPayoffTick = input.payoffTick !== undefined ? input.payoffTick.toString() : (payoffSceneTick !== null && payoffSceneTick !== undefined ? String(payoffSceneTick) : null);
      }

      const result = await client.query(
        `INSERT INTO foreshadowings (id, world_id, title, description, setup_scene_id, setup_tick, payoff_scene_id, payoff_tick, related_entity_ids, plotline_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING *`,
        [
          input.id,
          input.worldId,
          input.title,
          input.description ?? '',
          input.setupSceneId,
          resolvedSetupTick,
          input.payoffSceneId ?? null,
          resolvedPayoffTick,
          input.relatedEntityIds ?? [],
          input.plotlineId ?? null,
          input.status ?? 'open',
          input.now,
        ]
      );
      await this.bumpWorld(client, input.worldId, revision, input.now);
      await this.recordRevision(client, input.worldId, revision, 'foreshadowing', input.id, 'create', 'Create foreshadowing', input.now, {});
      await client.query('COMMIT');
      return foreshadowingFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Foreshadowing ID already exists', { foreshadowingId: input.id });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Referenced scene or plotline not found', {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getForeshadowing(worldId: string, foreshadowingId: string): Promise<Foreshadowing | null> {
    const result = await this.pool.query('SELECT * FROM foreshadowings WHERE world_id = $1 AND id = $2', [worldId, foreshadowingId]);
    return result.rowCount ? foreshadowingFromRow(result.rows[0] as Row) : null;
  }

  async listForeshadowings(worldId: string, plotlineId?: string): Promise<Foreshadowing[]> {
    if (plotlineId) {
      const result = await this.pool.query('SELECT * FROM foreshadowings WHERE world_id = $1 AND plotline_id = $2 ORDER BY created_at ASC', [worldId, plotlineId]);
      return result.rows.map((row) => foreshadowingFromRow(row as Row));
    }
    const result = await this.pool.query('SELECT * FROM foreshadowings WHERE world_id = $1 ORDER BY created_at ASC', [worldId]);
    return result.rows.map((row) => foreshadowingFromRow(row as Row));
  }

  async updateForeshadowing(worldId: string, foreshadowingId: string, patch: UpdateForeshadowingInput, expectedWorldRevision: bigint, now: Date): Promise<Foreshadowing> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM foreshadowings WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, foreshadowingId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Foreshadowing not found', { foreshadowingId });
      const current = foreshadowingFromRow(existingResult.rows[0] as Row);
      const revision = world.revision + 1n;

      const updatedTitle = patch.title !== undefined ? patch.title : current.title;
      const updatedDescription = patch.description !== undefined ? patch.description : current.description;
      const updatedSetupScene = patch.setupSceneId !== undefined ? patch.setupSceneId : current.setupSceneId;
      const updatedSetupTick = patch.setupTick !== undefined ? (patch.setupTick !== null ? patch.setupTick.toString() : null) : (current.setupTick !== undefined ? current.setupTick.toString() : null);
      const updatedPayoffScene = patch.payoffSceneId !== undefined ? patch.payoffSceneId : (current.payoffSceneId ?? null);
      const updatedPayoffTick = patch.payoffTick !== undefined ? (patch.payoffTick !== null ? patch.payoffTick.toString() : null) : (current.payoffTick !== undefined ? current.payoffTick.toString() : null);
      const updatedRelated = patch.relatedEntityIds !== undefined ? patch.relatedEntityIds : current.relatedEntityIds;
      const updatedPlotline = patch.plotlineId !== undefined ? patch.plotlineId : (current.plotlineId ?? null);
      const updatedStatus = patch.status !== undefined ? patch.status : current.status;

      const result = await client.query(
        `UPDATE foreshadowings SET title=$3, description=$4, setup_scene_id=$5, setup_tick=$6, payoff_scene_id=$7, payoff_tick=$8, related_entity_ids=$9, plotline_id=$10, status=$11, updated_at=$12 WHERE world_id=$1 AND id=$2 RETURNING *`,
        [
          worldId,
          foreshadowingId,
          updatedTitle,
          updatedDescription,
          updatedSetupScene,
          updatedSetupTick,
          updatedPayoffScene,
          updatedPayoffTick,
          updatedRelated,
          updatedPlotline,
          updatedStatus,
          now,
        ]
      );
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'foreshadowing', foreshadowingId, 'update', 'Update foreshadowing', now, patch as Record<string, unknown>);
      await client.query('COMMIT');
      return foreshadowingFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Referenced scene or plotline not found', {});
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteForeshadowing(worldId: string, foreshadowingId: string, expectedWorldRevision: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const existingResult = await client.query('SELECT * FROM foreshadowings WHERE world_id = $1 AND id = $2 FOR UPDATE', [worldId, foreshadowingId]);
      if (!existingResult.rowCount) throw new DomainError('NOT_FOUND', 'Foreshadowing not found', { foreshadowingId });
      const revision = world.revision + 1n;
      const now = new Date();
      await client.query('DELETE FROM foreshadowings WHERE world_id = $1 AND id = $2', [worldId, foreshadowingId]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'foreshadowing', foreshadowingId, 'delete', 'Delete foreshadowing', now, {});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }


  async createCalendar(input: { id: string; versionId: string; worldId: string; name: string; definition: CalendarDefinition; now: Date }, expectedWorldRevision: bigint): Promise<{ calendar: CalendarRecord; version: CalendarVersionRecord }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n;
      const calendarResult = await client.query('INSERT INTO calendars(id,world_id,name,current_version,created_at,updated_at) VALUES ($1,$2,$3,1,$4,$4) RETURNING *', [input.id, input.worldId, input.name, input.now]);
      const versionResult = await client.query('INSERT INTO calendar_versions(id,world_id,calendar_id,version,definition_json,created_revision,created_at) VALUES ($1,$2,$3,1,$4,$5,$6) RETURNING *', [input.versionId, input.worldId, input.id, calendarJson(input.definition), revision.toString(), input.now]);
      await client.query('UPDATE worlds SET default_calendar_version_id=COALESCE(default_calendar_version_id,$2) WHERE id=$1', [input.worldId, input.versionId]);
      await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'calendar', input.id, 'create', 'Create calendar', input.now, {}); await client.query('COMMIT');
      return { calendar: calendarFromRow(calendarResult.rows[0] as Row), version: calendarVersionFromRow(versionResult.rows[0] as Row) };
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23505')) throw new DomainError('VALIDATION_ERROR', 'Calendar ID or name already exists', { calendarId: input.id }); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId }); throw error; } finally { client.release(); }
  }

  async listCalendars(worldId: string): Promise<CalendarRecord[]> { const result = await this.pool.query('SELECT * FROM calendars WHERE world_id=$1 ORDER BY name,id', [worldId]); return result.rows.map((row) => calendarFromRow(row as Row)); }
  async listCalendarVersions(worldId: string, calendarId: string): Promise<CalendarVersionRecord[]> { const result = await this.pool.query('SELECT * FROM calendar_versions WHERE world_id=$1 AND calendar_id=$2 ORDER BY version', [worldId, calendarId]); return result.rows.map((row) => calendarVersionFromRow(row as Row)); }
  async getCalendarVersion(worldId: string, versionId: string): Promise<CalendarVersionRecord | null> { const result = await this.pool.query('SELECT * FROM calendar_versions WHERE world_id=$1 AND id=$2', [worldId, versionId]); return result.rowCount ? calendarVersionFromRow(result.rows[0] as Row) : null; }

  async createCalendarVersion(input: { id: string; worldId: string; calendarId: string; definition: CalendarDefinition; now: Date }, expectedWorldRevision: bigint): Promise<CalendarVersionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const calendarResult = await client.query('SELECT * FROM calendars WHERE world_id=$1 AND id=$2 FOR UPDATE', [input.worldId, input.calendarId]); if (!calendarResult.rowCount) throw new DomainError('NOT_FOUND', 'Calendar not found', { calendarId: input.calendarId });
      const currentVersion = Number((calendarResult.rows[0] as Row).current_version); const version = currentVersion + 1; const revision = world.revision + 1n;
      const result = await client.query('INSERT INTO calendar_versions(id,world_id,calendar_id,version,definition_json,created_revision,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [input.id, input.worldId, input.calendarId, version, calendarJson(input.definition), revision.toString(), input.now]);
      await client.query('UPDATE calendars SET current_version=$3,updated_at=$4 WHERE world_id=$1 AND id=$2', [input.worldId, input.calendarId, version, input.now]); await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'calendar_version', input.id, 'create', 'Create calendar version', input.now, {}); await client.query('COMMIT'); return calendarVersionFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (error instanceof DomainError) throw error; if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Calendar version ID already exists', { versionId: input.id }); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Calendar not found', { calendarId: input.calendarId }); throw error; } finally { client.release(); }
  }
  async setDefaultCalendarVersion(worldId: string, versionId: string, expectedWorldRevision: bigint): Promise<World> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId); this.assertRevision(world, expectedWorldRevision);
      const version = await client.query('SELECT id FROM calendar_versions WHERE world_id=$1 AND id=$2', [worldId, versionId]);
      if (!version.rowCount) throw new DomainError('NOT_FOUND', 'Calendar version not found', { versionId });
      const revision = world.revision + 1n;
      const result = await client.query('UPDATE worlds SET default_calendar_version_id=$2, revision_seq=$3, updated_at=$4 WHERE id=$1 RETURNING *', [worldId, versionId, revision.toString(), new Date()]);
      await this.recordRevision(client, worldId, revision, 'world', worldId, 'update', 'Set default calendar version', new Date(), { defaultCalendarVersionId: versionId });
      await client.query('COMMIT'); return worldFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async getIdempotency(worldId: string, key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query('SELECT request_hash,response_json,created_at FROM idempotency_keys WHERE world_id=$1 AND key=$2', [worldId, key]);
    if (!result.rowCount) return null;
    const row = result.rows[0] as Row;
    return { requestHash: String(row.request_hash), response: row.response_json, ...(row.created_at ? { createdAt: new Date(String(row.created_at)) } : {}) };
  }

  async putIdempotency(worldId: string, key: string, record: IdempotencyRecord): Promise<void> {
    await this.pool.query('INSERT INTO idempotency_keys(world_id,key,request_hash,response_json,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (world_id,key) DO NOTHING', [worldId, key, record.requestHash, jsonStringify(record.response), record.createdAt ?? new Date()]);
  }
  async getOperationIdempotency(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query('SELECT request_hash,response_json,status_code,created_at,state FROM operation_idempotency_keys WHERE scope=$1 AND key=$2 AND state=\'completed\'', [scope, key]);
    if (!result.rowCount) return null;
    const row = result.rows[0] as Row;
    return { requestHash: String(row.request_hash), response: row.response_json, ...(row.status_code === null || row.status_code === undefined ? {} : { statusCode: Number(row.status_code) }), state: 'completed', ...(row.created_at ? { createdAt: new Date(String(row.created_at)) } : {}) };
  }
  async putOperationIdempotency(scope: string, key: string, record: IdempotencyRecord): Promise<void> {
    await this.pool.query(`INSERT INTO operation_idempotency_keys(scope,key,request_hash,response_json,status_code,created_at,state,lease_until)
      VALUES ($1,$2,$3,$4,$5,$6,'completed',NULL)
      ON CONFLICT (scope,key) DO UPDATE SET response_json=EXCLUDED.response_json,status_code=EXCLUDED.status_code,created_at=EXCLUDED.created_at,state='completed',lease_until=NULL
      WHERE operation_idempotency_keys.request_hash=EXCLUDED.request_hash`, [scope, key, record.requestHash, jsonStringify(record.response), record.statusCode ?? 200, record.createdAt ?? new Date()]);
  }
  async claimOperationIdempotency(scope: string, key: string, requestHash: string, leaseMs: number): Promise<IdempotencyClaim> {
    const client = await this.pool.connect();
    const now = new Date();
    try {
      await client.query('BEGIN');
      // Establish the row before locking it. ON CONFLICT makes two API
      // instances racing on a fresh key converge on one durable lease instead
      // of leaking a unique-violation as a 500 response.
      await client.query(`INSERT INTO operation_idempotency_keys(scope,key,request_hash,response_json,status_code,created_at,state,lease_until)
        VALUES ($1,$2,$3,NULL,NULL,$4,'inflight',$5)
        ON CONFLICT (scope,key) DO NOTHING`, [scope, key, requestHash, now, new Date(now.getTime() + leaseMs)]);
      const result = await client.query('SELECT request_hash,response_json,status_code,created_at,state,lease_until FROM operation_idempotency_keys WHERE scope=$1 AND key=$2 FOR UPDATE', [scope, key]);
      if (!result.rowCount) {
        throw new DomainError('INTERNAL_ERROR', 'Idempotency lease row disappeared during claim', { scope, key });
      }
      const row = result.rows[0] as Row;
      if (String(row.request_hash) !== requestHash) {
        await client.query('COMMIT');
        return { status: 'conflict', record: { requestHash: String(row.request_hash), response: row.response_json, ...(row.status_code === null || row.status_code === undefined ? {} : { statusCode: Number(row.status_code) }), ...(row.state === 'inflight' ? { state: 'inflight' as const } : { state: 'completed' as const }) } };
      }
      if (row.state === 'completed') {
        await client.query('COMMIT');
        return { status: 'completed', record: { requestHash, response: row.response_json, ...(row.status_code === null || row.status_code === undefined ? {} : { statusCode: Number(row.status_code) }), state: 'completed', ...(row.created_at ? { createdAt: new Date(String(row.created_at)) } : {}) } };
      }
      const leaseUntil = row.lease_until ? new Date(String(row.lease_until)) : null;
      if (!leaseUntil || leaseUntil.getTime() <= now.getTime()) {
        await client.query("UPDATE operation_idempotency_keys SET state='inflight',lease_until=$3 WHERE scope=$1 AND key=$2", [scope, key, new Date(now.getTime() + leaseMs)]);
        await client.query('COMMIT');
        return { status: 'acquired' };
      }
      await client.query('COMMIT');
      return { status: 'inflight', record: { requestHash, response: null, state: 'inflight', leaseUntil } };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async releaseOperationIdempotency(scope: string, key: string, requestHash: string): Promise<void> {
    await this.pool.query("DELETE FROM operation_idempotency_keys WHERE scope=$1 AND key=$2 AND request_hash=$3 AND state='inflight'", [scope, key, requestHash]);
  }

  async createProposal(proposal: ProposalRecord): Promise<ProposalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO ai_proposals(id,world_id,base_revision,request,at_tick,status,provider,model,prompt_version,context_refs,citations_json,unknowns,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [proposal.id, proposal.worldId, proposal.baseRevision.toString(), proposal.request, proposal.atTick?.toString() ?? null, proposal.status, proposal.provider, proposal.model ?? null, proposal.promptVersion ?? 'canon-context-v1', jsonStringify(proposal.contextRefs ?? []), jsonStringify(proposal.citations), jsonStringify(proposal.unknowns), new Date(proposal.createdAt)]);
      for (const change of proposal.changes) await client.query('INSERT INTO ai_proposal_changes(proposal_id,id,command,payload_json,depends_on,evidence_refs,confidence,user_decision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [proposal.id, change.id, change.command, jsonStringify(change.payload), change.dependsOn, change.evidenceRefs, change.confidence, change.userDecision]);
      await client.query('COMMIT');
      return proposal;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Proposal ID already exists', { proposalId: proposal.id });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World not found', { worldId: proposal.worldId });
      throw error;
    } finally { client.release(); }
  }

  async getProposal(worldId: string, proposalId: string): Promise<ProposalRecord | null> {
    const header = await this.pool.query('SELECT * FROM ai_proposals WHERE world_id=$1 AND id=$2', [worldId, proposalId]);
    if (!header.rowCount) return null;
    const changes = await this.pool.query('SELECT * FROM ai_proposal_changes WHERE proposal_id=$1 ORDER BY id', [proposalId]);
    return proposalFromRows(header.rows[0] as Row, changes.rows as Row[]);
  }

  async updateProposal(proposal: ProposalRecord): Promise<ProposalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const header = await client.query('UPDATE ai_proposals SET base_revision=$3,request=$4,at_tick=$5,status=$6,provider=$7,model=$8,prompt_version=$9,context_refs=$10,citations_json=$11,unknowns=$12 WHERE world_id=$1 AND id=$2 RETURNING *', [proposal.worldId, proposal.id, proposal.baseRevision.toString(), proposal.request, proposal.atTick?.toString() ?? null, proposal.status, proposal.provider, proposal.model ?? null, proposal.promptVersion ?? 'canon-context-v1', jsonStringify(proposal.contextRefs ?? []), jsonStringify(proposal.citations), jsonStringify(proposal.unknowns)]);
      if (!header.rowCount) throw new DomainError('NOT_FOUND', 'Proposal not found', { proposalId: proposal.id });
      await client.query('DELETE FROM ai_proposal_changes WHERE proposal_id=$1', [proposal.id]);
      for (const change of proposal.changes) await client.query('INSERT INTO ai_proposal_changes(proposal_id,id,command,payload_json,depends_on,evidence_refs,confidence,user_decision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [proposal.id, change.id, change.command, jsonStringify(change.payload), change.dependsOn, change.evidenceRefs, change.confidence, change.userDecision]);
      await client.query('COMMIT');
      return proposal;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async createWorld(input: CreateWorldInput): Promise<World> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`INSERT INTO worlds (id, owner_id, name, slug, description, genre, canon_strategy, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [input.id, input.ownerId ?? null, input.name, input.slug, input.description, input.genre, input.canonStrategy, input.now]);
      for (const [typeKey, label] of DEFAULT_ENTITY_TYPES) {
        const typeId = randomUUID();
        await client.query('INSERT INTO entity_types (id,world_id,type_key,label,schema_json,revision,created_revision,updated_revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,1,1,1,$6,$6)', [typeId, input.id, typeKey, label, '{}', input.now]);
        await client.query('INSERT INTO entity_type_versions (id,world_id,entity_type_id,schema_version,schema_json,created_revision,created_at) VALUES ($1,$2,$3,1,$4,1,$5)', [randomUUID(), input.id, typeId, '{}', input.now]);
      }
      await client.query(`INSERT INTO timeline_branches (id, world_id, name, description, parent_branch_id, fork_tick, fork_revision, status, created_at, updated_at) VALUES ($1,$2,$3,'Default main branch',NULL,NULL,0,'main',$4,$4) ON CONFLICT (world_id, id) DO NOTHING`, [DEFAULT_BRANCH_ID, input.id, DEFAULT_BRANCH_NAME, input.now]);
      await this.recordRevision(client, input.id, 1n, 'world', input.id, 'create', 'Create world', input.now, {});
      await client.query('COMMIT'); return worldFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23505')) throw new DomainError('VALIDATION_ERROR', 'World slug already exists', { slug: input.slug }); throw error; } finally { client.release(); }
  }

  async deleteWorld(id: string): Promise<void> {
    await this.pool.query('DELETE FROM worlds WHERE id = $1', [id]);
  }

  async listWorlds(includeArchived = false): Promise<World[]> { const result = await this.pool.query(`SELECT * FROM worlds ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY updated_at DESC`, []); return result.rows.map((row) => worldFromRow(row as Row)); }
  async listRevisions(worldId: string, limit: number): Promise<RevisionRecord[]> { const safeLimit = Math.max(1, Math.min(limit, 100)); const result = await this.pool.query('SELECT * FROM revisions WHERE world_id = $1 ORDER BY sequence DESC LIMIT $2', [worldId, safeLimit]); return result.rows.map((row) => revisionFromRow(row as Row)); }
  async listRevisionChanges(worldId: string, sequence: bigint): Promise<ChangeRecord[]> { const result = await this.pool.query('SELECT cr.*, r.sequence FROM change_records cr JOIN revisions r ON r.world_id=cr.world_id AND r.id=cr.revision_id WHERE cr.world_id=$1 AND r.sequence=$2 ORDER BY cr.id', [worldId, sequence.toString()]); return result.rows.map((row) => changeFromRow(row as Row)); }
  async getWorld(id: string): Promise<World | null> { const result = await this.pool.query('SELECT * FROM worlds WHERE id = $1', [id]); return result.rowCount ? worldFromRow(result.rows[0] as Row) : null; }

  async archiveWorld(id: string, expectedRevision: bigint, archived: boolean): Promise<World> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, id, true); this.assertRevision(world, expectedRevision); const revision = world.revision + 1n; const now = new Date();
      const result = await client.query('UPDATE worlds SET archived_at=$2,revision_seq=$3,updated_at=$4 WHERE id=$1 RETURNING *', [id, archived ? now : null, revision.toString(), now]);
      await this.recordRevision(client, id, revision, 'world', id, 'update', archived ? 'Archive world' : 'Restore world', now, { archived }); await client.query('COMMIT'); return worldFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateWorld(id: string, expectedRevision: bigint, patch: Partial<Pick<World, 'name' | 'description' | 'genre' | 'canonStrategy'>>): Promise<World> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, id); this.assertRevision(world, expectedRevision);
      const next = await client.query(`UPDATE worlds SET name = COALESCE($2,name), description = COALESCE($3,description), genre = COALESCE($4,genre), canon_strategy = COALESCE($5,canon_strategy), revision_seq = revision_seq + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, patch.name ?? null, patch.description ?? null, patch.genre ?? null, patch.canonStrategy ?? null]);
      await this.recordRevision(client, id, world.revision + 1n, 'world', id, 'update', 'Update world', new Date(), patch as Record<string, unknown>); await client.query('COMMIT'); return worldFromRow(next.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateWorldTime(id: string, expectedRevision: bigint, tick: bigint): Promise<World> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const world = await this.lockWorld(client, id); this.assertRevision(world, expectedRevision); const next = await client.query('UPDATE worlds SET current_tick=$2, revision_seq=revision_seq+1, updated_at=now() WHERE id=$1 RETURNING *', [id, tick.toString()]); const revision = world.revision + 1n; const now = new Date(); await this.recordRevision(client, id, revision, 'world', id, 'update', 'Update world time cursor', now, { currentTick: tick.toString() }); await client.query('COMMIT'); return worldFromRow(next.rows[0] as Row); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async createEntity(input: CreateEntityInput, expectedWorldRevision: bigint): Promise<Entity> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n;
      try { await client.query(`INSERT INTO entities (id, world_id, type_id, name, subtitle, parent_entity_id, document_json, document_text, tags, canon_status, schema_version, revision, created_revision, updated_revision, source_kind, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,1,$11,$11,'manual',$12,$12)`, [input.id, input.worldId, input.typeId, input.name, input.subtitle, input.parentEntityId, jsonStringify(input.document), input.documentText, input.tags, input.schemaVersion ?? 1, revision.toString(), input.now]); }
      catch (error) { if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Entity type or parent entity not found in world', { typeId: input.typeId, parentEntityId: input.parentEntityId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Entity ID already exists', { entityId: input.id }); throw error; }
      if (input.snapshotBase !== false) {
        await this.syncEntitySnapshotBase(client, input.worldId, input.id);
        await this.recordEntitySnapshotVersion(client, input.worldId, input.id, revision);
      }
      await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'entity', input.id, 'create', 'Create entity', input.now, {}); const result = await client.query('SELECT * FROM entities WHERE world_id = $1 AND id = $2', [input.worldId, input.id]); await client.query('COMMIT'); return entityFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async getEntity(worldId: string, entityId: string): Promise<Entity | null> { const result = await this.pool.query('SELECT * FROM entities WHERE world_id = $1 AND id = $2', [worldId, entityId]); return result.rowCount ? entityFromRow(result.rows[0] as Row) : null; }
  async listEntities(worldId: string): Promise<Entity[]> { const result = await this.pool.query('SELECT * FROM entities WHERE world_id = $1 ORDER BY name,id', [worldId]); return result.rows.map((row) => entityFromRow(row as Row)); }
  async listSnapshotBaseEntities(worldId: string, asOfRevision?: bigint): Promise<Entity[]> {
    const revision = (asOfRevision ?? (1n << 63n) - 1n).toString();
    const result = await this.pool.query(`
      SELECT DISTINCT ON (id) id,world_id,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,
        canon_status,revision,created_revision,pending_revision,canon_revision,retconned_revision,source_kind,source_ref_id,created_at,updated_at
      FROM entity_snapshot_versions
      WHERE world_id=$1 AND source_ref_id IS NULL AND revision_from <= $2
        AND (revision_to IS NULL OR revision_to > $2)
      ORDER BY id, revision_from DESC`, [worldId, revision]);
    return result.rows.map((row) => entityFromRow(row as Row));
  }

  async updateEntity(worldId: string, entityId: string, expectedWorldRevision: bigint, patch: Partial<Pick<Entity, 'name' | 'subtitle' | 'parentEntityId' | 'document' | 'documentText' | 'tags'>>, now: Date): Promise<Entity> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, worldId); this.assertRevision(world, expectedWorldRevision);
      const currentResult = await client.query('SELECT * FROM entities WHERE world_id=$1 AND id=$2 FOR UPDATE', [worldId, entityId]); if (!currentResult.rowCount) throw new DomainError('NOT_FOUND', 'Entity not found', { entityId });
      const current = entityFromRow(currentResult.rows[0] as Row); const result = await client.query(`UPDATE entities SET name=$3, subtitle=$4, parent_entity_id=$5, document_json=$6, document_text=$7, tags=$8, source_kind='manual', source_ref_id=NULL, revision=revision+1, updated_revision=$9, updated_at=$10 WHERE world_id=$1 AND id=$2 RETURNING *`, [worldId, entityId, patch.name ?? current.name, patch.subtitle ?? current.subtitle, patch.parentEntityId === undefined ? current.parentEntityId : patch.parentEntityId, jsonStringify(patch.document ?? current.document), patch.documentText ?? current.documentText, patch.tags ?? current.tags, (world.revision + 1n).toString(), now]);
      await this.syncEntitySnapshotBase(client, worldId, entityId);
      await this.recordEntitySnapshotVersion(client, worldId, entityId, world.revision + 1n);
      const revision = world.revision + 1n; await this.bumpWorld(client, worldId, revision, now); await this.recordRevision(client, worldId, revision, 'entity', entityId, 'update', 'Update entity', now, patch as Record<string, unknown>); await client.query('COMMIT'); return entityFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Parent entity not found in world', { worldId }); throw error; } finally { client.release(); }
  }

  async createEntityType(input: CreateEntityTypeInput, expectedWorldRevision: bigint): Promise<EntityType> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n;
      const result = await client.query(`INSERT INTO entity_types (id, world_id, type_key, label, schema_json, revision, created_revision, updated_revision, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,1,$6,$6,$7,$7) RETURNING *`, [input.id, input.worldId, input.typeKey, input.label, jsonStringify(input.schema), revision.toString(), input.now]);
      await client.query('INSERT INTO entity_type_versions (id,world_id,entity_type_id,schema_version,schema_json,created_revision,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), input.worldId, input.id, 1, jsonStringify(input.schema), revision.toString(), input.now]);
      await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'entity_type', input.id, 'create', 'Create entity type', input.now, {}); await client.query('COMMIT'); return entityTypeFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23505')) throw new DomainError('VALIDATION_ERROR', 'Entity type key already exists', { typeKey: input.typeKey }); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World not found', { worldId: input.worldId }); throw error; } finally { client.release(); }
  }

  async listEntityTypes(worldId: string): Promise<EntityType[]> { const result = await this.pool.query('SELECT * FROM entity_types WHERE world_id = $1 ORDER BY type_key', [worldId]); return result.rows.map((row) => entityTypeFromRow(row as Row)); }

  async createEntityTypeVersion(worldId: string, entityTypeId: string, schema: Record<string, unknown>, expectedWorldRevision: bigint, now: Date): Promise<EntityTypeVersion> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const currentResult = await client.query('SELECT * FROM entity_types WHERE world_id=$1 AND id=$2 FOR UPDATE', [worldId, entityTypeId]);
      if (!currentResult.rowCount) throw new DomainError('NOT_FOUND', 'Entity type not found', { entityTypeId });
      const current = entityTypeFromRow(currentResult.rows[0] as Row);
      const revision = world.revision + 1n;
      const versionResult = await client.query('INSERT INTO entity_type_versions(id,world_id,entity_type_id,schema_version,schema_json,created_revision,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [randomUUID(), worldId, entityTypeId, current.schemaVersion + 1, jsonStringify(schema), revision.toString(), now]);
      await client.query('UPDATE entity_types SET schema_version=$3,schema_json=$4,revision=revision+1,updated_revision=$5,updated_at=$6 WHERE world_id=$1 AND id=$2', [worldId, entityTypeId, current.schemaVersion + 1, jsonStringify(schema), revision.toString(), now]);
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'entity_type', entityTypeId, 'update', 'Create entity type schema version', now, { schemaVersion: current.schemaVersion + 1 });
      await client.query('COMMIT');
      return entityTypeVersionFromRow(versionResult.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Entity type not found', { entityTypeId }); throw error; } finally { client.release(); }
  }

  async listEntityTypeVersions(worldId: string, entityTypeId: string): Promise<EntityTypeVersion[]> {
    const result = await this.pool.query('SELECT * FROM entity_type_versions WHERE world_id=$1 AND entity_type_id=$2 ORDER BY schema_version', [worldId, entityTypeId]);
    return result.rows.map((row) => entityTypeVersionFromRow(row as Row));
  }

  async createMap(input: { id: string; worldId: string; name: string; crs: string; width: number; height: number; assetId?: string; now: Date }, expectedWorldRevision: bigint): Promise<WorldMap> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const result = await client.query(`INSERT INTO maps (id,world_id,name,crs,width,height,asset_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [input.id, input.worldId, input.name, input.crs, input.width, input.height, input.assetId ?? null, input.now]); await client.query('INSERT INTO map_layers (id,world_id,map_id,name,kind,sort_order,visible,opacity,style_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,0,true,1,$6,$7,$7)', [randomUUID(), input.worldId, input.id, 'Default', 'base', '{}', input.now]); const revision = world.revision + 1n; await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'map', input.id, 'create', 'Create map', input.now, {}); await client.query('COMMIT'); return mapFromRow(result.rows[0] as Row); }
    catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World or asset not found', { worldId: input.worldId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Map ID already exists', { mapId: input.id }); throw error; } finally { client.release(); }
  }

  async listMaps(worldId: string): Promise<WorldMap[]> { const result = await this.pool.query('SELECT * FROM maps WHERE world_id=$1 ORDER BY name,id', [worldId]); return result.rows.map((row) => mapFromRow(row as Row)); }

  async createMapLayer(input: { id: string; worldId: string; mapId: string; name: string; kind: MapLayer['kind']; sortOrder: number; visible: boolean; opacity: number; style: Record<string, unknown>; now: Date }, expectedWorldRevision: bigint): Promise<MapLayer> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n; const result = await client.query('INSERT INTO map_layers(id,world_id,map_id,name,kind,sort_order,visible,opacity,style_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *', [input.id, input.worldId, input.mapId, input.name, input.kind, input.sortOrder, input.visible, input.opacity, jsonStringify(input.style), input.now]); await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'map_layer', input.id, 'create', 'Create map layer', input.now, {}); await client.query('COMMIT'); return mapLayerFromRow(result.rows[0] as Row); }
    catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World or map not found', { worldId: input.worldId, mapId: input.mapId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Map layer name or ID already exists', { layerId: input.id }); throw error; } finally { client.release(); }
  }

  async listMapLayers(worldId: string, mapId: string): Promise<MapLayer[]> { const result = await this.pool.query('SELECT * FROM map_layers WHERE world_id=$1 AND map_id=$2 ORDER BY sort_order,id', [worldId, mapId]); return result.rows.map((row) => mapLayerFromRow(row as Row)); }

  async updateMapLayer(worldId: string, mapId: string, layerId: string, patch: Partial<Pick<MapLayer, 'name' | 'kind' | 'sortOrder' | 'visible' | 'opacity' | 'style'>>, expectedWorldRevision: bigint, now: Date): Promise<MapLayer> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId); this.assertRevision(world, expectedWorldRevision);
      const currentResult = await client.query('SELECT * FROM map_layers WHERE world_id=$1 AND map_id=$2 AND id=$3 FOR UPDATE', [worldId, mapId, layerId]);
      if (!currentResult.rowCount) throw new DomainError('NOT_FOUND', 'Map layer not found', { layerId });
      const current = mapLayerFromRow(currentResult.rows[0] as Row);
      const nextName = patch.name?.trim() ?? current.name;
      const nextKind = patch.kind ?? current.kind;
      const nextSortOrder = patch.sortOrder ?? current.sortOrder;
      const nextVisible = patch.visible ?? current.visible;
      const nextOpacity = patch.opacity ?? current.opacity;
      const nextStyle = patch.style ?? current.style;
      const revision = world.revision + 1n;
      const result = await client.query('UPDATE map_layers SET name=$4,kind=$5,sort_order=$6,visible=$7,opacity=$8,style_json=$9,updated_at=$10 WHERE world_id=$1 AND map_id=$2 AND id=$3 RETURNING *', [worldId, mapId, layerId, nextName, nextKind, nextSortOrder, nextVisible, nextOpacity, jsonStringify(nextStyle), now]);
      await this.bumpWorld(client, worldId, revision, now); await this.recordRevision(client, worldId, revision, 'map_layer', layerId, 'update', 'Update map layer', now, patch as Record<string, unknown>); await client.query('COMMIT'); return mapLayerFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (error instanceof DomainError) throw error; if (isPg(error, '23505')) throw new DomainError('VALIDATION_ERROR', 'Map layer name already exists', { layerId }); throw error; } finally { client.release(); }
  }

  async createMapFeature(input: { id: string; worldId: string; mapId: string; layerId?: string; entityId?: string; kind: MapFeature['kind']; geometry: Record<string, unknown>; properties: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint; now: Date }, expectedWorldRevision: bigint): Promise<MapFeature> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n; const result = await client.query(`INSERT INTO map_features (id,world_id,branch_id,map_id,layer_id,entity_id,kind,geometry_json,properties_json,valid_range,source_kind,created_revision,revision_from,revision_to,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::int8range,'manual',$11,$11,NULL,$12,$12) RETURNING *,valid_range::text AS valid_range_text`, [input.id, input.worldId, DEFAULT_BRANCH_ID, input.mapId, input.layerId ?? null, input.entityId ?? null, input.kind, jsonStringify(input.geometry), jsonStringify(input.properties), temporalRange(input.validFromTick, input.validToTick), revision.toString(), input.now]); await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'map_feature', input.id, 'create', 'Create map feature', input.now, {}); await client.query('COMMIT'); return mapFeatureFromRow(result.rows[0] as Row); }
    catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Map or entity not found', { mapId: input.mapId, entityId: input.entityId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Map feature ID already exists', { featureId: input.id }); throw error; } finally { client.release(); }
  }

  async createMapFeatures(inputs: Array<{ id: string; worldId: string; mapId: string; layerId?: string; entityId?: string; kind: MapFeature['kind']; geometry: Record<string, unknown>; properties: Record<string, unknown>; validFromTick?: bigint; validToTick?: bigint; now: Date }>, expectedWorldRevision: bigint): Promise<MapFeature[]> {
    if (!inputs.length) return [];
    const { worldId, mapId, now } = inputs[0]!;
    if (inputs.some((input) => input.worldId !== worldId || input.mapId !== mapId)) throw new DomainError('VALIDATION_ERROR', 'Batch map features must belong to one map');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId); this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const created: MapFeature[] = [];
      for (const input of inputs) {
        const result = await client.query(`INSERT INTO map_features (id,world_id,branch_id,map_id,layer_id,entity_id,kind,geometry_json,properties_json,valid_range,source_kind,created_revision,revision_from,revision_to,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::int8range,'import',$11,$11,NULL,$12,$12) RETURNING *,valid_range::text AS valid_range_text`, [input.id, worldId, DEFAULT_BRANCH_ID, mapId, input.layerId ?? null, input.entityId ?? null, input.kind, jsonStringify(input.geometry), jsonStringify(input.properties), temporalRange(input.validFromTick, input.validToTick), revision.toString(), now]);
        created.push(mapFeatureFromRow(result.rows[0] as Row));
      }
      await this.bumpWorld(client, worldId, revision, now);
      await this.recordRevision(client, worldId, revision, 'map_feature_batch', mapId, 'create', 'Import GeoJSON features', now, { count: created.length });
      await client.query('COMMIT');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Map, layer, or entity not found', { mapId });
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Map feature ID already exists');
      throw error;
    } finally { client.release(); }
  }

  async listMapFeatures(worldId: string, mapId: string): Promise<MapFeature[]> { const result = await this.pool.query('SELECT *,valid_range::text AS valid_range_text FROM map_features WHERE world_id=$1 AND map_id=$2 ORDER BY created_at,id', [worldId, mapId]); return result.rows.map((row) => mapFeatureFromRow(row as Row)); }
  async listAllMapFeatures(worldId: string): Promise<MapFeature[]> { const result = await this.pool.query('SELECT *,valid_range::text AS valid_range_text FROM map_features WHERE world_id=$1 ORDER BY map_id,created_at,id', [worldId]); return result.rows.map((row) => mapFeatureFromRow(row as Row)); }

  async search(worldId: string, query: string, limit: number): Promise<SearchResult[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const [entities, facts, relations, events, claims, rules, works, scenes] = await Promise.all([
      this.pool.query(`SELECT 'entity' AS kind, id, name AS title, left(document_text,240) AS snippet FROM entities WHERE world_id=$1 AND to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(document_text,'')) @@ plainto_tsquery('simple',$2) ORDER BY updated_at DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'fact' AS kind, id, predicate_key AS title, left(coalesce(value_json::text,''),240) AS snippet FROM facts WHERE world_id=$1 AND (predicate_key ILIKE '%' || $2 || '%' OR coalesce(value_json::text,'') ILIKE '%' || $2 || '%') ORDER BY created_revision DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'relation' AS kind, id, relation_type_id::text AS title, left(description,240) AS snippet FROM relations WHERE world_id=$1 AND description ILIKE '%' || $2 || '%' ORDER BY created_revision DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'event' AS kind, id, name AS title, left(description,240) AS snippet FROM events WHERE world_id=$1 AND to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('simple',$2) ORDER BY start_tick DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'claim' AS kind, id, predicate_key AS title, left(coalesce(value::text,''),240) AS snippet FROM claims WHERE world_id=$1 AND (predicate_key ILIKE '%' || $2 || '%' OR coalesce(value::text,'') ILIKE '%' || $2 || '%') ORDER BY created_revision DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'rule' AS kind, id, name AS title, left(coalesce(description,''),240) AS snippet FROM validation_rules WHERE world_id=$1 AND (name ILIKE '%' || $2 || '%' OR coalesce(description,'') ILIKE '%' || $2 || '%') ORDER BY created_at DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'work' AS kind, id, title, left(coalesce(description,''),240) AS snippet FROM works WHERE world_id=$1 AND (title ILIKE '%' || $2 || '%' OR coalesce(description,'') ILIKE '%' || $2 || '%') ORDER BY updated_at DESC LIMIT $3`, [worldId, query, safeLimit]),
      this.pool.query(`SELECT 'scene' AS kind, id, title, left(coalesce(prose_text,''),240) AS snippet FROM scenes WHERE world_id=$1 AND (title ILIKE '%' || $2 || '%' OR coalesce(prose_text,'') ILIKE '%' || $2 || '%') ORDER BY updated_at DESC LIMIT $3`, [worldId, query, safeLimit]),
    ]);
    return [...entities.rows, ...facts.rows, ...relations.rows, ...events.rows, ...claims.rows, ...rules.rows, ...works.rows, ...scenes.rows].slice(0, safeLimit).map((row) => ({ kind: row.kind as SearchResult['kind'], id: String(row.id), title: String(row.title), snippet: String(row.snippet ?? '') }));
  }

  async createFact(input: CreateFactInput, expectedWorldRevision: bigint): Promise<Fact> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n; const now = new Date();
      const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
      const result = await client.query(`INSERT INTO facts (id, world_id, branch_id, subject_entity_id, predicate_key, object_kind, value_json, object_entity_id, valid_range, canon_status, source_kind, source_ref_id, created_revision, revision_from, revision_to, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::int8range,'draft',$10,NULL,$11,$11,NULL,$12) RETURNING *, valid_range::text AS valid_range_text`, [input.id, input.worldId, branchId, input.subjectEntityId, input.predicateKey, input.objectKind, input.objectKind === 'entity' ? null : jsonStringify(input.value ?? null), input.objectKind === 'entity' ? input.objectEntityId ?? null : null, temporalRange(input.validFromTick, input.validToTick), input.sourceKind, revision.toString(), now]);
      await this.bumpWorld(client, input.worldId, revision, now); await this.recordRevision(client, input.worldId, revision, 'fact', input.id, 'create', 'Create fact', now, {}); await client.query('COMMIT'); return factFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Fact subject, target, or world not found', { subjectEntityId: input.subjectEntityId, objectEntityId: input.objectEntityId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Fact ID already exists', { factId: input.id }); throw error; } finally { client.release(); }
  }

  async listFacts(worldId: string): Promise<Fact[]> { const result = await this.pool.query('SELECT *, valid_range::text AS valid_range_text FROM facts WHERE world_id = $1 ORDER BY created_revision,id', [worldId]); return result.rows.map((row) => factFromRow(row as Row)); }

  async createRelationType(input: CreateEntityTypeInput & { forwardLabel: string; inverseLabel: string; symmetric: boolean; sourceTypeIds: string[]; targetTypeIds: string[] }, expectedWorldRevision: bigint): Promise<RelationType> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n;
      const result = await client.query(`INSERT INTO relation_types (id, world_id, forward_label, inverse_label, symmetric, source_type_ids, target_type_ids, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [input.id, input.worldId, input.forwardLabel, input.inverseLabel, input.symmetric, input.sourceTypeIds, input.targetTypeIds, input.now]);
      await this.bumpWorld(client, input.worldId, revision, input.now); await this.recordRevision(client, input.worldId, revision, 'relation_type', input.id, 'create', 'Create relation type', input.now, {}); await client.query('COMMIT'); return relationTypeFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'World or relation type reference not found', { worldId: input.worldId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Relation type ID already exists', { relationTypeId: input.id }); throw error; } finally { client.release(); }
  }

  async listRelationTypes(worldId: string): Promise<RelationType[]> { const result = await this.pool.query('SELECT * FROM relation_types WHERE world_id = $1 ORDER BY forward_label,id', [worldId]); return result.rows.map((row) => relationTypeFromRow(row as Row)); }

  async createRelation(input: CreateRelationInput, expectedWorldRevision: bigint): Promise<Relation> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n; const now = new Date();
      const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
      const result = await client.query(`INSERT INTO relations (id, world_id, branch_id, source_entity_id, target_entity_id, relation_type_id, valid_range, description, canon_status, source_kind, source_ref_id, created_revision, revision_from, revision_to, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::int8range,$8,'draft','manual',NULL,$9,$9,NULL,$10) RETURNING *, valid_range::text AS valid_range_text`, [input.id, input.worldId, branchId, input.sourceEntityId, input.targetEntityId, input.relationTypeId, temporalRange(input.validFromTick, input.validToTick), input.description, revision.toString(), now]);
      await this.bumpWorld(client, input.worldId, revision, now); await this.recordRevision(client, input.worldId, revision, 'relation', input.id, 'create', 'Create relation', now, {}); await client.query('COMMIT'); return relationFromRow(result.rows[0] as Row);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Relation endpoint or type not found', { sourceEntityId: input.sourceEntityId, targetEntityId: input.targetEntityId, relationTypeId: input.relationTypeId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Relation ID already exists', { relationId: input.id }); if (isPg(error, '23514')) throw new DomainError('VALIDATION_ERROR', 'Relation cannot target itself or has invalid range'); throw error; } finally { client.release(); }
  }

  async listRelations(worldId: string): Promise<Relation[]> { const result = await this.pool.query('SELECT *, valid_range::text AS valid_range_text FROM relations WHERE world_id = $1 ORDER BY created_revision,id', [worldId]); return result.rows.map((row) => relationFromRow(row as Row)); }

  async createEvent(input: CreateEventInput, expectedWorldRevision: bigint): Promise<WorldEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, input.worldId); this.assertRevision(world, expectedWorldRevision); const revision = world.revision + 1n; const now = new Date();
      const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
      const causalLinks = input.causalLinks ?? [];
      const temporalExprJson = serializeTemporalExpression(input.temporalExpression);
      const result = await client.query(`INSERT INTO events (id, world_id, branch_id, name, event_type, start_tick, end_tick, description, canon_status, required_roles, causal_links, temporal_expression, created_revision, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10::jsonb,$11::jsonb,$12,$13) RETURNING *`, [input.id, input.worldId, branchId, input.name, input.eventType, input.startTick.toString(), input.endTick?.toString() ?? null, input.description, input.requiredRoles ?? [], jsonStringify(causalLinks), temporalExprJson ? jsonStringify(temporalExprJson) : null, revision.toString(), now]);
      for (const participant of input.participantRoles ?? input.participantIds.map((entityId) => ({ entityId, role: 'participant' }))) await client.query('INSERT INTO event_participants (world_id,event_id,entity_id,role) VALUES ($1,$2,$3,$4)', [input.worldId, input.id, participant.entityId, participant.role]);
      for (const entityId of input.locationEntityIds) await client.query('INSERT INTO event_locations (world_id,event_id,entity_id) VALUES ($1,$2,$3)', [input.worldId, input.id, entityId]);
      for (const eventId of input.causeEventIds) await client.query(`INSERT INTO event_links (world_id,event_id,linked_event_id,link_kind) VALUES ($1,$2,$3,'cause') ON CONFLICT DO NOTHING`, [input.worldId, input.id, eventId]);
      for (const eventId of input.resultEventIds) await client.query(`INSERT INTO event_links (world_id,event_id,linked_event_id,link_kind) VALUES ($1,$2,$3,'result') ON CONFLICT DO NOTHING`, [input.worldId, input.id, eventId]);
      for (const link of causalLinks) await client.query(`INSERT INTO event_links (world_id,event_id,linked_event_id,link_kind,description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [input.worldId, input.id, link.targetEventId, link.kind, link.description ?? null]);
      for (const effect of input.effects) await client.query('INSERT INTO event_effects (id,world_id,event_id,effect_type,target_id,payload_json,sequence,applied_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [effect.id, input.worldId, input.id, effect.type, effect.targetId ?? null, jsonStringify(effect.payload), effect.sequence, input.effectsApplied ? revision.toString() : null]);
      await this.bumpWorld(client, input.worldId, revision, now); await this.recordRevision(client, input.worldId, revision, 'event', input.id, 'create', 'Create event', now, {});
      const [participants, locations, effects, links] = await Promise.all([
        client.query('SELECT entity_id,role FROM event_participants WHERE world_id=$1 AND event_id=$2 ORDER BY entity_id,role', [input.worldId, input.id]),
        client.query('SELECT entity_id FROM event_locations WHERE world_id=$1 AND event_id=$2 ORDER BY entity_id', [input.worldId, input.id]),
        client.query('SELECT * FROM event_effects WHERE world_id=$1 AND event_id=$2 ORDER BY sequence,id', [input.worldId, input.id]),
        client.query('SELECT * FROM event_links WHERE world_id=$1 AND event_id=$2 ORDER BY link_kind,linked_event_id', [input.worldId, input.id]),
      ]);
      await client.query('COMMIT'); return eventFromRows(result.rows[0] as Row, participants.rows as Row[], locations.rows as Row[], effects.rows as Row[], links.rows as Row[]);
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Event participant, location, or linked event not found', { worldId: input.worldId }); if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Event or effect ID already exists', { eventId: input.id }); if (isPg(error, '23514')) throw new DomainError('VALIDATION_ERROR', 'Event violates temporal constraints'); throw error; } finally { client.release(); }
  }

  async listEvents(worldId: string): Promise<WorldEvent[]> {
    const events = await this.pool.query('SELECT * FROM events WHERE world_id = $1 ORDER BY start_tick,id', [worldId]); const result: WorldEvent[] = [];
    for (const event of events.rows as Row[]) {
      const [participants, locations, effects, links] = await Promise.all([
        this.pool.query('SELECT entity_id,role FROM event_participants WHERE world_id=$1 AND event_id=$2 ORDER BY entity_id,role', [worldId, event.id]),
        this.pool.query('SELECT entity_id FROM event_locations WHERE world_id=$1 AND event_id=$2 ORDER BY entity_id', [worldId, event.id]),
        this.pool.query('SELECT * FROM event_effects WHERE world_id=$1 AND event_id=$2 ORDER BY sequence,id', [worldId, event.id]),
        this.pool.query('SELECT * FROM event_links WHERE world_id=$1 AND event_id=$2 ORDER BY link_kind,linked_event_id', [worldId, event.id]),
      ]);
      result.push(eventFromRows(event, participants.rows as Row[], locations.rows as Row[], effects.rows as Row[], links.rows as Row[]));
    }
    return result;
  }

  async createClaim(input: CreateClaimInput, expectedWorldRevision: bigint): Promise<Claim> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const now = new Date();
      const branchId = input.branchId ?? DEFAULT_BRANCH_ID;
      const result = await client.query(
        `INSERT INTO claims (
          id, world_id, branch_id, subject_entity_id, predicate_key, object_kind, value,
          object_entity_id, asserted_by_entity_id, known_by_entity_ids, valid_from_tick, valid_to_tick,
          truth_status, claim_kind, confidence, source_refs, canon_status,
          created_revision, retconned_revision, revision_from, revision_to, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16, 'draft',
          $17, NULL, $17, NULL, $18, $18
        ) RETURNING *`,
        [
          input.id,
          input.worldId,
          branchId,
          input.subjectEntityId ?? null,
          input.predicateKey,
          input.objectKind,
          input.objectKind === 'entity' ? null : jsonStringify(input.value ?? null),
          input.objectKind === 'entity' ? input.objectEntityId ?? null : null,
          input.assertedByEntityId ?? null,
          input.knownByEntityIds ?? [],
          input.validFromTick !== undefined ? input.validFromTick.toString() : null,
          input.validToTick !== undefined ? input.validToTick.toString() : null,
          input.truthStatus,
          input.claimKind,
          input.confidence ?? null,
          input.sourceRefs ?? [],
          revision.toString(),
          now,
        ]
      );
      await this.bumpWorld(client, input.worldId, revision, now);
      await this.recordRevision(client, input.worldId, revision, 'claim', input.id, 'create', 'Create claim', now, {});
      await client.query('COMMIT');
      return claimFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23503')) {
        throw new DomainError('NOT_FOUND', 'Claim subject, object, or assertedBy entity not found', {
          subjectEntityId: input.subjectEntityId,
          objectEntityId: input.objectEntityId,
          assertedByEntityId: input.assertedByEntityId,
        });
      }
      if (isPg(error, '23505')) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Claim ID already exists', { claimId: input.id });
      throw error;
    } finally {
      client.release();
    }
  }

  async getClaim(worldId: string, claimId: string): Promise<Claim | null> {
    const result = await this.pool.query('SELECT * FROM claims WHERE world_id = $1 AND id = $2', [worldId, claimId]);
    return result.rowCount ? claimFromRow(result.rows[0] as Row) : null;
  }

  async listClaims(worldId: string): Promise<Claim[]> {
    const result = await this.pool.query('SELECT * FROM claims WHERE world_id = $1 ORDER BY created_revision, id', [worldId]);
    return result.rows.map((row) => claimFromRow(row as Row));
  }

  async getCanonTarget(worldId: string, kind: CanonTargetKind, id: string): Promise<CanonTarget | null> {
    if (kind === 'entity') return this.getEntity(worldId, id);
    if (kind === 'fact') { const result = await this.pool.query('SELECT *, valid_range::text AS valid_range_text FROM facts WHERE world_id=$1 AND id=$2', [worldId, id]); return result.rowCount ? factFromRow(result.rows[0] as Row) : null; }
    if (kind === 'relation') { const result = await this.pool.query('SELECT *, valid_range::text AS valid_range_text FROM relations WHERE world_id=$1 AND id=$2', [worldId, id]); return result.rowCount ? relationFromRow(result.rows[0] as Row) : null; }
    if (kind === 'claim') return this.getClaim(worldId, id);
    const events = await this.listEvents(worldId); return events.find((event) => event.id === id) ?? null;
  }

  async updateCanonStatus(worldId: string, kind: CanonTargetKind, id: string, status: import('@world-codex/domain').CanonStatus, expectedWorldRevision: bigint, reason: string, now: Date): Promise<CanonTarget> {
    const table = kind === 'entity' ? 'entities' : kind === 'fact' ? 'facts' : kind === 'relation' ? 'relations' : kind === 'claim' ? 'claims' : kind === 'event' ? 'events' : null;
    if (!table) throw new DomainError('VALIDATION_ERROR', 'Unknown Canon target kind', { kind });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const world = await this.lockWorld(client, worldId); this.assertRevision(world, expectedWorldRevision);
      const current = await client.query(`SELECT id FROM ${table} WHERE world_id=$1 AND id=$2 FOR UPDATE`, [worldId, id]);
      if (!current.rowCount) throw new DomainError('NOT_FOUND', 'Canon target not found', { kind, id });
      const revision = world.revision + 1n;
      if (kind === 'event' && status === 'canon') await this.materializeCanonEvent(client, worldId, id, revision, now);
      if (kind === 'event' && status === 'retconned') await this.revertCanonEvent(client, worldId, id, revision);
      if (kind === 'entity') {
        await client.query(`UPDATE entities SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END, revision=revision+1, updated_revision=$4, updated_at=$5 WHERE world_id=$1 AND id=$2`, [worldId, id, status, revision.toString(), now]);
      } else if (kind === 'claim') {
        await client.query(`UPDATE claims SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END, revision_to=CASE WHEN $3='retconned' THEN $4 ELSE revision_to END, updated_at=$5 WHERE world_id=$1 AND id=$2`, [worldId, id, status, revision.toString(), now]);
      } else if (kind === 'event') {
        await client.query(`UPDATE events SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END WHERE world_id=$1 AND id=$2`, [worldId, id, status, revision.toString()]);
      } else {
        await client.query(`UPDATE ${table} SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END, revision_to=CASE WHEN $3='retconned' THEN $4 ELSE revision_to END WHERE world_id=$1 AND id=$2`, [worldId, id, status, revision.toString()]);
      }
      if (kind === 'entity') {
        await this.syncEntitySnapshotBase(client, worldId, id);
        await this.recordEntitySnapshotVersion(client, worldId, id, revision);
      }
      await this.recordRevision(client, worldId, revision, kind, id, status === 'retconned' ? 'retcon' : 'update', reason, now, { status, reason });
      await this.bumpWorld(client, worldId, revision, now); await client.query('COMMIT');
      const updated = await this.getCanonTarget(worldId, kind, id); if (!updated) throw new DomainError('INTERNAL_ERROR', 'Canon target disappeared after update', { kind, id }); return updated;
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23P01')) throw new DomainError('VALIDATION_ERROR', 'Canon temporal value overlaps an existing Canon record', { kind, id }); throw error; } finally { client.release(); }
  }

  async updateCanonStatuses(worldId: string, changes: CanonStatusChange[], expectedWorldRevision: bigint, reason: string, now: Date): Promise<CanonTarget[]> {
    if (!changes.length) return [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revisions: bigint[] = [];
      for (const change of changes) {
        const table = change.kind === 'entity' ? 'entities' : change.kind === 'fact' ? 'facts' : change.kind === 'relation' ? 'relations' : change.kind === 'claim' ? 'claims' : change.kind === 'event' ? 'events' : null;
        if (!table) throw new DomainError('VALIDATION_ERROR', 'Unknown Canon target kind', { kind: change.kind });
        const current = await client.query(`SELECT id FROM ${table} WHERE world_id=$1 AND id=$2 FOR UPDATE`, [worldId, change.id]);
        if (!current.rowCount) throw new DomainError('NOT_FOUND', 'Canon target not found', { kind: change.kind, id: change.id });
        const revision = world.revision + BigInt(revisions.length + 1);
        if (change.kind === 'event' && change.status === 'canon') await this.materializeCanonEvent(client, worldId, change.id, revision, now);
        if (change.kind === 'event' && change.status === 'retconned') await this.revertCanonEvent(client, worldId, change.id, revision);
        if (change.kind === 'entity') {
          await client.query(`UPDATE entities SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END, revision=revision+1, updated_revision=$4, updated_at=$5 WHERE world_id=$1 AND id=$2`, [worldId, change.id, change.status, revision.toString(), now]);
        } else if (change.kind === 'claim') {
          await client.query(`UPDATE claims SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END, revision_to=CASE WHEN $3='retconned' THEN $4 ELSE revision_to END, updated_at=$5 WHERE world_id=$1 AND id=$2`, [worldId, change.id, change.status, revision.toString(), now]);
        } else if (change.kind === 'event') {
          await client.query(`UPDATE events SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END WHERE world_id=$1 AND id=$2`, [worldId, change.id, change.status, revision.toString()]);
        } else {
          await client.query(`UPDATE ${table} SET canon_status=$3, pending_revision=CASE WHEN $3='pending' AND pending_revision IS NULL THEN $4 ELSE pending_revision END, canon_revision=CASE WHEN $3='canon' THEN COALESCE(canon_revision,$4) ELSE canon_revision END, retconned_revision=CASE WHEN $3='retconned' THEN $4 ELSE retconned_revision END, revision_to=CASE WHEN $3='retconned' THEN $4 ELSE revision_to END WHERE world_id=$1 AND id=$2`, [worldId, change.id, change.status, revision.toString()]);
        }
        if (change.kind === 'entity') {
          await this.syncEntitySnapshotBase(client, worldId, change.id);
          await this.recordEntitySnapshotVersion(client, worldId, change.id, revision);
        }
        await this.recordRevision(client, worldId, revision, change.kind, change.id, change.status === 'retconned' ? 'retcon' : 'update', reason, now, { status: change.status, reason });
        revisions.push(revision);
      }
      await this.bumpWorld(client, worldId, revisions[revisions.length - 1]!, now);
      await client.query('COMMIT');
      const results: CanonTarget[] = [];
      for (const change of changes) {
        const updated = await this.getCanonTarget(worldId, change.kind, change.id);
        if (!updated) throw new DomainError('INTERNAL_ERROR', 'Canon target disappeared after update', { kind: change.kind, id: change.id });
        results.push(updated);
      }
      return results;
    } catch (error) { await client.query('ROLLBACK'); if (isPg(error, '23P01')) throw new DomainError('VALIDATION_ERROR', 'Canon temporal value overlaps an existing Canon record'); throw error; } finally { client.release(); }
  }

  private async syncEntitySnapshotBase(client: PoolClient, worldId: string, entityId: string): Promise<void> {
    await client.query(`INSERT INTO entity_snapshot_bases(world_id,id,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,canon_status,revision,created_at,updated_at)
      SELECT world_id,id,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,canon_status,revision,created_at,updated_at FROM entities WHERE world_id=$1 AND id=$2
      ON CONFLICT (world_id,id) DO UPDATE SET type_id=EXCLUDED.type_id,schema_version=EXCLUDED.schema_version,name=EXCLUDED.name,subtitle=EXCLUDED.subtitle,parent_entity_id=EXCLUDED.parent_entity_id,document_json=EXCLUDED.document_json,document_text=EXCLUDED.document_text,tags=EXCLUDED.tags,canon_status=EXCLUDED.canon_status,revision=EXCLUDED.revision,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`, [worldId, entityId]);
  }

  private async recordEntitySnapshotVersion(client: PoolClient, worldId: string, entityId: string, revision: bigint, sourceRefId?: string): Promise<void> {
    if (sourceRefId) {
      await client.query(`
        INSERT INTO entity_snapshot_versions(
          world_id,id,revision_from,revision_to,type_id,schema_version,name,subtitle,parent_entity_id,
          document_json,document_text,tags,canon_status,revision,created_revision,pending_revision,
          canon_revision,retconned_revision,source_kind,source_ref_id,created_at,updated_at
        )
        SELECT world_id,id,$3,NULL,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,
          canon_status,revision,created_revision,pending_revision,canon_revision,retconned_revision,source_kind,$4,created_at,updated_at
        FROM entities WHERE world_id=$1 AND id=$2`, [worldId, entityId, revision.toString(), sourceRefId]);
      return;
    }
    await client.query('UPDATE entity_snapshot_versions SET revision_to=$3 WHERE world_id=$1 AND id=$2 AND source_ref_id IS NULL AND revision_to IS NULL AND revision_from < $3', [worldId, entityId, revision.toString()]);
    await client.query(`
      INSERT INTO entity_snapshot_versions(
        world_id,id,revision_from,revision_to,type_id,schema_version,name,subtitle,parent_entity_id,
        document_json,document_text,tags,canon_status,revision,created_revision,pending_revision,
        canon_revision,retconned_revision,source_kind,source_ref_id,created_at,updated_at
      )
      SELECT world_id,id,$3,NULL,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,
        canon_status,revision,created_revision,pending_revision,canon_revision,retconned_revision,'manual',NULL,created_at,updated_at
      FROM entities WHERE world_id=$1 AND id=$2
      ON CONFLICT (world_id,id,revision_from) DO UPDATE SET revision_to=NULL,canon_status=EXCLUDED.canon_status,revision=EXCLUDED.revision,
        pending_revision=EXCLUDED.pending_revision,canon_revision=EXCLUDED.canon_revision,retconned_revision=EXCLUDED.retconned_revision,
        name=EXCLUDED.name,subtitle=EXCLUDED.subtitle,parent_entity_id=EXCLUDED.parent_entity_id,document_json=EXCLUDED.document_json,
        document_text=EXCLUDED.document_text,tags=EXCLUDED.tags,updated_at=EXCLUDED.updated_at`, [worldId, entityId, revision.toString()]);
  }

  private async materializeCanonEvent(client: PoolClient, worldId: string, eventId: string, revision: bigint, now: Date): Promise<void> {
    const eventResult = await client.query('SELECT * FROM events WHERE world_id=$1 AND id=$2 FOR UPDATE', [worldId, eventId]);
    if (!eventResult.rowCount) throw new DomainError('NOT_FOUND', 'Event not found', { eventId });
    const [participants, locations, effects, links, entityTypes, entities, facts, relationTypes, relations, mapFeatures] = await Promise.all([
      client.query('SELECT entity_id,role FROM event_participants WHERE world_id=$1 AND event_id=$2 ORDER BY entity_id,role', [worldId, eventId]),
      client.query('SELECT entity_id FROM event_locations WHERE world_id=$1 AND event_id=$2 ORDER BY entity_id', [worldId, eventId]),
      client.query('SELECT * FROM event_effects WHERE world_id=$1 AND event_id=$2 ORDER BY sequence,id', [worldId, eventId]),
      client.query('SELECT * FROM event_links WHERE world_id=$1 AND event_id=$2 ORDER BY link_kind,linked_event_id', [worldId, eventId]),
      client.query('SELECT * FROM entity_types WHERE world_id=$1', [worldId]),
      client.query('SELECT * FROM entities WHERE world_id=$1', [worldId]),
      client.query('SELECT *,valid_range::text AS valid_range_text FROM facts WHERE world_id=$1', [worldId]),
      client.query('SELECT * FROM relation_types WHERE world_id=$1', [worldId]),
      client.query('SELECT *,valid_range::text AS valid_range_text FROM relations WHERE world_id=$1', [worldId]),
      client.query('SELECT *,valid_range::text AS valid_range_text FROM map_features WHERE world_id=$1', [worldId]),
    ]);
    if (effects.rows.length && (effects.rows as Row[]).every((row) => row.applied_revision !== null && row.applied_revision !== undefined)) return;
    const event = eventFromRows(eventResult.rows[0] as Row, participants.rows as Row[], locations.rows as Row[], effects.rows as Row[], links.rows as Row[]);
    const original = {
      entities: entities.rows.map((row) => entityFromRow(row as Row)),
      entityTypes: entityTypes.rows.map((row) => entityTypeFromRow(row as Row)),
      facts: facts.rows.map((row) => factFromRow(row as Row)),
      relations: relations.rows.map((row) => relationFromRow(row as Row)),
      relationTypes: relationTypes.rows.map((row) => relationTypeFromRow(row as Row)),
      mapFeatures: mapFeatures.rows.map((row) => mapFeatureFromRow(row as Row)),
    };
    const materialized = materializeEventEffects(event, original, revision, now);
    await client.query(`INSERT INTO event_materialization_backups(world_id,event_id,entities_json,facts_json,relations_json,map_features_json,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (world_id,event_id) DO UPDATE SET entities_json=EXCLUDED.entities_json,facts_json=EXCLUDED.facts_json,relations_json=EXCLUDED.relations_json,map_features_json=EXCLUDED.map_features_json,created_at=EXCLUDED.created_at`, [worldId, eventId, jsonStringify(materialized.undo.entities), jsonStringify(materialized.undo.facts), jsonStringify(materialized.undo.relations), jsonStringify(materialized.undo.mapFeatures), now]);
    const originalEntities = new Map(original.entities.map((entity) => [entity.id, entity]));
    for (const entity of materialized.entities) {
      const previous = originalEntities.get(entity.id);
      if (!previous) {
        if (!isUuid(entity.id)) throw new DomainError('VALIDATION_ERROR', 'CREATE_ENTITY effect must use a UUID entity id', { entityId: entity.id });
        await client.query('INSERT INTO entities (id,world_id,type_id,name,subtitle,parent_entity_id,document_json,document_text,tags,canon_status,schema_version,revision,created_revision,pending_revision,canon_revision,retconned_revision,updated_revision,source_kind,source_ref_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$12,$17,$18,$19,$20)', [entity.id, worldId, entity.typeId, entity.name, entity.subtitle, entity.parentEntityId, jsonStringify(entity.document), entity.documentText, entity.tags, entity.canonStatus, entity.schemaVersion ?? 1, entity.revision.toString(), entity.createdRevision?.toString() ?? revision.toString(), entity.pendingRevision?.toString() ?? null, entity.canonRevision?.toString() ?? null, entity.retconnedRevision?.toString() ?? null, entity.sourceKind ?? 'event', entity.sourceRefId ?? eventId, entity.createdAt, now]);
      } else if (previous.revision !== entity.revision || previous.canonStatus !== entity.canonStatus || jsonStringify(previous.document) !== jsonStringify(entity.document) || previous.parentEntityId !== entity.parentEntityId || previous.name !== entity.name || previous.subtitle !== entity.subtitle || jsonStringify(previous.tags) !== jsonStringify(entity.tags)) {
         await client.query('UPDATE entities SET type_id=$3,name=$4,subtitle=$5,parent_entity_id=$6,document_json=$7,document_text=$8,tags=$9,canon_status=$10,revision=$11,created_revision=$12,pending_revision=$13,canon_revision=$14,retconned_revision=$15,updated_revision=$11,source_kind=$16,source_ref_id=$17,updated_at=$18 WHERE world_id=$1 AND id=$2', [worldId, entity.id, entity.typeId, entity.name, entity.subtitle, entity.parentEntityId, jsonStringify(entity.document), entity.documentText, entity.tags, entity.canonStatus, entity.revision.toString(), entity.createdRevision?.toString() ?? revision.toString(), entity.pendingRevision?.toString() ?? null, entity.canonRevision?.toString() ?? revision.toString(), entity.retconnedRevision?.toString() ?? null, entity.sourceKind ?? 'event', entity.sourceRefId ?? eventId, now]);
      }
      await this.recordEntitySnapshotVersion(client, worldId, entity.id, revision, eventId);
    }
    const originalFacts = new Map(original.facts.map((fact) => [fact.id, fact]));
    for (const fact of materialized.facts) {
      const previous = originalFacts.get(fact.id);
      if (!previous) {
        if (!isUuid(fact.id)) throw new DomainError('VALIDATION_ERROR', 'SET_FACT effect must use a UUID fact id', { factId: fact.id });
        await this.insertMaterializedFact(client, fact, revision, now);
      } else if (previous.validFromTick !== fact.validFromTick || previous.validToTick !== fact.validToTick || previous.objectKind !== fact.objectKind || previous.objectEntityId !== fact.objectEntityId || jsonStringify(previous.value) !== jsonStringify(fact.value) || previous.canonStatus !== fact.canonStatus) {
         await client.query('UPDATE facts SET branch_id=$3,subject_entity_id=$4,predicate_key=$5,object_kind=$6,value_json=$7,object_entity_id=$8,valid_range=$9::int8range,canon_status=$10,source_kind=$11,source_ref_id=$12,created_revision=$13,pending_revision=$14,canon_revision=$15,retconned_revision=$16,revision_from=$13,revision_to=$17 WHERE world_id=$1 AND id=$2', [worldId, fact.id, fact.branchId ?? DEFAULT_BRANCH_ID, fact.subjectEntityId, fact.predicateKey, fact.objectKind, fact.objectKind === 'entity' ? null : jsonStringify(fact.value ?? null), fact.objectKind === 'entity' ? fact.objectEntityId ?? null : null, temporalRange(fact.validFromTick, fact.validToTick), fact.canonStatus, fact.sourceKind, fact.sourceRefId ?? eventId, fact.createdRevision?.toString() ?? revision.toString(), fact.pendingRevision?.toString() ?? null, fact.canonRevision?.toString() ?? revision.toString(), fact.retconnedRevision?.toString() ?? null, fact.revisionTo?.toString() ?? null]);
      }
    }
    const originalRelations = new Map(original.relations.map((relation) => [relation.id, relation]));
    for (const relation of materialized.relations) {
      const previous = originalRelations.get(relation.id);
      if (!previous) {
        if (!isUuid(relation.id)) throw new DomainError('VALIDATION_ERROR', 'ADD_RELATION effect must use a UUID relation id', { relationId: relation.id });
        await client.query('INSERT INTO relations (id,world_id,branch_id,source_entity_id,target_entity_id,relation_type_id,valid_range,description,canon_status,source_kind,source_ref_id,created_revision,revision_from,revision_to,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::int8range,$8,$9,$10,$11,$12,$12,NULL,$13)', [relation.id, worldId, relation.branchId ?? DEFAULT_BRANCH_ID, relation.sourceEntityId, relation.targetEntityId, relation.relationTypeId, temporalRange(relation.validFromTick, relation.validToTick), relation.description, relation.canonStatus, relation.sourceKind ?? 'event', relation.sourceRefId ?? eventId, revision.toString(), now]);
      } else if (previous.validFromTick !== relation.validFromTick || previous.validToTick !== relation.validToTick || previous.canonStatus !== relation.canonStatus || previous.description !== relation.description) {
         await client.query('UPDATE relations SET branch_id=$3,source_entity_id=$4,target_entity_id=$5,relation_type_id=$6,valid_range=$7::int8range,description=$8,canon_status=$9,source_kind=$10,source_ref_id=$11,created_revision=$12,pending_revision=$13,canon_revision=$14,retconned_revision=$15,revision_from=$12,revision_to=$16 WHERE world_id=$1 AND id=$2', [worldId, relation.id, relation.branchId ?? DEFAULT_BRANCH_ID, relation.sourceEntityId, relation.targetEntityId, relation.relationTypeId, temporalRange(relation.validFromTick, relation.validToTick), relation.description, relation.canonStatus, relation.sourceKind ?? 'event', relation.sourceRefId ?? eventId, relation.createdRevision?.toString() ?? revision.toString(), relation.pendingRevision?.toString() ?? null, relation.canonRevision?.toString() ?? revision.toString(), relation.retconnedRevision?.toString() ?? null, relation.revisionTo?.toString() ?? null]);
      }
    }
    const originalMapFeatures = new Map(original.mapFeatures.map((feature) => [feature.id, feature]));
    for (const feature of materialized.mapFeatures ?? []) {
      const previous = originalMapFeatures.get(feature.id);
      if (!previous) {
        if (!isUuid(feature.id)) throw new DomainError('VALIDATION_ERROR', 'CHANGE_GEOMETRY effect must use a UUID map feature id', { mapFeatureId: feature.id });
        await client.query('INSERT INTO map_features (id,world_id,branch_id,map_id,layer_id,entity_id,kind,geometry_json,properties_json,valid_range,source_kind,source_ref_id,created_revision,revision_from,revision_to,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::int8range,$11,$12,$13,$13,NULL,$14,$14)', [feature.id, worldId, feature.branchId ?? DEFAULT_BRANCH_ID, feature.mapId, feature.layerId ?? null, feature.entityId ?? null, feature.kind, jsonStringify(feature.geometry), jsonStringify(feature.properties), temporalRange(feature.validFromTick, feature.validToTick), feature.sourceKind ?? 'event', feature.sourceRefId ?? eventId, revision.toString(), now]);
      } else if (previous.validFromTick !== feature.validFromTick || previous.validToTick !== feature.validToTick || jsonStringify(previous.geometry) !== jsonStringify(feature.geometry) || jsonStringify(previous.properties) !== jsonStringify(feature.properties) || previous.updatedAt.getTime() !== feature.updatedAt.getTime()) {
         await client.query('UPDATE map_features SET branch_id=$3,map_id=$4,layer_id=$5,entity_id=$6,kind=$7,geometry_json=$8,properties_json=$9,valid_range=$10::int8range,source_kind=$11,source_ref_id=$12,created_revision=$13,pending_revision=$14,canon_revision=$15,retconned_revision=$16,revision_from=$13,revision_to=$17,updated_at=$18 WHERE world_id=$1 AND id=$2', [worldId, feature.id, feature.branchId ?? DEFAULT_BRANCH_ID, feature.mapId, feature.layerId ?? null, feature.entityId ?? null, feature.kind, jsonStringify(feature.geometry), jsonStringify(feature.properties), temporalRange(feature.validFromTick, feature.validToTick), feature.sourceKind ?? 'event', feature.sourceRefId ?? eventId, feature.createdRevision?.toString() ?? revision.toString(), feature.pendingRevision?.toString() ?? null, feature.canonRevision?.toString() ?? revision.toString(), feature.retconnedRevision?.toString() ?? null, feature.revisionTo?.toString() ?? null, now]);
      }
    }
    await client.query('UPDATE event_effects SET applied_revision=$3 WHERE world_id=$1 AND event_id=$2', [worldId, eventId, revision.toString()]);
  }

  private async revertCanonEvent(client: PoolClient, worldId: string, eventId: string, revision: bigint): Promise<void> {
    const backupResult = await client.query('SELECT entities_json,facts_json,relations_json,map_features_json FROM event_materialization_backups WHERE world_id=$1 AND event_id=$2', [worldId, eventId]);
    if (!backupResult.rowCount) {
      throw new DomainError('VALIDATION_ERROR', 'Cannot retcon an event whose materialization backup is missing', { worldId, eventId });
    }
    const row = backupResult.rows[0] as Row;
    const entities = reviveStoredJson(row.entities_json) as Entity[];
    const facts = reviveStoredJson(row.facts_json) as Fact[];
    const relations = reviveStoredJson(row.relations_json) as Relation[];
    const mapFeatures = reviveStoredJson(row.map_features_json) as MapFeature[];

    await client.query('UPDATE entities SET canon_status=\'retconned\',retconned_revision=$3 WHERE world_id=$1 AND source_ref_id=$2 AND id <> ALL($4::uuid[])', [worldId, eventId, revision.toString(), entities.map((entity) => entity.id)]);
    await client.query('UPDATE facts SET canon_status=\'retconned\',retconned_revision=$3,revision_to=$3 WHERE world_id=$1 AND source_ref_id=$2 AND id <> ALL($4::uuid[])', [worldId, eventId, revision.toString(), facts.map((fact) => fact.id)]);
    await client.query('UPDATE relations SET canon_status=\'retconned\',retconned_revision=$3,revision_to=$3 WHERE world_id=$1 AND source_ref_id=$2 AND id <> ALL($4::uuid[])', [worldId, eventId, revision.toString(), relations.map((relation) => relation.id)]);
    await client.query('UPDATE map_features SET retconned_revision=$3,revision_to=$3 WHERE world_id=$1 AND source_ref_id=$2 AND id <> ALL($4::uuid[])', [worldId, eventId, revision.toString(), mapFeatures.map((feature) => feature.id)]);

    for (const entity of entities) {
      await client.query(`UPDATE entities SET type_id=$3,name=$4,subtitle=$5,parent_entity_id=$6,document_json=$7,document_text=$8,tags=$9,canon_status=$10,revision=$11,pending_revision=$12,canon_revision=$13,retconned_revision=$14,source_kind=$15,source_ref_id=$16,updated_revision=$11,created_at=$17,updated_at=$18 WHERE world_id=$1 AND id=$2`, [worldId, entity.id, entity.typeId, entity.name, entity.subtitle, entity.parentEntityId, jsonStringify(entity.document), entity.documentText, entity.tags, entity.canonStatus, entity.revision.toString(), entity.pendingRevision?.toString() ?? null, entity.canonRevision?.toString() ?? null, entity.retconnedRevision?.toString() ?? null, entity.sourceKind ?? 'manual', entity.sourceRefId ?? null, entity.createdAt, entity.updatedAt]);
    }
    for (const fact of facts) {
      await client.query(`UPDATE facts SET branch_id=$3,subject_entity_id=$4,predicate_key=$5,object_kind=$6,value_json=$7,object_entity_id=$8,valid_range=$9::int8range,canon_status=$10,source_kind=$11,source_ref_id=$12,created_revision=$13,pending_revision=$14,canon_revision=$15,retconned_revision=$16,revision_from=$13,revision_to=$17 WHERE world_id=$1 AND id=$2`, [worldId, fact.id, fact.branchId ?? DEFAULT_BRANCH_ID, fact.subjectEntityId, fact.predicateKey, fact.objectKind, fact.objectKind === 'entity' ? null : jsonStringify(fact.value ?? null), fact.objectKind === 'entity' ? fact.objectEntityId ?? null : null, temporalRange(fact.validFromTick, fact.validToTick), fact.canonStatus, fact.sourceKind, fact.sourceRefId ?? null, fact.createdRevision?.toString() ?? '1', fact.pendingRevision?.toString() ?? null, fact.canonRevision?.toString() ?? null, fact.retconnedRevision?.toString() ?? null, fact.revisionTo?.toString() ?? null]);
    }
    for (const relation of relations) {
      await client.query(`UPDATE relations SET branch_id=$3,source_entity_id=$4,target_entity_id=$5,relation_type_id=$6,valid_range=$7::int8range,description=$8,canon_status=$9,source_kind=$10,source_ref_id=$11,created_revision=$12,pending_revision=$13,canon_revision=$14,retconned_revision=$15,revision_from=$12,revision_to=$16 WHERE world_id=$1 AND id=$2`, [worldId, relation.id, relation.branchId ?? DEFAULT_BRANCH_ID, relation.sourceEntityId, relation.targetEntityId, relation.relationTypeId, temporalRange(relation.validFromTick, relation.validToTick), relation.description, relation.canonStatus, relation.sourceKind ?? 'manual', relation.sourceRefId ?? null, relation.createdRevision?.toString() ?? '1', relation.pendingRevision?.toString() ?? null, relation.canonRevision?.toString() ?? null, relation.retconnedRevision?.toString() ?? null, relation.revisionTo?.toString() ?? null]);
    }
    for (const feature of mapFeatures) {
      await client.query(`UPDATE map_features SET branch_id=$3,map_id=$4,layer_id=$5,entity_id=$6,kind=$7,geometry_json=$8,properties_json=$9,valid_range=$10::int8range,source_kind=$11,source_ref_id=$12,created_revision=$13,pending_revision=$14,canon_revision=$15,retconned_revision=$16,revision_from=$13,revision_to=$17,updated_at=$18 WHERE world_id=$1 AND id=$2`, [worldId, feature.id, feature.branchId ?? DEFAULT_BRANCH_ID, feature.mapId, feature.layerId ?? null, feature.entityId ?? null, feature.kind, jsonStringify(feature.geometry), jsonStringify(feature.properties), temporalRange(feature.validFromTick, feature.validToTick), feature.sourceKind ?? 'manual', feature.sourceRefId ?? null, feature.createdRevision?.toString() ?? '1', feature.pendingRevision?.toString() ?? null, feature.canonRevision?.toString() ?? null, feature.retconnedRevision?.toString() ?? null, feature.revisionTo?.toString() ?? null, feature.updatedAt]);
    }
    await client.query('UPDATE event_effects SET applied_revision=NULL WHERE world_id=$1 AND event_id=$2', [worldId, eventId]);
  }

  private async insertMaterializedFact(client: PoolClient, fact: Fact, revision: bigint, now: Date): Promise<void> {
    await client.query('INSERT INTO facts (id,world_id,branch_id,subject_entity_id,predicate_key,object_kind,value_json,object_entity_id,valid_range,canon_status,source_kind,source_ref_id,created_revision,revision_from,revision_to,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::int8range,$10,$11,$12,$13,$13,NULL,$14)', [fact.id, fact.worldId, fact.branchId ?? DEFAULT_BRANCH_ID, fact.subjectEntityId, fact.predicateKey, fact.objectKind, fact.objectKind === 'entity' ? null : jsonStringify(fact.value ?? null), fact.objectKind === 'entity' ? fact.objectEntityId ?? null : null, temporalRange(fact.validFromTick, fact.validToTick), fact.canonStatus, fact.sourceKind, fact.sourceRefId ?? null, revision.toString(), now]);
  }

  async createBranch(input: { id: string; worldId: string; name: string; parentBranchId?: string | null; forkTick?: bigint | null; forkRevision?: bigint | null; status: TimelineBranchStatus; now: Date }, expectedWorldRevision: bigint): Promise<TimelineBranch> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const world = await this.lockWorld(client, input.worldId);
      this.assertRevision(world, expectedWorldRevision);
      const revision = world.revision + 1n;
      const result = await client.query(
        `INSERT INTO timeline_branches (id, world_id, name, description, parent_branch_id, fork_tick, fork_revision, status, created_at, updated_at)
         VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, $8) RETURNING *`,
        [input.id, input.worldId, input.name, input.parentBranchId ?? null, input.forkTick?.toString() ?? null, input.forkRevision?.toString() ?? null, input.status, input.now]
      );
      await this.bumpWorld(client, input.worldId, revision, input.now);
      await this.recordRevision(client, input.worldId, revision, 'branch', input.id, 'create', 'Create timeline branch', input.now, {});
      await client.query('COMMIT');
      return timelineBranchFromRow(result.rows[0] as Row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPg(error, '23505')) throw new DomainError('VALIDATION_ERROR', 'Timeline branch name already exists', { name: input.name });
      if (isPg(error, '23503')) throw new DomainError('NOT_FOUND', 'Source branch or world not found', { parentBranchId: input.parentBranchId });
      throw error;
    } finally {
      client.release();
    }
  }

  async listBranches(worldId: string): Promise<TimelineBranch[]> {
    const result = await this.pool.query('SELECT * FROM timeline_branches WHERE world_id = $1 ORDER BY created_at ASC', [worldId]);
    return result.rows.map((row) => timelineBranchFromRow(row as Row));
  }

  async getBranch(worldId: string, branchId: string): Promise<TimelineBranch | null> {
    const result = await this.pool.query('SELECT * FROM timeline_branches WHERE world_id = $1 AND id = $2', [worldId, branchId]);
    return result.rowCount ? timelineBranchFromRow(result.rows[0] as Row) : null;
  }

  private async lockWorld(client: PoolClient, worldId: string, allowArchived = false): Promise<World> {
    const result = await client.query('SELECT * FROM worlds WHERE id = $1 FOR UPDATE', [worldId]);
    if (!result.rowCount) throw new DomainError('NOT_FOUND', 'World not found', { worldId });
    const world = worldFromRow(result.rows[0] as Row);
    if (world.archivedAt && !allowArchived) throw new DomainError('VALIDATION_ERROR', 'Archived worlds are read-only', { worldId });
    return world;
  }

  private assertRevision(world: World, expected: bigint): void { if (world.revision !== expected) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expected.toString(), actual: world.revision.toString() }); }
  private async bumpWorld(client: PoolClient, worldId: string, revision: bigint, now: Date): Promise<void> { await client.query('UPDATE worlds SET revision_seq = $2, updated_at = $3 WHERE id = $1', [worldId, revision.toString(), now]); }
  private async recordRevision(client: PoolClient, worldId: string, sequence: bigint, objectType: string, objectId: string, operation: 'create' | 'update' | 'delete' | 'retcon', reason: string, now: Date, patch: Record<string, unknown>): Promise<void> {
    const revisionId = randomUUID();
    await client.query('INSERT INTO revisions (id, world_id, sequence, actor_type, source_kind, reason, change_set_hash, recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [revisionId, worldId, sequence.toString(), 'system', 'api', reason, `${objectType}:${objectId}:${sequence.toString()}`, now]);
    await client.query('INSERT INTO change_records (id, world_id, revision_id, object_type, object_id, operation, patch_json) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), worldId, revisionId, objectType, objectId, operation, jsonStringify(patch)]);
    await client.query('INSERT INTO outbox_events (id,world_id,revision_id,event_type,payload_json,available_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)', [randomUUID(), worldId, revisionId, `${objectType}.${operation}`, jsonStringify({ objectType, objectId, operation, sequence: sequence.toString(), patch }), now]);
  }
}

export type DatabaseClient = Pool | PoolClient;
