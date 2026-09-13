import { factsTemporallyConflict, parseFieldSchema, temporalRecordsConflict, validateEntityDocument } from '@world-codex/domain';
import type { Entity, EntityType, Fact, Relation, RelationType, ValidationIssue, ValidationRule, World, WorldEvent } from '@world-codex/domain';
import { evaluateRule } from './dsl';

export * from './dsl';
export * from './dependencies';
export * from './impact';
export * from './incremental';

export interface ValidationContext {
  world: World;
  entities: Entity[];
  entityTypes: EntityType[];
  facts: Fact[];
  relationTypes: RelationType[];
  relations: Relation[];
  events: WorldEvent[];
  rules?: ValidationRule[];
  calendar?: { months: Array<{ days: number }> };
}

const canon = <T extends { canonStatus: string }>(items: T[]): T[] => items.filter((item) => item.canonStatus === 'canon' || item.canonStatus === 'pending');
const contains = (from: bigint | undefined, to: bigint | undefined, tick: bigint): boolean => (from === undefined || tick >= from) && (to === undefined || tick < to);
type TemporalRange = { validFromTick?: bigint; validToTick?: bigint };
const OPEN_RANGE_START = -(1n << 63n) - 1n;
const OPEN_RANGE_END = 1n << 63n;
const rangeStart = (range: TemporalRange): bigint => range.validFromTick ?? OPEN_RANGE_START;
const rangeEnd = (range: TemporalRange): bigint => range.validToTick ?? OPEN_RANGE_END;
const sortByRangeStart = <T extends TemporalRange>(items: T[]): T[] => [...items].sort((left, right) => {
  const startDifference = rangeStart(left) - rangeStart(right);
  if (startDifference !== 0n) return startDifference < 0n ? -1 : 1;
  const endDifference = rangeEnd(left) - rangeEnd(right);
  if (endDifference !== 0n) return endDifference < 0n ? -1 : 1;
  return 0;
});

export function validateWorld(context: ValidationContext, customRules?: ValidationRule[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // References are world-scoped.  Never let an entity from another world
  // satisfy a Fact, Relation, parent, event, or FieldSchema reference.
  const worldEntities = context.entities.filter((entity) => entity.worldId === context.world.id);
  const entityMap = new Map(worldEntities.map((entity) => [entity.id, entity]));
  const entityTypeById = new Map(worldEntities.map((entity) => [entity.id, entity.typeId]));
  const typeMap = new Map(context.entityTypes.filter((type) => type.worldId === context.world.id).map((type) => [type.id, type]));
  const relationTypeMap = new Map(context.relationTypes.filter((type) => type.worldId === context.world.id).map((type) => [type.id, type]));
  const add = (issue: ValidationIssue): void => { issues.push(issue); };

  for (const entity of canon(context.entities)) {
    if (entity.worldId !== context.world.id) add({ ruleCode: 'WORLD_ACCESS_DENIED', severity: 'blocker', subjectId: entity.id, relatedIds: [], message: 'Entity belongs to another world', evidence: [entity.worldId] });
    if (!typeMap.has(entity.typeId)) add({ ruleCode: 'INVALID_ENTITY_TYPE', severity: 'blocker', subjectId: entity.id, relatedIds: [entity.typeId], message: `Entity type ${entity.typeId} does not exist`, evidence: [] });
    if (!entity.name.trim()) add({ ruleCode: 'ENTITY_REQUIRED_FIELD', severity: 'error', subjectId: entity.id, relatedIds: [], message: 'Entity name is required', evidence: [] });
    if (entity.parentEntityId && !entityMap.has(entity.parentEntityId)) add({ ruleCode: 'BROKEN_REFERENCE', severity: 'blocker', subjectId: entity.id, relatedIds: [entity.parentEntityId], message: 'Parent entity does not exist', evidence: [] });
    const schema = typeMap.get(entity.typeId)?.schema;
    if (schema) {
      const parsedSchema = parseFieldSchema(schema);
      for (const schemaIssue of parsedSchema.issues) add({ ruleCode: 'INVALID_ENTITY_SCHEMA', severity: 'blocker', subjectId: entity.typeId, relatedIds: [], message: schemaIssue.message, evidence: [schemaIssue.path] });
      const entityIds = new Set(entityTypeById.keys());
      for (const fieldIssue of validateEntityDocument(schema, entity.document, entityIds, entityTypeById)) {
        const ruleCode = fieldIssue.code === 'required' ? 'ENTITY_REQUIRED_FIELD' : fieldIssue.code === 'reference' ? 'BROKEN_REFERENCE' : fieldIssue.code === 'computed' ? 'COMPUTED_FIELD_WRITE' : 'ENTITY_FIELD_INVALID';
        add({ ruleCode, severity: fieldIssue.code === 'reference' ? 'blocker' : 'error', subjectId: entity.id, relatedIds: [entity.typeId, ...fieldIssue.relatedIds], message: fieldIssue.message, evidence: [fieldIssue.field] });
      }
    }
  }

  for (const fact of canon(context.facts)) {
    if (fact.worldId !== context.world.id) add({ ruleCode: 'WORLD_ACCESS_DENIED', severity: 'blocker', subjectId: fact.subjectEntityId, relatedIds: [fact.id], message: 'Fact belongs to another world', evidence: [] });
    if (!entityMap.has(fact.subjectEntityId)) add({ ruleCode: 'BROKEN_REFERENCE', severity: 'blocker', subjectId: fact.id, relatedIds: [fact.subjectEntityId], message: 'Fact subject does not exist', evidence: [] });
    if (fact.objectKind === 'entity' && (!fact.objectEntityId || !entityMap.has(fact.objectEntityId))) add({ ruleCode: 'BROKEN_REFERENCE', severity: 'blocker', subjectId: fact.id, relatedIds: fact.objectEntityId ? [fact.objectEntityId] : [], message: 'Fact target entity does not exist', evidence: [] });
    if (fact.validFromTick !== undefined && fact.validToTick !== undefined && fact.validFromTick >= fact.validToTick) add({ ruleCode: 'TEMPORAL_FIELD_OVERLAP', severity: 'blocker', subjectId: fact.id, relatedIds: [], message: 'Fact range must be non-empty', evidence: [] });
  }

  for (const relation of canon(context.relations)) {
    const relationType = relationTypeMap.get(relation.relationTypeId);
    if (!relationType) add({ ruleCode: 'INVALID_RELATION', severity: 'blocker', subjectId: relation.id, relatedIds: [relation.relationTypeId], message: 'Relation type does not exist', evidence: [] });
    if (!entityMap.has(relation.sourceEntityId) || !entityMap.has(relation.targetEntityId)) add({ ruleCode: 'BROKEN_REFERENCE', severity: 'blocker', subjectId: relation.id, relatedIds: [relation.sourceEntityId, relation.targetEntityId], message: 'Relation endpoint does not exist', evidence: [] });
    if (relation.sourceEntityId === relation.targetEntityId) add({ ruleCode: 'INVALID_RELATION', severity: 'error', subjectId: relation.id, relatedIds: [relation.sourceEntityId], message: 'Relation cannot target itself', evidence: [] });
    const source = entityMap.get(relation.sourceEntityId);
    const target = entityMap.get(relation.targetEntityId);
    if (relationType && source && target && relationType.sourceTypeIds.length && !relationType.sourceTypeIds.includes(source.typeId)) add({ ruleCode: 'INVALID_RELATION', severity: 'error', subjectId: relation.id, relatedIds: [source.id, relation.relationTypeId], message: 'Source entity type is not allowed', evidence: [source.typeId] });
    if (relationType && source && target && relationType.targetTypeIds.length && !relationType.targetTypeIds.includes(target.typeId)) add({ ruleCode: 'INVALID_RELATION', severity: 'error', subjectId: relation.id, relatedIds: [target.id, relation.relationTypeId], message: 'Target entity type is not allowed', evidence: [target.typeId] });
    if (relation.validFromTick !== undefined && relation.validToTick !== undefined && relation.validFromTick >= relation.validToTick) add({ ruleCode: 'TEMPORAL_RELATION_OVERLAP', severity: 'blocker', subjectId: relation.id, relatedIds: [], message: 'Relation range must be non-empty', evidence: [] });
  }

  // Symmetric relations are stored once (the inverse label is derived at
  // read-time), so their endpoints must use one canonical ordering.  This
  // prevents `(A,B)` and `(B,A)` from becoming two competing source rows.
  for (const relation of canon(context.relations)) {
    const relationType = relationTypeMap.get(relation.relationTypeId);
    if (!relationType?.symmetric) continue;
    if (relation.sourceEntityId > relation.targetEntityId) add({
      ruleCode: 'ASYMMETRIC_RELATION',
      severity: 'error',
      subjectId: relation.id,
      relatedIds: [relation.sourceEntityId, relation.targetEntityId, relation.relationTypeId],
      message: 'Symmetric relation endpoints must be stored in canonical order',
      evidence: [relationType.forwardLabel, relationType.inverseLabel],
    });
  }

  const birth = new Map<string, bigint>();
  const death = new Map<string, bigint>();
  for (const fact of canon(context.facts)) {
    if (fact.objectKind === 'scalar' && (typeof fact.value === 'string' || typeof fact.value === 'number' || typeof fact.value === 'bigint') && (fact.predicateKey === 'birth_tick' || fact.predicateKey === 'death_tick')) {
      try {
        const tick = BigInt(fact.value);
        if (fact.predicateKey === 'birth_tick') {
          const existing = birth.get(fact.subjectEntityId);
          if (existing !== undefined && existing !== tick) {
            add({ ruleCode: 'TEMPORAL_FIELD_OVERLAP', severity: 'error', subjectId: fact.subjectEntityId, relatedIds: [fact.id], message: 'Entity has conflicting birth_tick values', evidence: [existing.toString(), tick.toString()] });
          } else {
            birth.set(fact.subjectEntityId, tick);
          }
        } else {
          const existing = death.get(fact.subjectEntityId);
          if (existing !== undefined && existing !== tick) {
            add({ ruleCode: 'TEMPORAL_FIELD_OVERLAP', severity: 'error', subjectId: fact.subjectEntityId, relatedIds: [fact.id], message: 'Entity has conflicting death_tick values', evidence: [existing.toString(), tick.toString()] });
          } else {
            death.set(fact.subjectEntityId, tick);
          }
        }
      } catch {
        add({ ruleCode: 'WORLD_RULE_VIOLATION', severity: 'error', subjectId: fact.id, relatedIds: [], message: 'Birth/death tick must be an integer', evidence: [String(fact.value)] });
      }
    }
  }
  for (const [entityId, birthTick] of birth) {
    const deathTick = death.get(entityId);
    if (deathTick !== undefined && birthTick >= deathTick) add({ ruleCode: 'BIRTH_AFTER_DEATH', severity: 'blocker', subjectId: entityId, relatedIds: [], message: 'Birth must precede death', evidence: [birthTick.toString(), deathTick.toString()] });
  }
  for (const event of canon(context.events)) {
    const participants = event.participantRoles ?? event.participantIds.map((entityId) => ({ entityId, role: 'participant' }));
    const participantRoles = new Set(participants.map((participant) => participant.role));
    for (const requiredRole of event.requiredRoles ?? []) if (!participantRoles.has(requiredRole)) add({ ruleCode: 'MISSING_REQUIRED_ROLE', severity: 'blocker', subjectId: event.id, relatedIds: event.participantIds, eventId: event.id, message: `Event is missing required participant role ${requiredRole}`, evidence: [requiredRole] });
    for (const participantId of event.participantIds) {
      const birthTick = birth.get(participantId);
      const deathTick = death.get(participantId);
      if (birthTick !== undefined && event.startTick < birthTick) add({ ruleCode: 'EVENT_BEFORE_BIRTH', severity: 'blocker', subjectId: participantId, relatedIds: [], eventId: event.id, message: 'Entity participates before birth', evidence: [event.startTick.toString(), birthTick.toString()] });
      if (deathTick !== undefined && event.startTick >= deathTick) add({ ruleCode: 'EVENT_AFTER_DEATH', severity: 'blocker', subjectId: participantId, relatedIds: [], eventId: event.id, message: 'Entity participates after death', evidence: [event.startTick.toString(), deathTick.toString()] });
      if (deathTick !== undefined && event.endTick !== undefined && event.endTick > deathTick) add({ ruleCode: 'EVENT_AFTER_DEATH', severity: 'blocker', subjectId: participantId, relatedIds: [], eventId: event.id, message: 'Entity participates after death during an event span', evidence: [event.endTick.toString(), deathTick.toString()] });
    }
    if (event.endTick !== undefined && event.endTick < event.startTick) add({ ruleCode: 'TIMELINE_ORDER', severity: 'blocker', eventId: event.id, relatedIds: [], message: 'Event end precedes start', evidence: [] });
  }

  const grouped = new Map<string, Fact[]>();
  for (const fact of canon(context.facts)) {
    const key = `${fact.subjectEntityId}:${fact.predicateKey}`;
    const list = grouped.get(key) ?? [];
    list.push(fact);
    grouped.set(key, list);
  }
  for (const facts of grouped.values()) {
    let longest: Fact | undefined;
    for (const fact of sortByRangeStart(facts)) {
      if (longest && factsTemporallyConflict(longest, fact)) add({ ruleCode: 'TEMPORAL_FIELD_OVERLAP', severity: 'error', subjectId: fact.subjectEntityId, relatedIds: [longest.id, fact.id], message: `Temporal facts overlap for ${fact.predicateKey}`, evidence: [] });
      if (!longest || rangeEnd(fact) > rangeEnd(longest)) longest = fact;
    }
  }
  for (const facts of grouped.values()) {
    const locationFacts = facts.filter((fact) => fact.predicateKey === 'location' && fact.objectKind === 'entity' && fact.objectEntityId);
    let longestLocation: { fact: Fact; locationId: string; end: bigint } | undefined;
    let secondLongestLocation: { fact: Fact; locationId: string; end: bigint } | undefined;
    for (const fact of sortByRangeStart(locationFacts)) {
      const locationId = fact.objectEntityId as string;
      const otherLocation = longestLocation?.locationId === locationId ? secondLongestLocation : longestLocation;
      if (otherLocation && factsTemporallyConflict(otherLocation.fact, fact)) add({ ruleCode: 'LOCATION_CONFLICT', severity: 'error', subjectId: fact.subjectEntityId, relatedIds: [otherLocation.fact.id, fact.id, otherLocation.locationId, locationId], message: 'An entity has two different locations during overlapping time ranges', evidence: [] });
      const end = rangeEnd(fact);
      if (longestLocation?.locationId === locationId) {
        if (end > longestLocation.end) longestLocation = { fact, locationId, end };
      } else if (secondLongestLocation?.locationId === locationId) {
        if (end > secondLongestLocation.end) secondLongestLocation = { fact, locationId, end };
      } else if (!longestLocation || end > longestLocation.end) {
        secondLongestLocation = longestLocation;
        longestLocation = { fact, locationId, end };
      } else if (!secondLongestLocation || end > secondLongestLocation.end) {
        secondLongestLocation = { fact, locationId, end };
      }
      if (longestLocation && secondLongestLocation && secondLongestLocation.end > longestLocation.end) [longestLocation, secondLongestLocation] = [secondLongestLocation, longestLocation];
    }
  }
  for (const relation of canon(context.relations)) {
    const relationType = relationTypeMap.get(relation.relationTypeId);
    const forwardLabel = relationType?.forwardLabel.toLocaleLowerCase() ?? '';
    const inverseLabel = relationType?.inverseLabel.toLocaleLowerCase() ?? '';
    const sourceIsParent = /(parent|father|mother)/.test(forwardLabel);
    const targetIsParent = !sourceIsParent && /(parent|father|mother)/.test(inverseLabel);
    if (!sourceIsParent && !targetIsParent) continue;
    const parentBirth = birth.get(sourceIsParent ? relation.sourceEntityId : relation.targetEntityId);
    const childBirth = birth.get(sourceIsParent ? relation.targetEntityId : relation.sourceEntityId);
    if (parentBirth !== undefined && childBirth !== undefined) {
      const daysPerYear = context.calendar
        ? BigInt(context.calendar.months.reduce((sum, m) => sum + m.days, 0) || 365)
        : (parentBirth > 1000n || childBirth > 1000n ? 365n : 1n);
      if (childBirth - parentBirth < 13n * daysPerYear) {
        add({
          ruleCode: 'PARENT_AGE',
          severity: 'error',
          subjectId: relation.id,
          relatedIds: [relation.sourceEntityId, relation.targetEntityId],
          message: 'Parent must be at least 13 years older than child',
          evidence: [parentBirth.toString(), childBirth.toString()],
        });
      }
    }
  }
  const relationGroups = new Map<string, Relation[]>();
  for (const relation of canon(context.relations)) {
    const key = `${relation.sourceEntityId}:${relation.targetEntityId}:${relation.relationTypeId}`;
    const list = relationGroups.get(key) ?? []; list.push(relation); relationGroups.set(key, list);
  }
  for (const relations of relationGroups.values()) {
    let longest: Relation | undefined;
    for (const relation of sortByRangeStart(relations)) {
      if (longest && temporalRecordsConflict(longest, relation)) add({ ruleCode: 'TEMPORAL_RELATION_OVERLAP', severity: 'error', subjectId: relation.id, relatedIds: [longest.id, relation.id], message: 'Temporal relations overlap for the same endpoints and relation type', evidence: [] });
      if (!longest || rangeEnd(relation) > rangeEnd(longest)) longest = relation;
    }
  }
  const eventMap = new Map(canon(context.events).filter((event) => event.worldId === context.world.id).map((event) => [event.id, event]));
  const canonEvents = canon(context.events).filter((event) => event.worldId === context.world.id);
  const causalForwardGraph = new Map<string, string[]>();

  for (const event of canonEvents) {
    const causalLinks = event.causalLinks ?? [];
    const causalTargetIds = causalLinks.map((link) => link.targetEventId);
    for (const linkedId of [...event.causeEventIds, ...event.resultEventIds, ...causalTargetIds]) {
      if (!eventMap.has(linkedId)) add({ ruleCode: 'BROKEN_REFERENCE', severity: 'blocker', subjectId: event.id, relatedIds: [linkedId], eventId: event.id, message: 'Event link target does not exist', evidence: [] });
    }
    for (const causeId of event.causeEventIds) {
      const cause = eventMap.get(causeId);
      if (cause && cause.startTick > event.startTick) add({ ruleCode: 'TIMELINE_ORDER', severity: 'blocker', subjectId: event.id, relatedIds: [cause.id], eventId: event.id, message: 'Cause event must not start after its result event', evidence: [cause.startTick.toString(), event.startTick.toString()] });
      const existing = causalForwardGraph.get(causeId) ?? [];
      existing.push(event.id);
      causalForwardGraph.set(causeId, existing);
    }
    for (const resultId of event.resultEventIds) {
      const result = eventMap.get(resultId);
      if (result && result.startTick < event.startTick) add({ ruleCode: 'TIMELINE_ORDER', severity: 'blocker', subjectId: event.id, relatedIds: [result.id], eventId: event.id, message: 'Result event must not start before its cause event', evidence: [event.startTick.toString(), result.startTick.toString()] });
      const existing = causalForwardGraph.get(event.id) ?? [];
      existing.push(resultId);
      causalForwardGraph.set(event.id, existing);
    }
    for (const link of causalLinks) {
      const target = eventMap.get(link.targetEventId);
      if (['causes', 'triggers', 'results_in'].includes(link.kind)) {
        if (target && event.startTick > target.startTick) {
          add({ ruleCode: 'TIMELINE_ORDER', severity: 'blocker', subjectId: event.id, relatedIds: [target.id], eventId: event.id, message: 'Cause event must not start after its result event', evidence: [event.startTick.toString(), target.startTick.toString()] });
        }
      }
      if (['causes', 'triggers', 'enables', 'results_in'].includes(link.kind)) {
        const existing = causalForwardGraph.get(event.id) ?? [];
        existing.push(link.targetEventId);
        causalForwardGraph.set(event.id, existing);
      }
      if (['prevents', 'contradicts'].includes(link.kind)) {
        if (target) {
          add({ ruleCode: 'CONTRADICTING_EVENTS', severity: 'blocker', subjectId: event.id, relatedIds: [target.id], eventId: event.id, message: 'Contradicting or prevented events cannot both be canon', evidence: [link.kind] });
        }
      }
    }
  }

  const cycleVisiting = new Set<string>();
  const cycleVisited = new Set<string>();
  const reportedCycleNodes = new Set<string>();
  const checkCycle = (curr: string, path: string[]): void => {
    if (cycleVisiting.has(curr)) {
      if (!reportedCycleNodes.has(curr)) {
        reportedCycleNodes.add(curr);
        add({ ruleCode: 'CAUSAL_CYCLE', severity: 'blocker', subjectId: curr, relatedIds: [...path, curr], eventId: curr, message: 'Event causal cycle detected', evidence: [] });
      }
      return;
    }
    if (cycleVisited.has(curr)) return;
    cycleVisiting.add(curr);
    for (const next of causalForwardGraph.get(curr) ?? []) {
      checkCycle(next, [...path, curr]);
    }
    cycleVisiting.delete(curr);
    cycleVisited.add(curr);
  };
  for (const node of causalForwardGraph.keys()) {
    checkCycle(node, []);
  }

  const rulesToEvaluate = customRules ?? context.rules ?? [];
  for (const rule of rulesToEvaluate) {
    issues.push(...evaluateRule(rule, context));
  }

  return issues;
}

export function rangesOverlap(aFrom: bigint | undefined, aTo: bigint | undefined, bFrom: bigint | undefined, bTo: bigint | undefined): boolean {
  // Open ranges include the complete signed-int64 domain. Use sentinels just
  // outside that domain so an open range still overlaps at MIN/MAX_INT64.
  const leftFrom = aFrom ?? -(1n << 63n) - 1n;
  const leftTo = aTo ?? (1n << 63n);
  const rightFrom = bFrom ?? -(1n << 63n) - 1n;
  const rightTo = bTo ?? (1n << 63n);
  return leftFrom < rightTo && rightFrom < leftTo;
}
