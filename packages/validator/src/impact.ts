import type { ChangeSet, RuleDependency, ValidationRule } from '@world-codex/domain';
import type { ValidationContext } from './index';
import {
  BUILTIN_RULE_CODES,
  BUILTIN_RULE_DEPENDENCIES,
  extractCustomRuleDependencies,
  type BuiltinRuleCode,
} from './dependencies';

export interface ImpactAnalysisResult {
  focalEntityIds: Set<string>;
  impactedEntityIds: Set<string>;
  impactedRelationIds: Set<string>;
  impactedEventIds: Set<string>;
  affectedPredicates: Set<string>;
  affectedBuiltinRules: Set<BuiltinRuleCode>;
  affectedCustomRules: ValidationRule[];
  affectedRuleCodes: string[];
  skippedRuleCodes: string[];
}

export function analyzeImpact(
  context: ValidationContext,
  changeSet: ChangeSet,
  customRules?: ValidationRule[]
): ImpactAnalysisResult {
  const focalEntityIds = new Set<string>(changeSet.entityIds ?? []);
  const impactedEntityIds = new Set<string>(focalEntityIds);
  const impactedRelationIds = new Set<string>(changeSet.relationIds ?? []);
  const impactedEventIds = new Set<string>(changeSet.eventIds ?? []);
  const affectedPredicates = new Set<string>(changeSet.predicates ?? []);

  const changedFactIds = new Set<string>(changeSet.factIds ?? []);
  const changedRelationTypeIds = new Set<string>(changeSet.relationTypeIds ?? []);

  // 1. Gather facts matching changeSet
  for (const fact of context.facts) {
    if (changedFactIds.has(fact.id) || (focalEntityIds.has(fact.subjectEntityId) && affectedPredicates.size === 0)) {
      focalEntityIds.add(fact.subjectEntityId);
      impactedEntityIds.add(fact.subjectEntityId);
      affectedPredicates.add(fact.predicateKey);
      if (fact.objectKind === 'entity' && fact.objectEntityId) {
        impactedEntityIds.add(fact.objectEntityId);
      }
    } else if (affectedPredicates.has(fact.predicateKey) && focalEntityIds.has(fact.subjectEntityId)) {
      impactedEntityIds.add(fact.subjectEntityId);
    }
  }

  // 2. Gather relations matching changeSet or connected to focal entities
  for (const relation of context.relations) {
    const isDirectMatch = impactedRelationIds.has(relation.id) ||
      (changedRelationTypeIds.size > 0 && changedRelationTypeIds.has(relation.relationTypeId));
    const isEndpointMatch = focalEntityIds.has(relation.sourceEntityId) || focalEntityIds.has(relation.targetEntityId);

    if (isDirectMatch || isEndpointMatch) {
      impactedRelationIds.add(relation.id);
      impactedEntityIds.add(relation.sourceEntityId);
      impactedEntityIds.add(relation.targetEntityId);
    }
  }

  // 3. Gather events matching changeSet or involving focal entities
  for (const event of context.events) {
    const isDirectMatch = impactedEventIds.has(event.id);
    const hasParticipant = event.participantIds.some((id) => focalEntityIds.has(id));

    if (isDirectMatch || hasParticipant) {
      impactedEventIds.add(event.id);
      for (const pId of event.participantIds) {
        impactedEntityIds.add(pId);
      }
    }
  }

  // Determine flags for built-in rule matching
  const hasEntityChange = Boolean(changeSet.entityIds?.length);
  const hasRelationChange = Boolean(
    changeSet.relationIds?.length ||
    changeSet.relationTypeIds?.length ||
    impactedRelationIds.size > 0
  );
  const hasEventChange = Boolean(
    changeSet.eventIds?.length ||
    impactedEventIds.size > 0
  );
  const hasBirthChange = affectedPredicates.has('birth_tick');
  const hasDeathChange = affectedPredicates.has('death_tick');
  const hasLocationChange = affectedPredicates.has('location');

  const affectedBuiltinRules = new Set<BuiltinRuleCode>();

  for (const code of BUILTIN_RULE_CODES) {
    const dep: RuleDependency = BUILTIN_RULE_DEPENDENCIES[code];

    let isAffected = false;

    switch (code) {
      case 'INVALID_ENTITY_TYPE':
      case 'ENTITY_REQUIRED_FIELD':
      case 'INVALID_ENTITY_SCHEMA':
      case 'ENTITY_FIELD_INVALID':
      case 'COMPUTED_FIELD_WRITE':
        isAffected = hasEntityChange;
        break;

      case 'BROKEN_REFERENCE':
      case 'WORLD_ACCESS_DENIED':
        isAffected = hasEntityChange || hasRelationChange || hasEventChange || changedFactIds.size > 0;
        break;

      case 'BIRTH_AFTER_DEATH':
        isAffected = hasBirthChange || hasDeathChange;
        break;

      case 'TEMPORAL_FIELD_OVERLAP':
        isAffected = hasBirthChange || hasDeathChange || changedFactIds.size > 0 || (affectedPredicates.size > 0 && !hasBirthChange && !hasDeathChange && !hasLocationChange);
        break;

      case 'LOCATION_CONFLICT':
        isAffected = hasLocationChange;
        break;

      case 'MISSING_REQUIRED_ROLE':
      case 'TIMELINE_ORDER':
        isAffected = Boolean(changeSet.eventIds?.length);
        break;

      case 'EVENT_BEFORE_BIRTH':
        isAffected = Boolean(changeSet.eventIds?.length) || (hasBirthChange && hasEventChange);
        break;

      case 'EVENT_AFTER_DEATH':
        isAffected = Boolean(changeSet.eventIds?.length) || (hasDeathChange && hasEventChange);
        break;

      case 'PARENT_AGE':
        isAffected = Boolean(changeSet.relationIds?.length || changeSet.relationTypeIds?.length) || (hasBirthChange && hasRelationChange);
        break;

      case 'INVALID_RELATION':
      case 'ASYMMETRIC_RELATION':
      case 'TEMPORAL_RELATION_OVERLAP':
        isAffected = Boolean(changeSet.relationIds?.length || changeSet.relationTypeIds?.length);
        break;

      case 'WORLD_RULE_VIOLATION':
        isAffected = hasBirthChange || hasDeathChange;
        break;

      default:
        isAffected = true;
    }

    if (isAffected) {
      affectedBuiltinRules.add(code);
    }
  }

  // 4. Custom rules analysis
  const allCustomRules = customRules ?? context.rules ?? [];
  const affectedCustomRules: ValidationRule[] = [];

  for (const rule of allCustomRules) {
    if (!rule.enabled) continue;
    const dep = extractCustomRuleDependencies(rule);

    let ruleAffected = false;

    if (changeSet.ruleIds?.includes(rule.id)) {
      ruleAffected = true;
    } else {
      const hasMatchingPredicate = Boolean(dep.predicates?.some((p) => affectedPredicates.has(p)));
      const hasNoSpecificPredicate = !dep.predicates || dep.predicates.length === 0;

      if (dep.targetKinds?.includes('entity')) {
        if (hasMatchingPredicate) {
          ruleAffected = true;
        } else if (hasNoSpecificPredicate && hasEntityChange) {
          ruleAffected = true;
        }
      } else if (dep.targetKinds?.includes('relation')) {
        if (hasMatchingPredicate || hasRelationChange) {
          ruleAffected = true;
        }
      } else if (dep.targetKinds?.includes('event')) {
        if (hasMatchingPredicate || hasEventChange) {
          ruleAffected = true;
        }
      }
    }

    if (ruleAffected) {
      affectedCustomRules.push(rule);
    }
  }

  const affectedRuleCodes: string[] = [
    ...affectedBuiltinRules,
    ...affectedCustomRules.map((r) => r.id),
  ];

  const allKnownRuleCodes = [
    ...BUILTIN_RULE_CODES,
    ...allCustomRules.map((r) => r.id),
  ];

  const affectedSet = new Set(affectedRuleCodes);
  const skippedRuleCodes = allKnownRuleCodes.filter((code) => !affectedSet.has(code));

  return {
    focalEntityIds,
    impactedEntityIds,
    impactedRelationIds,
    impactedEventIds,
    affectedPredicates,
    affectedBuiltinRules,
    affectedCustomRules,
    affectedRuleCodes,
    skippedRuleCodes,
  };
}
