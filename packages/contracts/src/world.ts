import { z } from 'zod';

export const canonStatusSchema = z.enum(['draft', 'pending', 'canon', 'retconned', 'archived']);
export type CanonStatus = z.infer<typeof canonStatusSchema>;

export const canonStrategySchema = z.enum(['strict', 'lenient']);
export type CanonStrategy = z.infer<typeof canonStrategySchema>;

export const createWorldRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9\u4e00-\u9fff]+(?:-[a-z0-9\u4e00-\u9fff]+)*$/).optional(),
  genre: z.string().trim().min(1).max(100).default('Custom'),
  description: z.string().max(20_000).default(''),
  canonStrategy: canonStrategySchema.default('strict'),
});
export type CreateWorldRequest = z.infer<typeof createWorldRequestSchema>;

export const updateWorldRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  genre: z.string().trim().min(1).max(100).optional(),
  canonStrategy: canonStrategySchema.optional(),
});
export type UpdateWorldRequest = z.infer<typeof updateWorldRequestSchema>;

export const canonStatusChangeRequestSchema = z.object({
  status: canonStatusSchema,
  reason: z.string().trim().min(1).max(10_000),
});
export type CanonStatusChangeRequest = z.infer<typeof canonStatusChangeRequestSchema>;

export const worldSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  genre: z.string(),
  canonStrategy: canonStrategySchema,
  defaultCalendarVersionId: z.string().uuid().nullable(),
  currentTick: z.string(),
  revision: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type WorldDto = z.infer<typeof worldSchema>;

export const timelineBranchStatusSchema = z.enum(['main', 'sandbox', 'alternate', 'archived']);
export type TimelineBranchStatus = z.infer<typeof timelineBranchStatusSchema>;

export const timelineBranchSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  name: z.string(),
  parentBranchId: z.string().uuid().nullable().optional(),
  forkTick: z.string().nullable().optional(),
  forkRevision: z.string().nullable().optional(),
  status: timelineBranchStatusSchema,
  createdAt: z.string().datetime(),
});
export type TimelineBranchDto = z.infer<typeof timelineBranchSchema>;

export const createBranchRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentBranchId: z.string().uuid().optional(),
  forkTick: z.string().regex(/^-?\d+$/).optional(),
  status: timelineBranchStatusSchema.default('alternate'),
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;
