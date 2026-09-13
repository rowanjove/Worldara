import { factsTemporallyConflict, parseFieldSchema, temporalRecordsConflict, validateEntityDocument } from '@world-codex/domain';
import type {
  ChangeSet,
  Entity,
  Fact,
  IncrementalValidationResult,
  Relation,
  ValidationIssue,
  ValidationRule,
} from '@world-codex/domain';
import type { ValidationContext } from './index';
import { rangesOverlap } from './index';
import { evaluateRule } from './dsl';
import { analyzeImpact } from './impact';

const canon = <T extends { canonStatus: string }>(items: T[]): T[] =>
  items.filter((item) => item.canonStatus === 'canon' || item.canonStatus === 'pending');

type TemporalRange = { validFromTick?: bigint; validToTick?: bigint };
const OPEN_RANGE_START = -(1n << 63n) - 1n;
const OPEN_RANGE_END = 1n << 63n;
const rangeStart = (range: TemporalRange): bigint => range.validFromTick ?? OPEN_RANGE_START;
const rangeEnd = (range: TemporalRange): bigint => range.validToTick ?? OPEN_RANGE_END;
const sortByRangeStart = <T extends TemporalRange>(items: T[]): T[] =>
  [...items].sort((left, right) => {
    const startDifference = rangeStart(left) - rangeStart(right);
    if (startDifference !== 0n) return startDifference < 0n ? -1 : 1;
    const endDifference = rangeEnd(left) - rangeEnd(right);
    if (endDifference !== 0n) return endDifference < 0n ? -1 : 1;
    return 0;
  });

export function validateIncremental(
  context: ValidationContext,
  changeSet: ChangeSet,
  customRules?: ValidationRule[]
): IncrementalValidationResult {
  const impact = analyzeImpact(context, changeSet, customRules);
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue): void => {
    issues.push(issue);
  };

  const worldEntities = context.entities.filter((entity) => entity.worldId === context.world.id);
  const entityMap = new Map(worldEntities.map((entity) => [entity.id, entity]));
  const entityTypeById = new Map(worldEntities.map((entity) => [entity.id, entity.typeId]));
  const typeMap = new Map(
    context.entityTypes.filter((type) => type.worldId === context.world.id).map((type) => [type.id, type])
  );
  const relationTypeMap = new Map(
    context.relationTypes.filter((type) => type.worldId === context.world.id).map((type) => [type.id, type])
  );

  const canonEntities = canon(context.entities);
  const canonFacts = canon(context.facts);
  const canonRelations = canon(context.relations);
  const canonEvents = canon(context.events);

  // Pre-index birth & death for all canon facts
  const birth = new Map<string, bigint>();
  const death = new Map<string, bigint>();
  for (const fact of canonFacts) {
    if (
      fact.objectKind === 'scalar' &&
      (typeof fact.value === 'string' || typeof fact.value === 'number' || typeof fact.value === 'bigint') &&
      (fact.predicateKey === 'birth_tick' || fact.predicateKey === 'death_tick')
    ) {
      try {
        const tick = BigInt(fact.value);
        if (fact.predicateKey === 'birth_tick') {
          const existing = birth.get(fact.subjectEntityId);
          if (existing !== undefined && existing !== tick) {
            if (impact.affectedBuiltinRules.has('TEMPORAL_FIELD_OVERLAP') && impact.impactedEntityIds.has(fact.subjectEntityId)) {
              add({
                ruleCode: 'TEMPORAL_FIELD_OVERLAP',
                severity: 'error',
                subjectId: fact.subjectEntityId,
                relatedIds: [fact.id],
                message: 'Entity has conflicting birth_tick values',
                evidence: [existing.toString(), tick.toString()],
              });
            }
          } else {
            birth.set(fact.subjectEntityId, tick);
          }
        } else {
          const existing = death.get(fact.subjectEntityId);
          if (existing !== undefined && existing !== tick) {
            if (impact.affectedBuiltinRules.has('TEMPORAL_FIELD_OVERLAP') && impact.impactedEntityIds.has(fact.subjectEntityId)) {
              add({
                ruleCode: 'TEMPORAL_FIELD_OVERLAP',
                severity: 'error',
                subjectId: fact.subjectEntityId,
                relatedIds: [fact.id],
                message: 'Entity has conflicting death_tick values',
                evidence: [existing.toString(), tick.toString()],
              });
            }
          } else {
            death.set(fact.subjectEntityId, tick);
          }
        }
      } catch {
        if (impact.affectedBuiltinRules.has('WORLD_RULE_VIOLATION') && impact.impactedEntityIds.has(fact.subjectEntityId)) {
          add({
            ruleCode: 'WORLD_RULE_VIOLATION',
            severity: 'error',
            subjectId: fact.id,
            relatedIds: [],
            message: 'Birth/death tick must be an integer',
            evidence: [String(fact.value)],
          });
        }
      }
    }
  }

  // 1. Entity validation (scoped to focal/impacted entities)
  for (const entity of canonEntities) {
    if (!impact.focalEntityIds.has(entity.id)) continue;

    if (impact.affectedBuiltinRules.has('WORLD_ACCESS_DENIED') && entity.worldId !== context.world.id) {
      add({
        ruleCode: 'WORLD_ACCESS_DENIED',
        severity: 'blocker',
        subjectId: entity.id,
        relatedIds: [],
        message: 'Entity belongs to another world',
        evidence: [entity.worldId],
      });
    }
    if (impact.affectedBuiltinRules.has('INVALID_ENTITY_TYPE') && !typeMap.has(entity.typeId)) {
      add({
        ruleCode: 'INVALID_ENTITY_TYPE',
        severity: 'blocker',
        subjectId: entity.id,
        relatedIds: [entity.typeId],
        message: `Entity type ${entity.typeId} does not exist`,
        evidence: [],
      });
    }
    if (impact.affectedBuiltinRules.has('ENTITY_REQUIRED_FIELD') && !entity.name.trim()) {
      add({
        ruleCode: 'ENTITY_REQUIRED_FIELD',
        severity: 'error',
        subjectId: entity.id,
        relatedIds: [],
        message: 'Entity name is required',
        evidence: [],
      });
    }
    if (impact.affectedBuiltinRules.has('BROKEN_REFERENCE') && entity.parentEntityId && !entityMap.has(entity.parentEntityId)) {
      add({
        ruleCode: 'BROKEN_REFERENCE',
        severity: 'blocker',
        subjectId: entity.id,
        relatedIds: [entity.parentEntityId],
        message: 'Parent entity does not exist',
        evidence: [],
      });
    }

    const schema = typeMap.get(entity.typeId)?.schema;
    if (schema) {
      if (impact.affectedBuiltinRules.has('INVALID_ENTITY_SCHEMA')) {
        const parsedSchema = parseFieldSchema(schema);
        for (const schemaIssue of parsedSchema.issues) {
          add({
            ruleCode: 'INVALID_ENTITY_SCHEMA',
            severity: 'blocker',
            subjectId: entity.typeId,
            relatedIds: [],
            message: schemaIssue.message,
            evidence: [schemaIssue.path],
          });
        }
      }
      if (impact.affectedBuiltinRules.has('ENTITY_FIELD_INVALID') || impact.affectedBuiltinRules.has('ENTITY_REQUIRED_FIELD')) {
        const entityIds = new Set(entityTypeById.keys());
        for (const fieldIssue of validateEntityDocument(schema, entity.document, entityIds, entityTypeById)) {
          const ruleCode =
            fieldIssue.code === 'required'
              ? 'ENTITY_REQUIRED_FIELD'
              : fieldIssue.code === 'reference'
              ? 'BROKEN_REFERENCE'
              : fieldIssue.code === 'computed'
              ? 'COMPUTED_FIELD_WRITE'
              : 'ENTITY_FIELD_INVALID';
          add({
            ruleCode,
            severity: fieldIssue.code === 'reference' ? 'blocker' : 'error',
            subjectId: entity.id,
            relatedIds: [entity.typeId, ...fieldIssue.relatedIds],
            message: fieldIssue.message,
            evidence: [fieldIssue.field],
          });
        }
      }
    }
  }

  // 2. Fact reference and temporal validation
  for (const fact of canonFacts) {
    const isTarget = impact.impactedEntityIds.has(fact.subjectEntityId) || (fact.objectKind === 'entity' && fact.objectEntityId && impact.impactedEntityIds.has(fact.objectEntityId));
    if (!isTarget) continue;

    if (impact.affectedBuiltinRules.has('WORLD_ACCESS_DENIED') && fact.worldId !== context.world.id) {
      add({
        ruleCode: 'WORLD_ACCESS_DENIED',
        severity: 'blocker',
        subjectId: fact.subjectEntityId,
        relatedIds: [fact.id],
        message: 'Fact belongs to another world',
        evidence: [],
      });
    }
    if (impact.affectedBuiltinRules.has('BROKEN_REFERENCE')) {
      if (!entityMap.has(fact.subjectEntityId)) {
        add({
          ruleCode: 'BROKEN_REFERENCE',
          severity: 'blocker',
          subjectId: fact.id,
          relatedIds: [fact.subjectEntityId],
          message: 'Fact subject does not exist',
          evidence: [],
        });
      }
      if (fact.objectKind === 'entity' && (!fact.objectEntityId || !entityMap.has(fact.objectEntityId))) {
        add({
          ruleCode: 'BROKEN_REFERENCE',
          severity: 'blocker',
          subjectId: fact.id,
          relatedIds: fact.objectEntityId ? [fact.objectEntityId] : [],
          message: 'Fact target entity does not exist',
          evidence: [],
        });
      }
    }
    if (impact.affectedBuiltinRules.has('TEMPORAL_FIELD_OVERLAP') && fact.validFromTick !== undefined && fact.validToTick !== undefined && fact.validFromTick >= fact.validToTick) {
      add({
        ruleCode: 'TEMPORAL_FIELD_OVERLAP',
        severity: 'blocker',
        subjectId: fact.id,
        relatedIds: [],
        message: 'Fact range must be non-empty',
        evidence: [],
      });
    }
  }

  // 3. BIRTH_AFTER_DEATH for impacted entities
  if (impact.affectedBuiltinRules.has('BIRTH_AFTER_DEATH')) {
    for (const entityId of impact.impactedEntityIds) {
      const birthTick = birth.get(entityId);
      const deathTick = death.get(entityId);
      if (birthTick !== undefined && deathTick !== undefined && birthTick >= deathTick) {
        add({
          ruleCode: 'BIRTH_AFTER_DEATH',
          severity: 'blocker',
          subjectId: entityId,
          relatedIds: [],
          message: 'Birth must precede death',
          evidence: [birthTick.toString(), deathTick.toString()],
        });
      }
    }
  }

  // 4. Overlapping temporal facts & location conflicts for impacted entities
  if (impact.affectedBuiltinRules.has('TEMPORAL_FIELD_OVERLAP') || impact.affectedBuiltinRules.has('LOCATION_CONFLICT')) {
    const grouped = new Map<string, Fact[]>();
    for (const fact of canonFacts) {
      if (!impact.impactedEntityIds.has(fact.subjectEntityId)) continue;
      const key = `${fact.subjectEntityId}:${fact.predicateKey}`;
      const list = grouped.get(key) ?? [];
      list.push(fact);
      grouped.set(key, list);
    }

    if (impact.affectedBuiltinRules.has('TEMPORAL_FIELD_OVERLAP')) {
      for (const facts of grouped.values()) {
        let longest: Fact | undefined;
        for (const fact of sortByRangeStart(facts)) {
          if (longest && factsTemporallyConflict(longest, fact)) {
            add({
              ruleCode: 'TEMPORAL_FIELD_OVERLAP',
              severity: 'error',
              subjectId: fact.subjectEntityId,
              relatedIds: [longest.id, fact.id],
              message: `Temporal facts overlap for ${fact.predicateKey}`,
              evidence: [],
            });
          }
          if (!longest || rangeEnd(fact) > rangeEnd(longest)) longest = fact;
        }
      }
    }

    if (impact.affectedBuiltinRules.has('LOCATION_CONFLICT')) {
      for (const facts of grouped.values()) {
        const locationFacts = facts.filter((fact) => fact.predicateKey === 'location' && fact.objectKind === 'entity' && fact.objectEntityId);
        let longestLocation: { fact: Fact; locationId: string; end: bigint } | undefined;
        let secondLongestLocation: { fact: Fact; locationId: string; end: bigint } | undefined;
        for (const fact of sortByRangeStart(locationFacts)) {
          const locationId = fact.objectEntityId as string;
          const otherLocation = longestLocation?.locationId === locationId ? secondLongestLocation : longestLocation;
          if (otherLocation && factsTemporallyConflict(otherLocation.fact, fact)) {
            add({
              ruleCode: 'LOCATION_CONFLICT',
              severity: 'error',
              subjectId: fact.subjectEntityId,
              relatedIds: [otherLocation.fact.id, fact.id, otherLocation.locationId, locationId],
              message: 'An entity has two different locations during overlapping time ranges',
              evidence: [],
            });
          }
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
          if (longestLocation && secondLongestLocation && secondLongestLocation.end > longestLocation.end) {
            [longestLocation, secondLongestLocation] = [secondLongestLocation, longestLocation];
          }
        }
      }
    }
  }

  // 5. Relations validation
  if (impact.impactedRelationIds.size > 0) {
    for (const relation of canonRelations) {
      if (!impact.impactedRelationIds.has(relation.id)) continue;
      const relationType = relationTypeMap.get(relation.relationTypeId);

      if (impact.affectedBuiltinRules.has('INVALID_RELATION')) {
        if (!relationType) {
          add({
            ruleCode: 'INVALID_RELATION',
            severity: 'blocker',
            subjectId: relation.id,
            relatedIds: [relation.relationTypeId],
            message: 'Relation type does not exist',
            evidence: [],
          });
        }
        if (!entityMap.has(relation.sourceEntityId) || !entityMap.has(relation.targetEntityId)) {
          add({
            ruleCode: 'BROKEN_REFERENCE',
            severity: 'blocker',
            subjectId: relation.id,
            relatedIds: [relation.sourceEntityId, relation.targetEntityId],
            message: 'Relation endpoint does not exist',
            evidence: [],
          });
        }
        if (relation.sourceEntityId === relation.targetEntityId) {
          add({
            ruleCode: 'INVALID_RELATION',
            severity: 'error',
            subjectId: relation.id,
            relatedIds: [relation.sourceEntityId],
            message: 'Relation cannot target itself',
            evidence: [],
          });
        }
        const source = entityMap.get(relation.sourceEntityId);
        const target = entityMap.get(relation.targetEntityId);
        if (relationType && source && target && relationType.sourceTypeIds.length && !relationType.sourceTypeIds.includes(source.typeId)) {
          add({
            ruleCode: 'INVALID_RELATION',
            severity: 'error',
            subjectId: relation.id,
            relatedIds: [source.id, relation.relationTypeId],
            message: 'Source entity type is not allowed',
            evidence: [source.typeId],
          });
        }
        if (relationType && source && target && relationType.targetTypeIds.length && !relationType.targetTypeIds.includes(target.typeId)) {
          add({
            ruleCode: 'INVALID_RELATION',
            severity: 'error',
            subjectId: relation.id,
            relatedIds: [target.id, relation.relationTypeId],
            message: 'Target entity type is not allowed',
            evidence: [target.typeId],
          });
        }
        if (relation.validFromTick !== undefined && relation.validToTick !== undefined && relation.validFromTick >= relation.validToTick) {
          add({
            ruleCode: 'TEMPORAL_RELATION_OVERLAP',
            severity: 'blocker',
            subjectId: relation.id,
            relatedIds: [],
            message: 'Relation range must be non-empty',
            evidence: [],
          });
        }
      }

      if (impact.affectedBuiltinRules.has('ASYMMETRIC_RELATION') && relationType?.symmetric) {
        if (relation.sourceEntityId > relation.targetEntityId) {
          add({
            ruleCode: 'ASYMMETRIC_RELATION',
            severity: 'error',
            subjectId: relation.id,
            relatedIds: [relation.sourceEntityId, relation.targetEntityId, relation.relationTypeId],
            message: 'Symmetric relation endpoints must be stored in canonical order',
            evidence: [relationType.forwardLabel, relationType.inverseLabel],
          });
        }
      }

      if (impact.affectedBuiltinRules.has('PARENT_AGE')) {
        const forwardLabel = relationType?.forwardLabel.toLocaleLowerCase() ?? '';
        const inverseLabel = relationType?.inverseLabel.toLocaleLowerCase() ?? '';
        const sourceIsParent = /(parent|father|mother)/.test(forwardLabel);
        const targetIsParent = !sourceIsParent && /(parent|father|mother)/.test(inverseLabel);
        if (sourceIsParent || targetIsParent) {
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
      }
    }

    if (impact.affectedBuiltinRules.has('TEMPORAL_RELATION_OVERLAP')) {
      const relationGroups = new Map<string, Relation[]>();
      for (const relation of canonRelations) {
        if (!impact.impactedEntityIds.has(relation.sourceEntityId) && !impact.impactedEntityIds.has(relation.targetEntityId)) continue;
        const key = `${relation.sourceEntityId}:${relation.targetEntityId}:${relation.relationTypeId}`;
        const list = relationGroups.get(key) ?? [];
        list.push(relation);
        relationGroups.set(key, list);
      }
      for (const relations of relationGroups.values()) {
        let longest: Relation | undefined;
        for (const relation of sortByRangeStart(relations)) {
          if (longest && temporalRecordsConflict(longest, relation)) {
            add({
              ruleCode: 'TEMPORAL_RELATION_OVERLAP',
              severity: 'error',
              subjectId: relation.id,
              relatedIds: [longest.id, relation.id],
              message: 'Temporal relations overlap for the same endpoints and relation type',
              evidence: [],
            });
          }
          if (!longest || rangeEnd(relation) > rangeEnd(longest)) longest = relation;
        }
      }
    }
  }

  // 6. Events validation
  if (impact.impactedEventIds.size > 0) {
    const eventMap = new Map(
      canonEvents.filter((event) => event.worldId === context.world.id).map((event) => [event.id, event])
    );

    for (const event of canonEvents) {
      if (!impact.impactedEventIds.has(event.id)) continue;

      if (impact.affectedBuiltinRules.has('MISSING_REQUIRED_ROLE')) {
        const participants = event.participantRoles ?? event.participantIds.map((entityId) => ({ entityId, role: 'participant' }));
        const participantRoles = new Set(participants.map((participant) => participant.role));
        for (const requiredRole of event.requiredRoles ?? []) {
          if (!participantRoles.has(requiredRole)) {
            add({
              ruleCode: 'MISSING_REQUIRED_ROLE',
              severity: 'blocker',
              subjectId: event.id,
              relatedIds: event.participantIds,
              eventId: event.id,
              message: `Event is missing required participant role ${requiredRole}`,
              evidence: [requiredRole],
            });
          }
        }
      }

      if (impact.affectedBuiltinRules.has('EVENT_BEFORE_BIRTH') || impact.affectedBuiltinRules.has('EVENT_AFTER_DEATH')) {
        for (const participantId of event.participantIds) {
          const birthTick = birth.get(participantId);
          const deathTick = death.get(participantId);
          if (impact.affectedBuiltinRules.has('EVENT_BEFORE_BIRTH') && birthTick !== undefined && event.startTick < birthTick) {
            add({
              ruleCode: 'EVENT_BEFORE_BIRTH',
              severity: 'blocker',
              subjectId: participantId,
              relatedIds: [],
              eventId: event.id,
              message: 'Entity participates before birth',
              evidence: [event.startTick.toString(), birthTick.toString()],
            });
          }
          if (impact.affectedBuiltinRules.has('EVENT_AFTER_DEATH')) {
            if (deathTick !== undefined && event.startTick >= deathTick) {
              add({
                ruleCode: 'EVENT_AFTER_DEATH',
                severity: 'blocker',
                subjectId: participantId,
                relatedIds: [],
                eventId: event.id,
                message: 'Entity participates after death',
                evidence: [event.startTick.toString(), deathTick.toString()],
              });
            }
            if (deathTick !== undefined && event.endTick !== undefined && event.endTick > deathTick) {
              add({
                ruleCode: 'EVENT_AFTER_DEATH',
                severity: 'blocker',
                subjectId: participantId,
                relatedIds: [],
                eventId: event.id,
                message: 'Entity participates after death during an event span',
                evidence: [event.endTick.toString(), deathTick.toString()],
              });
            }
          }
        }
      }

      if (impact.affectedBuiltinRules.has('TIMELINE_ORDER')) {
        if (event.endTick !== undefined && event.endTick < event.startTick) {
          add({
            ruleCode: 'TIMELINE_ORDER',
            severity: 'blocker',
            eventId: event.id,
            relatedIds: [],
            message: 'Event end precedes start',
            evidence: [],
          });
        }
        const causalLinks = event.causalLinks ?? [];
        const causalTargetIds = causalLinks.map((link) => link.targetEventId);
        for (const linkedId of [...event.causeEventIds, ...event.resultEventIds, ...causalTargetIds]) {
          if (!eventMap.has(linkedId)) {
            add({
              ruleCode: 'BROKEN_REFERENCE',
              severity: 'blocker',
              subjectId: event.id,
              relatedIds: [linkedId],
              eventId: event.id,
              message: 'Event link target does not exist',
              evidence: [],
            });
          }
        }
        for (const causeId of event.causeEventIds) {
          const cause = eventMap.get(causeId);
          if (cause && cause.startTick > event.startTick) {
            add({
              ruleCode: 'TIMELINE_ORDER',
              severity: 'blocker',
              subjectId: event.id,
              relatedIds: [cause.id],
              eventId: event.id,
              message: 'Cause event must not start after its result event',
              evidence: [cause.startTick.toString(), event.startTick.toString()],
            });
          }
        }
        for (const resultId of event.resultEventIds) {
          const result = eventMap.get(resultId);
          if (result && result.startTick < event.startTick) {
            add({
              ruleCode: 'TIMELINE_ORDER',
              severity: 'blocker',
              subjectId: event.id,
              relatedIds: [result.id],
              eventId: event.id,
              message: 'Result event must not start before its cause event',
              evidence: [event.startTick.toString(), result.startTick.toString()],
            });
          }
        }
        for (const link of causalLinks) {
          const target = eventMap.get(link.targetEventId);
          if (['causes', 'triggers', 'results_in'].includes(link.kind)) {
            if (target && event.startTick > target.startTick) {
              add({
                ruleCode: 'TIMELINE_ORDER',
                severity: 'blocker',
                subjectId: event.id,
                relatedIds: [target.id],
                eventId: event.id,
                message: 'Cause event must not start after its result event',
                evidence: [event.startTick.toString(), target.startTick.toString()],
              });
            }
          }
          if (['prevents', 'contradicts'].includes(link.kind)) {
            if (target) {
              add({
                ruleCode: 'CONTRADICTING_EVENTS',
                severity: 'blocker',
                subjectId: event.id,
                relatedIds: [target.id],
                eventId: event.id,
                message: 'Contradicting or prevented events cannot both be canon',
                evidence: [link.kind],
              });
            }
          }
        }
      }
    }
  }

  // 7. Custom DSL rules evaluation (only affected custom rules)
  for (const rule of impact.affectedCustomRules) {
    const customIssues = evaluateRule(rule, context);
    // Include issues that pertain to the impacted entities/relations/events
    for (const issue of customIssues) {
      if (!issue.subjectId || impact.impactedEntityIds.has(issue.subjectId) || impact.impactedRelationIds.has(issue.subjectId) || impact.impactedEventIds.has(issue.subjectId)) {
        issues.push(issue);
      }
    }
  }

  return {
    issues,
    affectedRuleCodes: impact.affectedRuleCodes,
    skippedRuleCodes: impact.skippedRuleCodes,
    impactedEntityIds: [...impact.impactedEntityIds],
    isIncremental: true,
  };
}
