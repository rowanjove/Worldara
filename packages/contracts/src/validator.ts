import { z } from 'zod';

export const validationSeveritySchema = z.enum(['info', 'suggestion', 'warning', 'error', 'blocker']);

export const ruleTargetKindSchema = z.enum(['entity', 'fact', 'relation', 'event', 'world']);

export const ruleTargetSelectorSchema = z.object({
  typeKey: z.string().trim().min(1).max(100).optional(),
  typeId: z.string().uuid().optional(),
  predicateKey: z.string().trim().min(1).max(100).optional(),
  relationTypeId: z.string().uuid().optional(),
  eventType: z.string().trim().min(1).max(100).optional(),
});

export type RuleConditionDto =
  | { all: RuleConditionDto[] }
  | { any: RuleConditionDto[] }
  | { not: RuleConditionDto }
  | { field: string; equals?: unknown }
  | { field: string; not_equals?: unknown }
  | { field: string; exists: boolean }
  | { field: string; not_exists: boolean }
  | { field: string; lt: number | string | bigint }
  | { field: string; lte: number | string | bigint }
  | { field: string; gt: number | string | bigint }
  | { field: string; gte: number | string | bigint }
  | { fact: string; equals?: unknown }
  | { fact: string; not_equals?: unknown }
  | { fact: string; exists: boolean }
  | { fact: string; not_exists: boolean }
  | { fact: string; lt: number | string | bigint }
  | { fact: string; lte: number | string | bigint }
  | { fact: string; gt: number | string | bigint }
  | { fact: string; gte: number | string | bigint }
  | {
      count: {
        target: 'facts' | 'relations' | 'events' | 'participants';
        where?: RuleConditionDto | undefined;
        equals?: number | undefined;
        not_equals?: number | undefined;
        lt?: number | undefined;
        lte?: number | undefined;
        gt?: number | undefined;
        gte?: number | undefined;
      };
    }
  | {
      duration_between: {
        from: string;
        to: string;
        equals?: number | string | bigint | undefined;
        not_equals?: number | string | bigint | undefined;
        lt?: number | string | bigint | undefined;
        lte?: number | string | bigint | undefined;
        gt?: number | string | bigint | undefined;
        gte?: number | string | bigint | undefined;
      };
    }
  | {
      relation_exists: {
        relationTypeId?: string | undefined;
        forwardLabel?: string | undefined;
        targetEntityId?: string | undefined;
        direction?: 'outgoing' | 'incoming' | 'both' | undefined;
      };
    }
  | {
      active_at: {
        tick?: bigint | string | number | undefined;
        field?: string | undefined;
      };
    };

export const ruleConditionSchema: z.ZodType<RuleConditionDto> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ruleConditionSchema) }),
    z.object({ any: z.array(ruleConditionSchema) }),
    z.object({ not: ruleConditionSchema }),
    z.object({ field: z.string().trim().min(1).max(100), equals: z.unknown() }),
    z.object({ field: z.string().trim().min(1).max(100), not_equals: z.unknown() }),
    z.object({ field: z.string().trim().min(1).max(100), exists: z.boolean() }),
    z.object({ field: z.string().trim().min(1).max(100), not_exists: z.boolean() }),
    z.object({ field: z.string().trim().min(1).max(100), lt: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ field: z.string().trim().min(1).max(100), lte: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ field: z.string().trim().min(1).max(100), gt: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ field: z.string().trim().min(1).max(100), gte: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ fact: z.string().trim().min(1).max(100), equals: z.unknown() }),
    z.object({ fact: z.string().trim().min(1).max(100), not_equals: z.unknown() }),
    z.object({ fact: z.string().trim().min(1).max(100), exists: z.boolean() }),
    z.object({ fact: z.string().trim().min(1).max(100), not_exists: z.boolean() }),
    z.object({ fact: z.string().trim().min(1).max(100), lt: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ fact: z.string().trim().min(1).max(100), lte: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ fact: z.string().trim().min(1).max(100), gt: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({ fact: z.string().trim().min(1).max(100), gte: z.union([z.number(), z.string(), z.bigint()]) }),
    z.object({
      count: z.object({
        target: z.enum(['facts', 'relations', 'events', 'participants']),
        where: ruleConditionSchema.optional(),
        equals: z.number().int().optional(),
        not_equals: z.number().int().optional(),
        lt: z.number().int().optional(),
        lte: z.number().int().optional(),
        gt: z.number().int().optional(),
        gte: z.number().int().optional(),
      }),
    }),
    z.object({
      duration_between: z.object({
        from: z.string().trim().min(1).max(100),
        to: z.string().trim().min(1).max(100),
        equals: z.union([z.number(), z.string(), z.bigint()]).optional(),
        not_equals: z.union([z.number(), z.string(), z.bigint()]).optional(),
        lt: z.union([z.number(), z.string(), z.bigint()]).optional(),
        lte: z.union([z.number(), z.string(), z.bigint()]).optional(),
        gt: z.union([z.number(), z.string(), z.bigint()]).optional(),
        gte: z.union([z.number(), z.string(), z.bigint()]).optional(),
      }),
    }),
    z.object({
      relation_exists: z.object({
        relationTypeId: z.string().uuid().optional(),
        forwardLabel: z.string().trim().min(1).max(100).optional(),
        targetEntityId: z.string().uuid().optional(),
        direction: z.enum(['outgoing', 'incoming', 'both']).optional(),
      }),
    }),
    z.object({
      active_at: z.object({
        tick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).optional(),
        field: z.string().trim().min(1).max(100).optional(),
      }),
    }),
  ])
);

export const createValidationRuleRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  severity: validationSeveritySchema.default('error'),
  target: ruleTargetKindSchema.default('entity'),
  targetSelector: ruleTargetSelectorSchema.optional(),
  when: ruleConditionSchema.optional(),
  assert: ruleConditionSchema,
  message: z.string().trim().max(500).optional(),
  enabled: z.boolean().default(true),
});
export type CreateValidationRuleRequest = z.infer<typeof createValidationRuleRequestSchema>;

export const updateValidationRuleRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  severity: validationSeveritySchema.optional(),
  target: ruleTargetKindSchema.optional(),
  targetSelector: ruleTargetSelectorSchema.optional(),
  when: ruleConditionSchema.optional(),
  assert: ruleConditionSchema.optional(),
  message: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateValidationRuleRequest = z.infer<typeof updateValidationRuleRequestSchema>;

export const testValidationRuleRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).default('test-rule'),
  description: z.string().trim().max(2000).optional(),
  severity: validationSeveritySchema.default('error'),
  target: ruleTargetKindSchema.default('entity'),
  targetSelector: ruleTargetSelectorSchema.optional(),
  when: ruleConditionSchema.optional(),
  assert: ruleConditionSchema,
  message: z.string().trim().max(500).optional(),
  includeDrafts: z.boolean().default(true),
});
export type TestValidationRuleRequest = z.infer<typeof testValidationRuleRequestSchema>;

export const validationRuleSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  severity: validationSeveritySchema,
  target: ruleTargetKindSchema,
  targetSelector: ruleTargetSelectorSchema.optional(),
  when: ruleConditionSchema.optional(),
  assert: ruleConditionSchema,
  message: z.string().optional(),
  enabled: z.boolean(),
  createdRevision: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ValidationRuleDto = z.infer<typeof validationRuleSchema>;

export const validationIssueSchema = z.object({
  ruleCode: z.string(),
  severity: validationSeveritySchema,
  subjectId: z.string().optional(),
  relatedIds: z.array(z.string()),
  eventId: z.string().optional(),
  message: z.string(),
  evidence: z.array(z.string()),
});
export type ValidationIssueDto = z.infer<typeof validationIssueSchema>;

export const changeSetSchema = z.object({
  entityIds: z.array(z.string()).optional(),
  factIds: z.array(z.string()).optional(),
  predicates: z.array(z.string()).optional(),
  relationIds: z.array(z.string()).optional(),
  relationTypeIds: z.array(z.string()).optional(),
  eventIds: z.array(z.string()).optional(),
  ruleIds: z.array(z.string()).optional(),
});
export type ChangeSetDto = z.infer<typeof changeSetSchema>;

export const validateIncrementalRequestSchema = z.object({
  changeSet: changeSetSchema,
});
export type ValidateIncrementalRequest = z.infer<typeof validateIncrementalRequestSchema>;

export const incrementalValidationResultSchema = z.object({
  issues: z.array(validationIssueSchema),
  affectedRuleCodes: z.array(z.string()),
  skippedRuleCodes: z.array(z.string()),
  impactedEntityIds: z.array(z.string()),
  isIncremental: z.boolean(),
});
export type IncrementalValidationResultDto = z.infer<typeof incrementalValidationResultSchema>;
