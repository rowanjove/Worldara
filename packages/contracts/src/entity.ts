import { z } from 'zod';
import { canonStatusSchema } from './world';

export const createEntityTypeRequestSchema = z.object({
  typeKey: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(200),
  schema: z.record(z.string(), z.unknown()).default({}),
});
export type CreateEntityTypeRequest = z.infer<typeof createEntityTypeRequestSchema>;

export const entityTypeSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  typeKey: z.string(),
  label: z.string(),
  schemaVersion: z.number().int().positive(),
  schema: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EntityTypeDto = z.infer<typeof entityTypeSchema>;

export const createEntityDraftRequestSchema = z.object({
  typeId: z.string().uuid(),
  schemaVersion: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(300),
  subtitle: z.string().max(500).default(''),
  parentEntityId: z.string().uuid().nullable().default(null),
  document: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
});
export type CreateEntityDraftRequest = z.infer<typeof createEntityDraftRequestSchema>;

export const entitySchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  typeId: z.string().uuid(),
  name: z.string(),
  subtitle: z.string(),
  parentEntityId: z.string().uuid().nullable(),
  document: z.record(z.string(), z.unknown()),
  documentText: z.string(),
  tags: z.array(z.string()),
  canonStatus: canonStatusSchema,
  revision: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EntityDto = z.infer<typeof entitySchema>;

export const createFactRequestSchema = z.object({
  subjectEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  predicateKey: z.string().trim().min(1).max(100),
  objectKind: z.enum(['scalar', 'entity', 'json']),
  value: z.unknown().optional(),
  objectEntityId: z.string().uuid().optional(),
  validFromTick: z.string().regex(/^-?\d+$/).optional(),
  validToTick: z.string().regex(/^-?\d+$/).optional(),
  sourceKind: z.enum(['manual', 'ai', 'import', 'event']).default('manual'),
});
export type CreateFactRequest = z.infer<typeof createFactRequestSchema>;

export const factSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  subjectEntityId: z.string().uuid(),
  predicateKey: z.string(),
  objectKind: z.enum(['scalar', 'entity', 'json']),
  value: z.unknown(),
  objectEntityId: z.string().uuid().optional(),
  validFromTick: z.string().optional(),
  validToTick: z.string().optional(),
  canonStatus: canonStatusSchema,
  sourceKind: z.enum(['manual', 'ai', 'import', 'event']),
  sourceRefId: z.string().uuid().optional(),
  createdRevision: z.string().optional(),
  retconnedRevision: z.string().optional(),
  revisionFrom: z.string().optional(),
  revisionTo: z.string().nullable().optional(),
});
export type FactDto = z.infer<typeof factSchema>;

export const createRelationTypeRequestSchema = z.object({
  forwardLabel: z.string().trim().min(1).max(100),
  inverseLabel: z.string().trim().max(100).optional(),
  symmetric: z.boolean().default(false),
  sourceTypeIds: z.array(z.string().uuid()).max(100).default([]),
  targetTypeIds: z.array(z.string().uuid()).max(100).default([]),
});
export type CreateRelationTypeRequest = z.infer<typeof createRelationTypeRequestSchema>;

export const createRelationRequestSchema = z.object({
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  relationTypeId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  validFromTick: z.string().regex(/^-?\d+$/).optional(),
  validToTick: z.string().regex(/^-?\d+$/).optional(),
  description: z.string().max(10_000).default(''),
});
export type CreateRelationRequest = z.infer<typeof createRelationRequestSchema>;

export const relationSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  relationTypeId: z.string().uuid(),
  validFromTick: z.string().optional(),
  validToTick: z.string().optional(),
  description: z.string(),
  canonStatus: canonStatusSchema,
  sourceKind: z.enum(['manual', 'ai', 'import', 'event']).optional(),
  sourceRefId: z.string().uuid().optional(),
  createdRevision: z.string().optional(),
  retconnedRevision: z.string().optional(),
  revisionFrom: z.string().optional(),
  revisionTo: z.string().nullable().optional(),
});
export type RelationDto = z.infer<typeof relationSchema>;

export const worldDatePrecisionSchema = z.enum([
  'exact',
  'day',
  'month',
  'year',
  'decade',
  'century',
  'era',
  'approximate',
  'unknown',
]);
export type WorldDatePrecisionDto = z.infer<typeof worldDatePrecisionSchema>;

export const temporalExpressionSchema = z.object({
  kind: z.enum(['point', 'span', 'approximate', 'relative', 'unknown']),
  startTick: z.string().regex(/^-?\d+$/).optional(),
  endTick: z.string().regex(/^-?\d+$/).optional(),
  precision: worldDatePrecisionSchema.optional(),
  relativeToEventId: z.string().uuid().optional(),
  relativeOffsetTicks: z.string().regex(/^-?\d+$/).optional(),
  displayLabel: z.string().max(200).optional(),
});
export type TemporalExpressionDto = z.infer<typeof temporalExpressionSchema>;

export const eventCausalRelationKindSchema = z.enum([
  'causes',
  'triggers',
  'enables',
  'prevents',
  'results_in',
  'contradicts',
]);
export type EventCausalRelationKindDto = z.infer<typeof eventCausalRelationKindSchema>;

export const eventCausalLinkSchema = z.object({
  targetEventId: z.string().uuid(),
  kind: eventCausalRelationKindSchema,
  description: z.string().max(1000).optional(),
});
export type EventCausalLinkDto = z.infer<typeof eventCausalLinkSchema>;

export const createEventRequestSchema = z.object({
  name: z.string().trim().min(1).max(300),
  eventType: z.string().trim().min(1).max(100),
  branchId: z.string().uuid().optional(),
  startTick: z.string().regex(/^-?\d+$/),
  endTick: z.string().regex(/^-?\d+$/).optional(),
  temporalExpression: temporalExpressionSchema.optional(),
  causalLinks: z.array(eventCausalLinkSchema).max(100).default([]),
  participantIds: z.array(z.string().uuid()).max(500).default([]),
  participants: z.array(z.object({ entityId: z.string().uuid(), role: z.string().trim().min(1).max(100) })).max(500).optional(),
  requiredRoles: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  locationEntityIds: z.array(z.string().uuid()).max(100).default([]),
  causeEventIds: z.array(z.string().uuid()).max(100).default([]),
  resultEventIds: z.array(z.string().uuid()).max(100).default([]),
  effects: z.array(z.object({ id: z.string().uuid().optional(), type: z.enum(['SET_FACT', 'SET_FIELD', 'ADD_FACT', 'END_FACT', 'ADD_RELATION', 'END_RELATION', 'REMOVE_RELATION', 'CREATE_ENTITY', 'ARCHIVE_ENTITY', 'MOVE_ENTITY', 'CHANGE_GEOMETRY', 'SET_STATUS']), targetId: z.string().uuid().optional(), payload: z.record(z.string(), z.unknown()).default({}), sequence: z.number().int().nonnegative() })).max(500).default([]),
  description: z.string().max(20_000).default(''),
});
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const eventSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  name: z.string(),
  eventType: z.string(),
  startTick: z.string(),
  endTick: z.string().optional(),
  temporalExpression: temporalExpressionSchema.optional(),
  causalLinks: z.array(eventCausalLinkSchema).optional(),
  participantIds: z.array(z.string().uuid()),
  participants: z.array(z.object({ entityId: z.string().uuid(), role: z.string() })).optional(),
  requiredRoles: z.array(z.string()).optional(),
  locationEntityIds: z.array(z.string().uuid()),
  causeEventIds: z.array(z.string().uuid()),
  resultEventIds: z.array(z.string().uuid()),
  effects: z.array(z.record(z.string(), z.unknown())),
  description: z.string(),
  canonStatus: canonStatusSchema,
  createdRevision: z.string().optional(),
});
export type EventDto = z.infer<typeof eventSchema>;

export const eventCausalityPathNodeSchema = z.object({
  eventId: z.string().uuid(),
  name: z.string(),
  eventType: z.string(),
  startTick: z.string(),
  canonStatus: canonStatusSchema,
  relationKind: eventCausalRelationKindSchema.optional(),
  description: z.string().optional(),
});
export type EventCausalityPathNodeDto = z.infer<typeof eventCausalityPathNodeSchema>;

export const eventCausalitySummarySchema = z.object({
  event: eventSchema,
  upstreamCauses: z.array(eventCausalityPathNodeSchema),
  downstreamConsequences: z.array(eventCausalityPathNodeSchema),
  contradictingEvents: z.array(eventCausalityPathNodeSchema),
  hasCycle: z.boolean(),
});
export type EventCausalitySummaryDto = z.infer<typeof eventCausalitySummarySchema>;
