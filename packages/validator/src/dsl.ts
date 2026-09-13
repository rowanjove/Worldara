import type {
  Entity,
  Fact,
  Relation,
  RuleCondition,
  RuleTargetKind,
  ValidationIssue,
  ValidationRule,
  WorldEvent,
} from '@world-codex/domain';
import type { ValidationContext } from './index';

export interface EvaluateRuleOptions {
  includeDrafts?: boolean;
}

const filterCanon = <T extends { canonStatus?: string }>(items: T[]): T[] =>
  items.filter((item) => item.canonStatus === 'canon' || item.canonStatus === 'pending');

const filterAllActive = <T extends { canonStatus?: string }>(items: T[]): T[] =>
  items.filter((item) => item.canonStatus !== 'retconned');

function getFilter(options?: EvaluateRuleOptions) {
  return options?.includeDrafts ? filterAllActive : filterCanon;
}

function parseNumeric(val: unknown): bigint | number | null {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return Number.isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^-?\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed);
      } catch {
        return null;
      }
    }
    const num = Number(trimmed);
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

function compareValues(actual: unknown, expected: unknown, operator: 'equals' | 'not_equals' | 'lt' | 'lte' | 'gt' | 'gte'): boolean {
  if (operator === 'equals' || operator === 'not_equals') {
    let eq = false;
    if (actual === expected) {
      eq = true;
    } else {
      const actNum = parseNumeric(actual);
      const expNum = parseNumeric(expected);
      if (actNum !== null && expNum !== null) {
        if (typeof actNum === 'bigint' && typeof expNum === 'bigint') eq = actNum === expNum;
        else eq = Number(actNum) === Number(expNum);
      } else {
        eq = String(actual ?? '').trim() === String(expected ?? '').trim();
      }
    }
    return operator === 'equals' ? eq : !eq;
  }

  const aNum = parseNumeric(actual);
  const bNum = parseNumeric(expected);
  if (aNum === null || bNum === null) return false;

  let comp = 0;
  if (typeof aNum === 'bigint' && typeof bNum === 'bigint') {
    comp = aNum < bNum ? -1 : aNum > bNum ? 1 : 0;
  } else {
    const nA = Number(aNum);
    const nB = Number(bNum);
    comp = nA < nB ? -1 : nA > nB ? 1 : 0;
  }

  switch (operator) {
    case 'lt':
      return comp < 0;
    case 'lte':
      return comp <= 0;
    case 'gt':
      return comp > 0;
    case 'gte':
      return comp >= 0;
  }
}

function resolveValue(targetKind: RuleTargetKind, item: unknown, key: string, isFact: boolean, context: ValidationContext, options?: EvaluateRuleOptions): unknown {
  if (!item || typeof item !== 'object') return undefined;
  const record = item as Record<string, unknown>;
  const filter = getFilter(options);

  if (isFact) {
    if (targetKind === 'entity') {
      const entityId = String(record.id);
      const foundFact = filter(context.facts).find(
        (f) => f.subjectEntityId === entityId && f.predicateKey === key
      );
      if (!foundFact) return undefined;
      return foundFact.objectKind === 'entity' ? foundFact.objectEntityId : foundFact.value;
    }
    if (targetKind === 'fact') {
      if (record.predicateKey === key) {
        return record.objectKind === 'entity' ? record.objectEntityId : record.value;
      }
      return undefined;
    }
  }

  // Nested property access, e.g. "document.age"
  if (key.includes('.')) {
    const parts = key.split('.');
    let cur: unknown = record;
    for (const part of parts) {
      if (part === '__proto__' || part === 'prototype' || part === 'constructor') return undefined;
      if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  if (key in record) {
    return record[key];
  }

  if (targetKind === 'entity') {
    // Check typeKey on entity
    if (key === 'typeKey') {
      const type = context.entityTypes.find((t) => t.id === record.typeId);
      return type?.typeKey;
    }
    // Check document property
    if (record.document && typeof record.document === 'object' && key in (record.document as Record<string, unknown>)) {
      return (record.document as Record<string, unknown>)[key];
    }
    // Fallback: check facts of entity
    const entityId = String(record.id);
    const foundFact = filter(context.facts).find(
      (f) => f.subjectEntityId === entityId && f.predicateKey === key
    );
    if (foundFact) {
      return foundFact.objectKind === 'entity' ? foundFact.objectEntityId : foundFact.value;
    }
  }

  if (targetKind === 'relation') {
    if (key === 'forwardLabel' || key === 'inverseLabel') {
      const type = context.relationTypes.find((t) => t.id === record.relationTypeId);
      return type ? type[key] : undefined;
    }
  }

  return undefined;
}

export function evaluateCondition(
  condition: RuleCondition,
  context: ValidationContext,
  item: unknown,
  targetKind: RuleTargetKind,
  options?: EvaluateRuleOptions
): boolean {
  if ('all' in condition) {
    return condition.all.every((sub) => evaluateCondition(sub, context, item, targetKind, options));
  }
  if ('any' in condition) {
    return condition.any.some((sub) => evaluateCondition(sub, context, item, targetKind, options));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, context, item, targetKind, options);
  }

  const filter = getFilter(options);

  if ('field' in condition) {
    const val = resolveValue(targetKind, item, condition.field, false, context, options);
    if ('exists' in condition) return (val !== undefined && val !== null) === condition.exists;
    if ('not_exists' in condition) return (val === undefined || val === null) === condition.not_exists;
    if ('equals' in condition) return compareValues(val, condition.equals, 'equals');
    if ('not_equals' in condition) return compareValues(val, condition.not_equals, 'not_equals');
    if ('lt' in condition) return compareValues(val, condition.lt, 'lt');
    if ('lte' in condition) return compareValues(val, condition.lte, 'lte');
    if ('gt' in condition) return compareValues(val, condition.gt, 'gt');
    if ('gte' in condition) return compareValues(val, condition.gte, 'gte');
    return false;
  }

  if ('fact' in condition) {
    const val = resolveValue(targetKind, item, condition.fact, true, context, options);
    if ('exists' in condition) return (val !== undefined && val !== null) === condition.exists;
    if ('not_exists' in condition) return (val === undefined || val === null) === condition.not_exists;
    if ('equals' in condition) return compareValues(val, condition.equals, 'equals');
    if ('not_equals' in condition) return compareValues(val, condition.not_equals, 'not_equals');
    if ('lt' in condition) return compareValues(val, condition.lt, 'lt');
    if ('lte' in condition) return compareValues(val, condition.lte, 'lte');
    if ('gt' in condition) return compareValues(val, condition.gt, 'gt');
    if ('gte' in condition) return compareValues(val, condition.gte, 'gte');
    return false;
  }

  if ('count' in condition) {
    const { target, where, equals, not_equals, lt, lte, gt, gte } = condition.count;
    const record = item as Record<string, unknown>;
    const itemId = String(record?.id ?? '');
    let count = 0;

    if (target === 'facts') {
      const facts = filter(context.facts).filter((f) => f.subjectEntityId === itemId);
      count = where ? facts.filter((f) => evaluateCondition(where, context, f, 'fact', options)).length : facts.length;
    } else if (target === 'relations') {
      const relations = filter(context.relations).filter(
        (r) => r.sourceEntityId === itemId || r.targetEntityId === itemId
      );
      count = where ? relations.filter((r) => evaluateCondition(where, context, r, 'relation', options)).length : relations.length;
    } else if (target === 'events') {
      const events = filter(context.events).filter((e) => e.participantIds.includes(itemId));
      count = where ? events.filter((e) => evaluateCondition(where, context, e, 'event', options)).length : events.length;
    } else if (target === 'participants') {
      const pIds = Array.isArray(record?.participantIds) ? (record.participantIds as string[]) : [];
      count = pIds.length;
    }

    if (equals !== undefined && count !== equals) return false;
    if (not_equals !== undefined && count === not_equals) return false;
    if (lt !== undefined && count >= lt) return false;
    if (lte !== undefined && count > lte) return false;
    if (gt !== undefined && count <= gt) return false;
    if (gte !== undefined && count < gte) return false;
    return true;
  }

  if ('duration_between' in condition) {
    const { from, to, equals, not_equals, lt, lte, gt, gte } = condition.duration_between;
    const fromVal = resolveValue(targetKind, item, from, false, context, options);
    const toVal = resolveValue(targetKind, item, to, false, context, options);
    const start = parseNumeric(fromVal);
    const end = parseNumeric(toVal);

    if (start === null || end === null) {
      // If either endpoint is missing, there's no defined span to violate upper bound
      return true;
    }

    const duration = typeof start === 'bigint' && typeof end === 'bigint'
      ? end - start
      : BigInt(Math.floor(Number(end) - Number(start)));

    if (equals !== undefined && !compareValues(duration, equals, 'equals')) return false;
    if (not_equals !== undefined && !compareValues(duration, not_equals, 'not_equals')) return false;
    if (lt !== undefined && !compareValues(duration, lt, 'lt')) return false;
    if (lte !== undefined && !compareValues(duration, lte, 'lte')) return false;
    if (gt !== undefined && !compareValues(duration, gt, 'gt')) return false;
    if (gte !== undefined && !compareValues(duration, gte, 'gte')) return false;
    return true;
  }

  if ('relation_exists' in condition) {
    const { relationTypeId, forwardLabel, targetEntityId, direction = 'outgoing' } = condition.relation_exists;
    const record = item as Record<string, unknown>;
    const entityId = String(record?.id ?? '');

    const matching = filter(context.relations).filter((rel) => {
      if (direction === 'outgoing' && rel.sourceEntityId !== entityId) return false;
      if (direction === 'incoming' && rel.targetEntityId !== entityId) return false;
      if (direction === 'both' && rel.sourceEntityId !== entityId && rel.targetEntityId !== entityId) return false;

      if (relationTypeId && rel.relationTypeId !== relationTypeId) return false;
      if (targetEntityId) {
        const otherId = rel.sourceEntityId === entityId ? rel.targetEntityId : rel.sourceEntityId;
        if (otherId !== targetEntityId) return false;
      }
      if (forwardLabel) {
        const type = context.relationTypes.find((t) => t.id === rel.relationTypeId);
        if (!type || type.forwardLabel.toLowerCase() !== forwardLabel.toLowerCase()) return false;
      }
      return true;
    });

    return matching.length > 0;
  }

  if ('active_at' in condition) {
    const { tick } = condition.active_at;
    const targetTick = tick !== undefined ? tick : context.world.currentTick;
    const record = item as Record<string, unknown>;
    const fromNum = parseNumeric(record.validFromTick ?? record.startTick);
    const toNum = parseNumeric(record.validToTick ?? record.endTick);
    const targetNum = parseNumeric(targetTick);
    if (targetNum === null) return true;

    const fromBig = fromNum !== null ? BigInt(fromNum) : -(1n << 63n);
    const toBig = toNum !== null ? BigInt(toNum) : 1n << 63n;
    const checkBig = BigInt(targetNum);

    return checkBig >= fromBig && checkBig < toBig;
  }

  return true;
}

export function evaluateRule(rule: ValidationRule, context: ValidationContext, options?: EvaluateRuleOptions): ValidationIssue[] {
  if (!rule.enabled) return [];
  const filter = getFilter(options);
  const issues: ValidationIssue[] = [];

  let candidates: unknown[] = [];
  if (rule.target === 'entity') {
    candidates = filter(context.entities);
    if (rule.targetSelector?.typeKey) {
      const type = context.entityTypes.find((t) => t.typeKey === rule.targetSelector?.typeKey);
      if (type) candidates = (candidates as Entity[]).filter((e) => e.typeId === type.id);
      else candidates = [];
    } else if (rule.targetSelector?.typeId) {
      candidates = (candidates as Entity[]).filter((e) => e.typeId === rule.targetSelector?.typeId);
    }
  } else if (rule.target === 'fact') {
    candidates = filter(context.facts);
    if (rule.targetSelector?.predicateKey) {
      candidates = (candidates as Fact[]).filter((f) => f.predicateKey === rule.targetSelector?.predicateKey);
    }
  } else if (rule.target === 'relation') {
    candidates = filter(context.relations);
    if (rule.targetSelector?.relationTypeId) {
      candidates = (candidates as Relation[]).filter((r) => r.relationTypeId === rule.targetSelector?.relationTypeId);
    }
  } else if (rule.target === 'event') {
    candidates = filter(context.events);
    if (rule.targetSelector?.eventType) {
      candidates = (candidates as WorldEvent[]).filter((e) => e.eventType === rule.targetSelector?.eventType);
    }
  } else if (rule.target === 'world') {
    candidates = [context.world];
  }

  for (const item of candidates) {
    if (rule.when && !evaluateCondition(rule.when, context, item, rule.target, options)) {
      continue;
    }

    const passed = evaluateCondition(rule.assert, context, item, rule.target, options);
    if (!passed) {
      const record = item as Record<string, unknown>;
      const itemId = String(record.id ?? context.world.id);
      const itemName = String(record.name ?? record.predicateKey ?? itemId);
      issues.push({
        ruleCode: rule.id,
        severity: rule.severity,
        subjectId: itemId,
        relatedIds: [itemId],
        message: rule.message || `Rule '${rule.name}' failed on ${rule.target} '${itemName}'`,
        evidence: [rule.name, rule.target, itemName],
      });
    }
  }

  return issues;
}
