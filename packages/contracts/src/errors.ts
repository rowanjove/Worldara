import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'WORLD_ACCESS_DENIED',
  'CANON_BLOCKED',
  'AI_PROVIDER_ERROR',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    traceId: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
