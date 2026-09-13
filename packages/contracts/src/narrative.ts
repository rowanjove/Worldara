import { z } from 'zod';

export const workTypeSchema = z.enum(['novel', 'screenplay', 'game', 'campaign', 'comic', 'other']);
export type WorkTypeDto = z.infer<typeof workTypeSchema>;

export const sceneStatusSchema = z.enum(['outline', 'draft', 'revised', 'final']);
export type SceneStatusDto = z.infer<typeof sceneStatusSchema>;

export const workSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  type: workTypeSchema,
  description: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkDto = z.infer<typeof workSchema>;

export const createWorkRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: workTypeSchema.default('novel'),
  description: z.string().trim().max(2000).optional(),
});
export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>;

export const updateWorkRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  type: workTypeSchema.optional(),
  description: z.string().trim().max(2000).optional(),
});
export type UpdateWorkRequest = z.infer<typeof updateWorkRequestSchema>;

export const chapterSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  workId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  orderIndex: z.number().int(),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChapterDto = z.infer<typeof chapterSchema>;

export const createChapterRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  orderIndex: z.number().int().optional(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateChapterRequest = z.infer<typeof createChapterRequestSchema>;

export const updateChapterRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  orderIndex: z.number().int().optional(),
  description: z.string().trim().max(2000).optional(),
});
export type UpdateChapterRequest = z.infer<typeof updateChapterRequestSchema>;

export const plotlineStageSchema = z.enum(['setup', 'development', 'climax', 'resolution', 'unresolved']);
export type PlotlineStageDto = z.infer<typeof plotlineStageSchema>;

export const plotlineStatusSchema = z.enum(['active', 'resolved', 'abandoned']);
export type PlotlineStatusDto = z.infer<typeof plotlineStatusSchema>;

export const plotlineSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().default(''),
  status: plotlineStatusSchema,
  currentStage: plotlineStageSchema,
  characterEntityIds: z.array(z.string().uuid()),
  eventIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PlotlineDto = z.infer<typeof plotlineSchema>;

export const createPlotlineRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(5000).default(''),
  status: plotlineStatusSchema.default('active'),
  currentStage: plotlineStageSchema.default('setup'),
  characterEntityIds: z.array(z.string().uuid()).default([]),
  eventIds: z.array(z.string().uuid()).default([]),
});
export type CreatePlotlineRequest = z.infer<typeof createPlotlineRequestSchema>;

export const updatePlotlineRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(5000).optional(),
  status: plotlineStatusSchema.optional(),
  currentStage: plotlineStageSchema.optional(),
  characterEntityIds: z.array(z.string().uuid()).optional(),
  eventIds: z.array(z.string().uuid()).optional(),
});
export type UpdatePlotlineRequest = z.infer<typeof updatePlotlineRequestSchema>;

export const foreshadowingStatusSchema = z.enum(['open', 'resolved', 'abandoned']);
export type ForeshadowingStatusDto = z.infer<typeof foreshadowingStatusSchema>;

export const foreshadowingSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().default(''),
  setupSceneId: z.string().uuid(),
  setupTick: z.string().optional(),
  payoffSceneId: z.string().uuid().optional(),
  payoffTick: z.string().optional(),
  relatedEntityIds: z.array(z.string().uuid()),
  plotlineId: z.string().uuid().optional(),
  status: foreshadowingStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ForeshadowingDto = z.infer<typeof foreshadowingSchema>;

export const createForeshadowingRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  setupSceneId: z.string().uuid(),
  setupTick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).optional(),
  payoffSceneId: z.string().uuid().optional(),
  payoffTick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).optional(),
  relatedEntityIds: z.array(z.string().uuid()).default([]),
  plotlineId: z.string().uuid().optional(),
  status: foreshadowingStatusSchema.default('open'),
});
export type CreateForeshadowingRequest = z.infer<typeof createForeshadowingRequestSchema>;

export const updateForeshadowingRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  setupSceneId: z.string().uuid().optional(),
  setupTick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).optional(),
  payoffSceneId: z.string().uuid().nullable().optional(),
  payoffTick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).nullable().optional(),
  relatedEntityIds: z.array(z.string().uuid()).optional(),
  plotlineId: z.string().uuid().nullable().optional(),
  status: foreshadowingStatusSchema.optional(),
});
export type UpdateForeshadowingRequest = z.infer<typeof updateForeshadowingRequestSchema>;

export const foreshadowingReviewIssueSchema = z.object({
  code: z.enum(['PREMATURE_PAYOFF', 'DUPLICATE_PAYOFF', 'ORPHANED_PAYOFF', 'UNRESOLVED_FORESHADOWING']),
  severity: z.enum(['warning', 'error', 'blocker']),
  foreshadowingId: z.string().uuid(),
  setupSceneId: z.string().uuid().optional(),
  payoffSceneId: z.string().uuid().optional(),
  message: z.string(),
  evidence: z.array(z.string()),
});
export type ForeshadowingReviewIssueDto = z.infer<typeof foreshadowingReviewIssueSchema>;

export const foreshadowingAuditResultSchema = z.object({
  totalForeshadowings: z.number().int(),
  openCount: z.number().int(),
  resolvedCount: z.number().int(),
  abandonedCount: z.number().int(),
  issues: z.array(foreshadowingReviewIssueSchema),
});
export type ForeshadowingAuditResultDto = z.infer<typeof foreshadowingAuditResultSchema>;

export const sceneSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  workId: z.string().uuid(),
  chapterId: z.string().uuid(),
  title: z.string().optional(),
  orderIndex: z.number().int(),
  sceneTick: z.string().optional(),
  povCharacterId: z.string().uuid().optional(),
  locationEntityId: z.string().uuid().optional(),
  participantEntityIds: z.array(z.string().uuid()),
  plotlineIds: z.array(z.string().uuid()).default([]),
  proseText: z.string(),
  status: sceneStatusSchema,
  canonRevision: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SceneDto = z.infer<typeof sceneSchema>;

export const createSceneRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
  orderIndex: z.number().int().optional(),
  sceneTick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).optional(),
  povCharacterId: z.string().uuid().optional(),
  locationEntityId: z.string().uuid().optional(),
  participantEntityIds: z.array(z.string().uuid()).default([]),
  plotlineIds: z.array(z.string().uuid()).default([]),
  proseText: z.string().default(''),
  status: sceneStatusSchema.default('draft'),
  canonRevision: z.string().regex(/^\d+$/).optional(),
});
export type CreateSceneRequest = z.infer<typeof createSceneRequestSchema>;

export const updateSceneRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
  orderIndex: z.number().int().optional(),
  sceneTick: z.union([z.string().regex(/^-?\d+$/), z.number().int(), z.bigint()]).optional(),
  povCharacterId: z.string().uuid().nullable().optional(),
  locationEntityId: z.string().uuid().nullable().optional(),
  participantEntityIds: z.array(z.string().uuid()).optional(),
  plotlineIds: z.array(z.string().uuid()).optional(),
  proseText: z.string().optional(),
  status: sceneStatusSchema.optional(),
  canonRevision: z.string().regex(/^\d+$/).optional(),
});
export type UpdateSceneRequest = z.infer<typeof updateSceneRequestSchema>;

export const continuityIssueSeveritySchema = z.enum(['info', 'warning', 'error', 'blocker']);
export type ContinuityIssueSeverityDto = z.infer<typeof continuityIssueSeveritySchema>;

export const continuityIssueSchema = z.object({
  code: z.string(),
  severity: continuityIssueSeveritySchema,
  sceneId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  message: z.string(),
  evidence: z.array(z.string()),
});
export type ContinuityIssueDto = z.infer<typeof continuityIssueSchema>;

export const sceneReviewResultSchema = z.object({
  sceneId: z.string().uuid(),
  pass: z.boolean(),
  issues: z.array(continuityIssueSchema),
});
export type SceneReviewResultDto = z.infer<typeof sceneReviewResultSchema>;
