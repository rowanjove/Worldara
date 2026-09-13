import type { RuleCondition, RuleDependency, ValidationRule } from '@world-codex/domain';

export const BUILTIN_RULE_CODES = [
  'WORLD_ACCESS_DENIED',
  'INVALID_ENTITY_TYPE',
  'ENTITY_REQUIRED_FIELD',
  'BROKEN_REFERENCE',
  'INVALID_ENTITY_SCHEMA',
  'ENTITY_FIELD_INVALID',
  'COMPUTED_FIELD_WRITE',
  'TEMPORAL_FIELD_OVERLAP',
  'INVALID_RELATION',
  'ASYMMETRIC_RELATION',
  'BIRTH_AFTER_DEATH',
  'MISSING_REQUIRED_ROLE',
  'EVENT_BEFORE_BIRTH',
  'EVENT_AFTER_DEATH',
  'TIMELINE_ORDER',
  'LOCATION_CONFLICT',
  'PARENT_AGE',
  'TEMPORAL_RELATION_OVERLAP',
  'WORLD_RULE_VIOLATION',
] as const;

export type BuiltinRuleCode = (typeof BUILTIN_RULE_CODES)[number];

export const BUILTIN_RULE_DEPENDENCIES: Record<BuiltinRuleCode, RuleDependency> = {
  WORLD_ACCESS_DENIED: {
    ruleCode: 'WORLD_ACCESS_DENIED',
    touchesEntities: true,
    touchesRelations: true,
    touchesEvents: true,
  },
  INVALID_ENTITY_TYPE: {
    ruleCode: 'INVALID_ENTITY_TYPE',
    touchesEntities: true,
  },
  ENTITY_REQUIRED_FIELD: {
    ruleCode: 'ENTITY_REQUIRED_FIELD',
    touchesEntities: true,
  },
  BROKEN_REFERENCE: {
    ruleCode: 'BROKEN_REFERENCE',
    touchesEntities: true,
    touchesRelations: true,
    touchesEvents: true,
  },
  INVALID_ENTITY_SCHEMA: {
    ruleCode: 'INVALID_ENTITY_SCHEMA',
    touchesEntities: true,
  },
  ENTITY_FIELD_INVALID: {
    ruleCode: 'ENTITY_FIELD_INVALID',
    touchesEntities: true,
  },
  COMPUTED_FIELD_WRITE: {
    ruleCode: 'COMPUTED_FIELD_WRITE',
    touchesEntities: true,
  },
  TEMPORAL_FIELD_OVERLAP: {
    ruleCode: 'TEMPORAL_FIELD_OVERLAP',
    predicates: ['birth_tick', 'death_tick'],
  },
  INVALID_RELATION: {
    ruleCode: 'INVALID_RELATION',
    touchesRelations: true,
  },
  ASYMMETRIC_RELATION: {
    ruleCode: 'ASYMMETRIC_RELATION',
    touchesRelations: true,
  },
  BIRTH_AFTER_DEATH: {
    ruleCode: 'BIRTH_AFTER_DEATH',
    predicates: ['birth_tick', 'death_tick'],
  },
  MISSING_REQUIRED_ROLE: {
    ruleCode: 'MISSING_REQUIRED_ROLE',
    touchesEvents: true,
  },
  EVENT_BEFORE_BIRTH: {
    ruleCode: 'EVENT_BEFORE_BIRTH',
    touchesEvents: true,
    predicates: ['birth_tick'],
  },
  EVENT_AFTER_DEATH: {
    ruleCode: 'EVENT_AFTER_DEATH',
    touchesEvents: true,
    predicates: ['death_tick'],
  },
  TIMELINE_ORDER: {
    ruleCode: 'TIMELINE_ORDER',
    touchesEvents: true,
  },
  LOCATION_CONFLICT: {
    ruleCode: 'LOCATION_CONFLICT',
    predicates: ['location'],
  },
  PARENT_AGE: {
    ruleCode: 'PARENT_AGE',
    touchesRelations: true,
    predicates: ['birth_tick'],
  },
  TEMPORAL_RELATION_OVERLAP: {
    ruleCode: 'TEMPORAL_RELATION_OVERLAP',
    touchesRelations: true,
  },
  WORLD_RULE_VIOLATION: {
    ruleCode: 'WORLD_RULE_VIOLATION',
    predicates: ['birth_tick', 'death_tick'],
  },
};

export function extractCustomRuleDependencies(rule: ValidationRule): RuleDependency {
  const predicates = new Set<string>();
  const entityTypes = new Set<string>();
  const relationTypeIds = new Set<string>();
  let touchesRelations = rule.target === 'relation';
  let touchesEvents = rule.target === 'event';
  const touchesEntities = rule.target === 'entity';

  if (rule.targetSelector?.typeId) entityTypes.add(rule.targetSelector.typeId);
  if (rule.targetSelector?.typeKey) entityTypes.add(rule.targetSelector.typeKey);
  if (rule.targetSelector?.predicateKey) predicates.add(rule.targetSelector.predicateKey);
  if (rule.targetSelector?.relationTypeId) relationTypeIds.add(rule.targetSelector.relationTypeId);

  const traverse = (condition?: RuleCondition): void => {
    if (!condition) return;
    if ('all' in condition) {
      for (const child of condition.all) traverse(child);
    } else if ('any' in condition) {
      for (const child of condition.any) traverse(child);
    } else if ('not' in condition) {
      traverse(condition.not);
    } else if ('fact' in condition) {
      predicates.add(condition.fact);
    } else if ('duration_between' in condition) {
      const from = condition.duration_between.from;
      const to = condition.duration_between.to;
      if (from.startsWith('fact:')) predicates.add(from.slice(5));
      else predicates.add(from);
      if (to.startsWith('fact:')) predicates.add(to.slice(5));
      else predicates.add(to);
    } else if ('relation_exists' in condition) {
      touchesRelations = true;
      if (condition.relation_exists.relationTypeId) {
        relationTypeIds.add(condition.relation_exists.relationTypeId);
      }
    } else if ('count' in condition) {
      if (condition.count.target === 'relations') touchesRelations = true;
      if (condition.count.target === 'events' || condition.count.target === 'participants') touchesEvents = true;
      if (condition.count.where) traverse(condition.count.where);
    }
  };

  traverse(rule.when);
  traverse(rule.assert);

  return {
    ruleCode: rule.id,
    targetKinds: [rule.target],
    predicates: predicates.size ? [...predicates] : undefined,
    entityTypes: entityTypes.size ? [...entityTypes] : undefined,
    relationTypeIds: relationTypeIds.size ? [...relationTypeIds] : undefined,
    touchesEntities,
    touchesRelations,
    touchesEvents,
  };
}
