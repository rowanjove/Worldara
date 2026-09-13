import { z } from 'zod';
import { canonStatusSchema } from './world';

export const claimTruthStatusSchema = z.enum(['true', 'false', 'disputed', 'unknown', 'author_undecided']);
export type ClaimTruthStatus = z.infer<typeof claimTruthStatusSchema>;

export const claimKindSchema = z.enum([
  'belief',
  'rumor',
  'official_record',
  'testimony',
  'prophecy',
  'legend',
  'secret',
  'hypothesis',
]);
export type ClaimKind = z.infer<typeof claimKindSchema>;

export const createClaimRequestSchema = z.object({
  branchId: z.string().uuid().optional(),
  subjectEntityId: z.string().uuid().optional(),
  predicateKey: z.string().trim().min(1).max(100),
  objectKind: z.enum(['scalar', 'entity', 'json']).default('scalar'),
  value: z.unknown().optional(),
  objectEntityId: z.string().uuid().optional(),
  assertedByEntityId: z.string().uuid().optional(),
  knownByEntityIds: z.array(z.string().uuid()).default([]),
  validFromTick: z.string().regex(/^-?\d+$/).optional(),
  validToTick: z.string().regex(/^-?\d+$/).optional(),
  truthStatus: claimTruthStatusSchema.default('unknown'),
  claimKind: claimKindSchema.default('belief'),
  confidence: z.number().min(0).max(1).optional(),
  sourceRefs: z.array(z.string().trim().min(1).max(500)).default([]),
});
export type CreateClaimRequest = z.infer<typeof createClaimRequestSchema>;

export const claimSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  subjectEntityId: z.string().uuid().optional(),
  predicateKey: z.string(),
  objectKind: z.enum(['scalar', 'entity', 'json']),
  value: z.unknown(),
  objectEntityId: z.string().uuid().optional(),
  assertedByEntityId: z.string().uuid().optional(),
  knownByEntityIds: z.array(z.string().uuid()),
  validFromTick: z.string().optional(),
  validToTick: z.string().optional(),
  truthStatus: claimTruthStatusSchema,
  claimKind: claimKindSchema,
  confidence: z.number().optional(),
  sourceRefs: z.array(z.string()),
  canonStatus: canonStatusSchema,
  createdRevision: z.string().optional(),
  retconnedRevision: z.string().optional(),
  revisionFrom: z.string().optional(),
  revisionTo: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ClaimDto = z.infer<typeof claimSchema>;

export const claimQuerySchema = z.object({
  subjectEntityId: z.string().uuid().optional(),
  assertedByEntityId: z.string().uuid().optional(),
  claimKind: claimKindSchema.optional(),
  truthStatus: claimTruthStatusSchema.optional(),
  canonStatus: z.enum(['draft', 'pending', 'canon', 'retconned', 'all']).optional(),
  branchId: z.string().uuid().optional(),
});
export type ClaimQuery = z.infer<typeof claimQuerySchema>;
