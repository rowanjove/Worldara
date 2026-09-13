import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  canonStatusChangeRequestSchema,
  createBranchRequestSchema,
  createEntityDraftRequestSchema,
  createEntityTypeRequestSchema,
  createWorldRequestSchema,
  updateWorldRequestSchema,
  createFactRequestSchema,
  createRelationTypeRequestSchema,
  createRelationRequestSchema,
  createEventRequestSchema,
  createClaimRequestSchema,
  claimQuerySchema,
  createValidationRuleRequestSchema,
  updateValidationRuleRequestSchema,
  testValidationRuleRequestSchema,
  validateIncrementalRequestSchema,
  createWorkRequestSchema,
  updateWorkRequestSchema,
  createChapterRequestSchema,
  updateChapterRequestSchema,
  createSceneRequestSchema,
  updateSceneRequestSchema,
  createPlotlineRequestSchema,
  updatePlotlineRequestSchema,
  createForeshadowingRequestSchema,
  updateForeshadowingRequestSchema,
  type EntityDto,
  type EntityTypeDto,
  type WorldDto,
  type FactDto,
  type RelationDto,
  type EventDto,
  type TimelineBranchDto,
  type ClaimDto,
  type ValidationRuleDto,
  type WorkDto,
  type ChapterDto,
  type SceneDto,
  type SceneReviewResultDto,
  type ContinuityIssueDto,
  type PlotlineDto,
  type ForeshadowingDto,
  type ForeshadowingAuditResultDto,
  type ForeshadowingReviewIssueDto,
} from '@world-codex/contracts';
import { DEFAULT_BRANCH_ID, DomainError } from '@world-codex/domain';
import type { ChangeSet, EventEffect, IncrementalValidationResult, ValidationIssue, WorldEvent } from '@world-codex/domain';
import type { ParsedWorldBundle, WorldBundle } from '@world-codex/portable';
import { buildCanonContext, type CanonApplicationService, type IdempotencyRepository, type ProposalRecord, type ProposalRepository, type TemporalApplicationService, type WorldApplicationService } from '@world-codex/application';
import { computeSnapshot } from '@world-codex/snapshot';
import { bundleHash, bundleToGeoJson, bundleToJson, bundleToMarkdown, bundleToObsidianZip, bundleToZip, createBundle, parseBundle, parseBundleZip, parseCsvBundle, parseMarkdownBundle } from '@world-codex/portable';
import { CalendarError, dateToTick, tickToDate, type CalendarDefinition } from '@world-codex/calendar';
import { AiProviderError, type ProposalProvider } from '@world-codex/ai';
import { evaluateRule } from '@world-codex/validator';

interface ParamsWorld { worldId: string }
interface ParamsEntity { worldId: string; entityId: string }
interface ParamsCanon { worldId: string; kind: string; itemId: string }
interface ParamsMap { worldId: string; mapId: string }
interface ParamsRule { worldId: string; ruleId: string }
interface ParamsWork { worldId: string; workId: string }
interface ParamsChapter { worldId: string; chapterId: string }
interface ParamsScene { worldId: string; sceneId: string }
interface ParamsPlotline { worldId: string; plotlineId: string }
interface ParamsForeshadowing { worldId: string; foreshadowingId: string }
interface IdempotentResult { statusCode: number; body: unknown }
interface PageQuery { limit?: string; cursor?: string }
interface ForeshadowingListQuery extends PageQuery { plotlineId?: string }

export interface AssetStore {
  put(storageKey: string, data: Buffer): Promise<boolean>;
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}

class MemoryAssetStore implements AssetStore {
  private readonly values = new Map<string, Buffer>();
  async put(storageKey: string, data: Buffer): Promise<boolean> { if (this.values.has(storageKey)) return false; this.values.set(storageKey, Buffer.from(data)); return true; }
  async get(storageKey: string): Promise<Buffer | null> { const value = this.values.get(storageKey); return value ? Buffer.from(value) : null; }
  async delete(storageKey: string): Promise<void> { this.values.delete(storageKey); }
}

export function createFileAssetStore(rootDirectory: string): AssetStore {
  const root = path.resolve(rootDirectory);
  const resolveKey = (storageKey: string): string => {
    const resolved = path.resolve(root, storageKey);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new DomainError('VALIDATION_ERROR', 'Invalid asset storage key');
    return resolved;
  };
  return {
    async put(storageKey, data) { const target = resolveKey(storageKey); await fs.mkdir(path.dirname(target), { recursive: true }); try { await fs.writeFile(target, data, { flag: 'wx' }); return true; } catch (error) { if ((error as { code?: string }).code === 'EEXIST') return false; throw error; } },
    async get(storageKey) { try { return await fs.readFile(resolveKey(storageKey)); } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return null; throw error; } },
    async delete(storageKey) { try { await fs.unlink(resolveKey(storageKey)); } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; } },
  };
}

const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

const calendarDefinitionInputSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), yearZero: z.number().int(), daysPerWeek: z.number().int().positive(), weekdays: z.array(z.string().trim().min(1)).max(100),
  months: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), days: z.number().int().positive() })).min(1).max(100),
  eras: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), abbreviation: z.string().max(50), startTick: z.string().regex(/^-?\d+$/), endTick: z.string().regex(/^-?\d+$/).optional() })).max(100),
  leapRule: z.object({ everyYears: z.number().int().positive(), extraDays: z.number().int().positive(), monthId: z.string().optional() }).optional(),
});

function revisionHeader(request: FastifyRequest): bigint {
  const value = request.headers['if-match'];
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new DomainError('VALIDATION_ERROR', 'If-Match must be a decimal revision', { header: 'If-Match' });
  return BigInt(value);
}

function idempotencyHeader(request: FastifyRequest): string | undefined {
  const value = request.headers['idempotency-key'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 8 || value.length > 200 || !/^[\x20-\x7e]+$/.test(value)) throw new DomainError('VALIDATION_ERROR', 'Idempotency-Key must be 8-200 printable ASCII characters');
  return value;
}

function requestId(request: FastifyRequest): string { return request.id; }

function pageEnvelope<T extends { id: string }>(items: T[], query: PageQuery): { data: T[]; page: { limit: number; nextCursor: string | null } } {
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DomainError('VALIDATION_ERROR', 'limit must be an integer between 1 and 500');
  const ordered = [...items].sort((left, right) => left.id.localeCompare(right.id));
  let start = 0;
  if (query.cursor !== undefined) {
    const index = ordered.findIndex((item) => item.id === query.cursor);
    if (index < 0) throw new DomainError('VALIDATION_ERROR', 'cursor is invalid or expired');
    start = index + 1;
  }
  const data = ordered.slice(start, start + limit);
  return { data, page: { limit, nextCursor: start + limit < ordered.length ? data.at(-1)?.id ?? null : null } };
}

export function createApp(
  service: WorldApplicationService,
  temporal?: TemporalApplicationService,
  canon?: CanonApplicationService,
  validateWorldState?: (worldId: string) => Promise<ValidationIssue[]>,
  idempotencyStore?: IdempotencyRepository,
  assetStore: AssetStore = new MemoryAssetStore(),
  proposalProvider?: ProposalProvider,
  proposalStore?: ProposalRepository,
  validateWorldIncrementalState?: (worldId: string, changeSet: ChangeSet) => Promise<IncrementalValidationResult>,
): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 30 * 1024 * 1024 });
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.addContentTypeParser('text/markdown', { parseAs: 'string' }, (_request, body, done) => done(null, body));
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_request, body, done) => done(null, body));
  const idempotencyResponses = new Map<string, { statusCode: number; body: unknown; requestHash: string; createdAt: number }>();
  const idempotencyInflight = new Map<string, { requestHash: string; promise: Promise<IdempotentResult> }>();
  const requestIdempotency = new WeakMap<FastifyRequest, { scope: string; key: string; requestHash: string; inflightKey: string }>();
  const genericInflight = new Map<string, { requestHash: string; promise: Promise<IdempotentResult>; resolve: (result: IdempotentResult) => void }>();
  const IDEMPOTENCY_LEASE_MS = 60_000;
  const MAX_IN_MEMORY_PROPOSALS = 500;
  const proposals = new Map<string, ProposalRecord>();

  function trimProposals(): void {
    while (proposals.size > MAX_IN_MEMORY_PROPOSALS) {
      const oldestKey = proposals.keys().next().value;
      if (oldestKey !== undefined) proposals.delete(oldestKey);
      else break;
    }
  }

  async function readProposal(worldId: string, proposalId: string): Promise<ProposalRecord | null> {
    return proposalStore ? proposalStore.getProposal(worldId, proposalId) : proposals.get(proposalId) ?? null;
  }

  async function writeProposal(proposal: ProposalRecord, create = false): Promise<ProposalRecord> {
    if (proposalStore) return create ? proposalStore.createProposal(proposal) : proposalStore.updateProposal(proposal);
    proposals.set(proposal.id, proposal);
    trimProposals();
    return proposal;
  }

  const allowedOrigins = new Set((process.env.WORLD_CODEX_WEB_ORIGINS ?? process.env.WORLD_CODEX_WEB_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((origin) => origin.trim()).filter(Boolean));
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'content-type,if-match,idempotency-key,authorization,x-asset-media-type,x-file-name');
      reply.header('Access-Control-Expose-Headers', 'etag');
    }
    if (request.method === 'OPTIONS') return reply.status(origin && allowedOrigins.has(origin) ? 204 : 403).send();
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!idempotencyStore || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const key = idempotencyHeader(request);
    if (!key) return;
    const scope = `${request.method}:${request.url.split('?')[0]}`;
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body ?? null));
    const requestHash = createHash('sha256').update(body).digest('hex');
    const inflightKey = `${scope}:${key}`;
    const active = genericInflight.get(inflightKey);
    if (active) {
      if (active.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key is already in use with a different payload');
      const result = await active.promise;
      return reply.status(result.statusCode).send(result.body);
    }
    if (idempotencyStore.claimOperationIdempotency) {
      let claim = await idempotencyStore.claimOperationIdempotency(scope, key, requestHash, IDEMPOTENCY_LEASE_MS);
      const deadline = Date.now() + IDEMPOTENCY_LEASE_MS;
      while (claim.status === 'inflight' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        claim = await idempotencyStore.claimOperationIdempotency(scope, key, requestHash, IDEMPOTENCY_LEASE_MS);
      }
      if (claim.status === 'conflict') throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload');
      if (claim.status === 'completed' && claim.record) return reply.status(claim.record.statusCode ?? 200).send(claim.record.response);
      if (claim.status !== 'acquired') throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'An identical request is still being processed; retry shortly');
    } else {
      const persisted = await idempotencyStore.getOperationIdempotency(scope, key);
      if (persisted) {
        if (persisted.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload');
        return reply.status(persisted.statusCode ?? 200).send(persisted.response);
      }
    }
    let resolve!: (result: IdempotentResult) => void;
    const promise = new Promise<IdempotentResult>((done) => { resolve = done; });
    genericInflight.set(inflightKey, { requestHash, promise, resolve });
    requestIdempotency.set(request, { scope, key, requestHash, inflightKey });
    request.raw.once('close', () => {
      const activeEntry = genericInflight.get(inflightKey);
      if (activeEntry && activeEntry.promise === promise) {
        activeEntry.resolve({ statusCode: 503, body: { error: { code: 'REQUEST_ABORTED', message: 'Client connection closed before response was generated' } } });
        genericInflight.delete(inflightKey);
        void idempotencyStore.releaseOperationIdempotency?.(scope, key, requestHash);
      }
    });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const pending = requestIdempotency.get(request);
    if (!pending || !idempotencyStore) return payload;
    try {
      const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
      const response = JSON.parse(text) as unknown;
      genericInflight.get(pending.inflightKey)?.resolve({ statusCode: reply.statusCode, body: response });
      if (reply.statusCode >= 200 && reply.statusCode < 300) await idempotencyStore.putOperationIdempotency(pending.scope, pending.key, { requestHash: pending.requestHash, response, statusCode: reply.statusCode });
      else await idempotencyStore.releaseOperationIdempotency?.(pending.scope, pending.key, pending.requestHash);
    } catch {
      // Non-JSON responses are intentionally not persisted by the generic write layer.
      genericInflight.get(pending.inflightKey)?.resolve({ statusCode: reply.statusCode, body: payload });
      await idempotencyStore.releaseOperationIdempotency?.(pending.scope, pending.key, pending.requestHash);
    }
    genericInflight.delete(pending.inflightKey);
    return payload;
  });

  app.addHook('onResponse', async (request) => {
    const pending = requestIdempotency.get(request);
    if (pending) genericInflight.delete(pending.inflightKey);
  });

  app.addHook('onError', async (request, _reply, error) => {
    const pending = requestIdempotency.get(request);
    if (pending) {
      const activeEntry = genericInflight.get(pending.inflightKey);
      if (activeEntry) {
        activeEntry.resolve({
          statusCode: error instanceof DomainError && error.code === 'NOT_FOUND' ? 404 : 500,
          body: { error: { code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR', message: error.message } },
        });
        genericInflight.delete(pending.inflightKey);
      }
      await idempotencyStore?.releaseOperationIdempotency?.(pending.scope, pending.key, pending.requestHash);
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS' || request.url === '/health' || request.url.startsWith('/health?')) return;
    const configuredToken = process.env.WORLD_CODEX_API_TOKEN;
    if (!configuredToken) return;
    const authorization = request.headers.authorization;
    const expected = Buffer.from(`Bearer ${configuredToken}`);
    const actual = Buffer.from(typeof authorization === 'string' ? authorization : '');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required', traceId: request.id } });
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'world-codex-api', time: new Date().toISOString() }));

  app.setErrorHandler((error, request, reply) => {
    const isDomain = error instanceof DomainError;
    const contractError = (error instanceof ZodError || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ZodError')) ? error as ZodError : null;
    const isContract = contractError !== null;
    const code = isDomain ? error.code : isContract ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
    const status = code === 'NOT_FOUND' ? 404 : code === 'REVISION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT' || code === 'IDEMPOTENCY_IN_PROGRESS' ? 409 : code === 'WORLD_ACCESS_DENIED' ? 403 : code === 'VALIDATION_ERROR' ? 422 : code === 'AI_PROVIDER_ERROR' ? 502 : 500;
    if (!isDomain) request.log.error({ err: error }, 'unhandled request error');
    return reply.status(status).send({ error: { code, message: isDomain ? error.message : contractError ? contractError.message : 'Internal server error', details: isDomain ? jsonSafe(error.details) : contractError ? { issues: contractError.issues } : undefined, traceId: requestId(request) } });
  });

  app.get<{ Querystring: PageQuery & { includeArchived?: string } }>('/api/v1/worlds', async (request) => {
    const includeArchived = request.query.includeArchived === undefined ? false : request.query.includeArchived === 'true';
    if (request.query.includeArchived !== undefined && request.query.includeArchived !== 'true' && request.query.includeArchived !== 'false') throw new DomainError('VALIDATION_ERROR', 'includeArchived must be true or false');
    return pageEnvelope((await service.listWorlds(includeArchived)).map(toWorldDto), request.query);
  });

  app.post('/api/v1/worlds', async (request, reply) => {
    const input = createWorldRequestSchema.parse(request.body);
    const world = await service.createWorld({ name: input.name, ...(input.slug === undefined ? {} : { slug: input.slug }), description: input.description, genre: input.genre, canonStrategy: input.canonStrategy });
    return reply.status(201).send({ data: toWorldDto(world) });
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId', async (request) => ({ data: toWorldDto(await service.getWorld(request.params.worldId)) }));

  app.get<{ Params: ParamsWorld; Querystring: { limit?: string } }>('/api/v1/worlds/:worldId/revisions', async (request) => {
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError('VALIDATION_ERROR', 'limit must be an integer between 1 and 100');
    return { data: (await service.listRevisions(request.params.worldId, limit)).map(toRevisionDto) };
  });

  app.get<{ Params: ParamsWorld & { sequence: string } }>('/api/v1/worlds/:worldId/revisions/:sequence/changes', async (request) => {
    if (!/^\d+$/.test(request.params.sequence)) throw new DomainError('VALIDATION_ERROR', 'revision sequence must be a non-negative integer');
    return { data: (await service.listRevisionChanges(request.params.worldId, BigInt(request.params.sequence))).map(toChangeDto) };
  });

  app.patch<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId', async (request) => {
    const input = updateWorldRequestSchema.parse(request.body);
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.genre === undefined ? {} : { genre: input.genre }),
      ...(input.canonStrategy === undefined ? {} : { canonStrategy: input.canonStrategy }),
    };
    return { data: toWorldDto(await service.updateWorld(request.params.worldId, revisionHeader(request), patch)) };
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/archive', async (request) => ({ data: toWorldDto(await service.archiveWorld(request.params.worldId, revisionHeader(request), true)) }));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/restore', async (request) => ({ data: toWorldDto(await service.archiveWorld(request.params.worldId, revisionHeader(request), false)) }));

  app.put<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/time-cursor', async (request) => {
    const input = z.object({ tick: z.string().regex(/^-?\d+$/) }).parse(request.body);
    return { data: toWorldDto(await service.updateWorldTime(request.params.worldId, revisionHeader(request), parseTick(input.tick))) };
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/entity-types', async (request) => pageEnvelope((await service.listEntityTypes(request.params.worldId)).map(toEntityTypeDto), request.query));
  app.get<{ Params: ParamsWorld & { entityTypeId: string } }>('/api/v1/worlds/:worldId/entity-types/:entityTypeId/versions', async (request) => ({ data: (await service.listEntityTypeVersions(request.params.worldId, request.params.entityTypeId)).map(toEntityTypeVersionDto) }));
  app.post<{ Params: ParamsWorld & { entityTypeId: string } }>('/api/v1/worlds/:worldId/entity-types/:entityTypeId/versions', async (request, reply) => {
    const input = z.object({ schema: z.record(z.string(), z.unknown()) }).parse(request.body);
    const result = await service.createEntityTypeVersion(request.params.worldId, request.params.entityTypeId, input.schema, revisionHeader(request));
    return reply.status(201).send({ data: toEntityTypeVersionDto(result) });
  });
  app.post<{ Params: ParamsWorld & { entityTypeId: string } }>('/api/v1/worlds/:worldId/entity-types/:entityTypeId/migrations', async (request, reply) => {
    const operationSchema = z.discriminatedUnion('op', [
      z.object({ op: z.literal('RenameField'), from: z.string().min(1), to: z.string().min(1) }),
      z.object({ op: z.literal('SetDefault'), field: z.string().min(1), value: z.unknown() }),
      z.object({ op: z.literal('MapEnum'), field: z.string().min(1), mapping: z.record(z.string(), z.string()) }),
      z.object({ op: z.literal('ChangeType'), field: z.string().min(1), value_type: z.string().min(1) }),
    ]);
    const input = z.object({ operations: z.array(operationSchema).min(1) }).parse(request.body);
    const result = await service.migrateEntityTypeSchema(request.params.worldId, request.params.entityTypeId, input.operations as import('@world-codex/domain').SchemaMigrationOp[], revisionHeader(request));
    return reply.status(201).send({ data: toEntityTypeVersionDto(result) });
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/export.json', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const bundle = await buildBundle(request.params.worldId, service, temporal);
    const world = bundle.world;
    return reply.type('application/json').header('Content-Disposition', `attachment; filename="${world.slug}.world-codex.json"`).send(bundleToJson(bundle));
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/export.md', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const bundle = await buildBundle(request.params.worldId, service, temporal);
    return reply.type('text/markdown; charset=utf-8').header('Content-Disposition', `attachment; filename="${bundle.world.slug}.md"`).send(bundleToMarkdown(bundle));
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/export.geojson', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const bundle = await buildBundle(request.params.worldId, service, temporal);
    return reply.type('application/geo+json').header('Content-Disposition', `attachment; filename="${bundle.world.slug}.geojson"`).send(bundleToGeoJson(bundle));
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/export.zip', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const bundle = await buildBundle(request.params.worldId, service, temporal);
    const assetFiles = new Map<string, Uint8Array>();
    for (const asset of bundle.assets) {
      const bytes = await assetStore.get(asset.storageKey);
      if (!bytes) throw new DomainError('INTERNAL_ERROR', 'Asset bytes are missing from storage', { assetId: asset.id });
      assetFiles.set(asset.id, bytes);
    }
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${bundle.world.slug}.world.zip"`).send(Buffer.from(bundleToZip(bundle, assetFiles)));
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/export.obsidian.zip', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const bundle = await buildBundle(request.params.worldId, service, temporal);
    const assetFiles = new Map<string, Uint8Array>();
    for (const asset of bundle.assets) {
      const bytes = await assetStore.get(asset.storageKey);
      if (!bytes) throw new DomainError('INTERNAL_ERROR', 'Asset bytes are missing from storage', { assetId: asset.id });
      assetFiles.set(asset.id, bytes);
    }
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${bundle.world.slug}.obsidian.zip"`).send(Buffer.from(bundleToObsidianZip(bundle, assetFiles)));
  });

  app.post('/api/v1/imports/inspect', async (request) => {
    const text = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    const bundle = parseBundleOrThrow(text);
    validateImportBundle(bundle);
    return { data: importInspection(bundle) };
  });

  app.post('/api/v1/imports/inspect.zip', async (request) => {
    const bundle = parseBundleZipOrThrow(request.body);
    validateImportBundle(bundle);
    return { data: importInspection(bundle) };
  });

  app.post('/api/v1/imports/inspect.markdown', async (request) => {
    const bundle = parseMarkdownOrThrow(readTextBody(request.body));
    validateImportBundle(bundle);
    return { data: importInspection(bundle) };
  });

  app.post('/api/v1/imports/inspect.csv', async (request) => {
    const input = parseCsvImportInput(request.body);
    const bundle = parseCsvOrThrow(input.text, { ...(input.worldName === undefined ? {} : { worldName: input.worldName }), ...(input.description === undefined ? {} : { description: input.description }) });
    validateImportBundle(bundle);
    return { data: importInspection(bundle) };
  });

  app.post('/api/v1/imports/commit', async (request, reply) => {
    if (!temporal || !canon) throw new DomainError('INTERNAL_ERROR', 'Import API is unavailable');
    const idempotencyKey = idempotencyHeader(request);
    const cacheKey = typeof idempotencyKey === 'string' ? `imports:${idempotencyKey}` : undefined;
    const requestHash = JSON.stringify(request.body ?? null);
    const input = z.object({ bundle: z.union([z.string(), z.record(z.string(), z.unknown())]), name: z.string().trim().min(1).max(200).optional(), slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9\u4e00-\u9fff]+(?:-[a-z0-9\u4e00-\u9fff]+)*$/).optional() }).parse(request.body);
    const bundle = parseBundleOrThrow(typeof input.bundle === 'string' ? input.bundle : JSON.stringify(input.bundle));
    validateImportBundle(bundle);
    const result = await runIdempotent(cacheKey, requestHash, async () => ({ statusCode: 201, body: { data: await importBundle(bundle, { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: input.slug }) }, service, temporal, canon, assetStore) } }), undefined, undefined, 'imports:json', idempotencyKey);
    return reply.status(result.statusCode).send(result.body);
  });

  app.post('/api/v1/imports/commit.zip', async (request, reply) => {
    if (!temporal || !canon) throw new DomainError('INTERNAL_ERROR', 'Import API is unavailable');
    const bundle = parseBundleZipOrThrow(request.body);
    const requestHash = bundleHash(bundle);
    const idempotencyKey = idempotencyHeader(request);
    const cacheKey = typeof idempotencyKey === 'string' ? `imports-zip:${idempotencyKey}` : undefined;
    validateImportBundle(bundle);
    const result = await runIdempotent(cacheKey, requestHash, async () => ({ statusCode: 201, body: { data: await importBundle(bundle, {}, service, temporal, canon, assetStore) } }), undefined, undefined, 'imports:zip', idempotencyKey);
    return reply.status(result.statusCode).send(result.body);
  });

  app.post('/api/v1/imports/commit.markdown', async (request, reply) => {
    if (!temporal || !canon) throw new DomainError('INTERNAL_ERROR', 'Import API is unavailable');
    const input = parseTextImportInput(request.body);
    const bundle = parseMarkdownOrThrow(input.text);
    validateImportBundle(bundle);
    const idempotencyKey = idempotencyHeader(request);
    const result = await runIdempotent(idempotencyKey === undefined ? undefined : `imports-markdown:${idempotencyKey}`, JSON.stringify(input), async () => ({ statusCode: 201, body: { data: await importBundle(bundle, { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: input.slug }) }, service, temporal, canon, assetStore) } }), undefined, undefined, 'imports:markdown', idempotencyKey);
    return reply.status(result.statusCode).send(result.body);
  });

  app.post('/api/v1/imports/commit.csv', async (request, reply) => {
    if (!temporal || !canon) throw new DomainError('INTERNAL_ERROR', 'Import API is unavailable');
    const input = parseCsvImportInput(request.body);
    const bundle = parseCsvOrThrow(input.text, { ...(input.worldName === undefined ? {} : { worldName: input.worldName }), ...(input.description === undefined ? {} : { description: input.description }) });
    validateImportBundle(bundle);
    const idempotencyKey = idempotencyHeader(request);
    const result = await runIdempotent(idempotencyKey === undefined ? undefined : `imports-csv:${idempotencyKey}`, JSON.stringify(input), async () => ({ statusCode: 201, body: { data: await importBundle(bundle, { ...(input.name === undefined ? {} : { name: input.name }), ...(input.slug === undefined ? {} : { slug: input.slug }) }, service, temporal, canon, assetStore) } }), undefined, undefined, 'imports:csv', idempotencyKey);
    return reply.status(result.statusCode).send(result.body);
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/entity-types', async (request, reply) => {
    const input = createEntityTypeRequestSchema.parse(request.body);
    const result = await service.createEntityType(request.params.worldId, input, revisionHeader(request));
    return reply.status(201).send({ data: toEntityTypeDto(result) });
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/entities', async (request, reply) => {
    const input = createEntityDraftRequestSchema.parse(request.body);
    const world = await service.getWorld(request.params.worldId);
    const entity = await service.createEntityDraft(request.params.worldId, { typeId: input.typeId, name: input.name, subtitle: input.subtitle, parentEntityId: input.parentEntityId, document: input.document, tags: input.tags, documentText: extractDocumentText(input.document) }, revisionHeader(request));
    return reply.status(201).header('ETag', String(world.revision + 1n)).send({ data: toEntityDto(entity) });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/entities', async (request) => pageEnvelope((await service.listEntities(request.params.worldId)).map(toEntityDto), request.query));

  app.get<{ Params: ParamsEntity }>('/api/v1/worlds/:worldId/entities/:entityId/backlinks', async (request) => ({
    data: (await service.listEntityBacklinks(request.params.worldId, request.params.entityId)).map((item) => ({
      entityId: item.entityId,
      name: item.name,
      links: item.links.map((link) => ({ name: link.name, kind: link.kind, ...(link.display === undefined ? {} : { display: link.display }) })),
    })),
  }));

  app.get<{ Params: ParamsEntity }>('/api/v1/worlds/:worldId/entities/:entityId/unlinked-mentions', async (request) => ({
    data: (await service.listUnlinkedMentions(request.params.worldId, request.params.entityId)).map((item) => ({ name: item.name, entityId: item.entityId })),
  }));

  app.post<{ Params: ParamsEntity }>('/api/v1/worlds/:worldId/entities/:entityId/link-mention', async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(300) }).parse(request.body);
    const entity = await service.linkEntityMention(request.params.worldId, request.params.entityId, input.name, revisionHeader(request));
    return reply.send({ data: toEntityDto(entity) });
  });

  app.get<{ Params: ParamsEntity }>('/api/v1/worlds/:worldId/entities/:entityId', async (request) => {
    const entity = await service.getEntity(request.params.worldId, request.params.entityId);
    return { data: toEntityDto(entity) };
  });

  app.patch<{ Params: ParamsEntity }>('/api/v1/worlds/:worldId/entities/:entityId', async (request) => {
    const input = z.object({ name: z.string().trim().min(1).max(300).optional(), subtitle: z.string().max(500).optional(), parentEntityId: z.string().uuid().nullable().optional(), document: z.record(z.string(), z.unknown()).optional(), tags: z.array(z.string().trim().min(1).max(80)).max(100).optional() }).parse(request.body);
    const patch = { ...(input.name === undefined ? {} : { name: input.name }), ...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }), ...(input.parentEntityId === undefined ? {} : { parentEntityId: input.parentEntityId }), ...(input.document === undefined ? {} : { document: input.document, documentText: extractDocumentText(input.document) }), ...(input.tags === undefined ? {} : { tags: input.tags }) };
    return { data: toEntityDto(await service.updateEntityDraft(request.params.worldId, request.params.entityId, patch, revisionHeader(request))) };
  });

  app.get<{ Params: ParamsWorld; Querystring: { q?: string; limit?: string } }>('/api/v1/worlds/:worldId/search', async (request) => {
    const query = request.query.q?.trim();
    if (!query) throw new DomainError('VALIDATION_ERROR', 'q is required');
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError('VALIDATION_ERROR', 'limit must be an integer between 1 and 100');
    return { data: await service.search(request.params.worldId, query, limit) };
  });

  app.get<{ Params: ParamsWorld; Querystring: { entityId?: string; depth?: string; atTick?: string } }>('/api/v1/worlds/:worldId/graph/neighborhood', async (request) => {
    if (!temporal || !request.query.entityId) throw new DomainError('VALIDATION_ERROR', 'entityId is required');
    const depth = request.query.depth === undefined ? 1 : Number(request.query.depth);
    if (request.query.atTick !== undefined && !/^-?\d+$/.test(request.query.atTick)) throw new DomainError('VALIDATION_ERROR', 'atTick must be an integer');
    const atTick = request.query.atTick === undefined ? 0n : parseTick(request.query.atTick);
    const graph = await temporal.getNeighborhood(request.params.worldId, request.query.entityId, depth, atTick);
    return { data: { entities: graph.entities.map(toEntityDto), relations: graph.relations.map(toRelationDto) } };
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/validation', async (request) => {
    if (!validateWorldState) throw new DomainError('INTERNAL_ERROR', 'Validation API is unavailable');
    return { data: { issues: await validateWorldState(request.params.worldId), rulesetVersion: 'deterministic-v1' } };
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/validation/incremental', async (request) => {
    if (!validateWorldIncrementalState) throw new DomainError('INTERNAL_ERROR', 'Validation API is unavailable');
    const input = validateIncrementalRequestSchema.parse(request.body);
    const result = await validateWorldIncrementalState(request.params.worldId, input.changeSet);
    return { data: result };
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/rules', async (request) => {
    return pageEnvelope((await service.listValidationRules(request.params.worldId)).map(toValidationRuleDto), request.query);
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/rules', async (request, reply) => {
    const input = createValidationRuleRequestSchema.parse(request.body);
    const rule = await service.createValidationRule(request.params.worldId, input, revisionHeader(request));
    return reply.status(201).send({ data: toValidationRuleDto(rule) });
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/rules/test', async (request) => {
    const input = testValidationRuleRequestSchema.parse(request.body);
    const world = await service.getWorld(request.params.worldId);
    const [entities, entityTypes, facts, relationTypes, relations, events] = await Promise.all([
      service.listEntities(request.params.worldId),
      service.listEntityTypes(request.params.worldId),
      temporal ? temporal.listFacts(request.params.worldId) : [],
      temporal ? temporal.listRelationTypes(request.params.worldId) : [],
      temporal ? temporal.listRelations(request.params.worldId) : [],
      temporal ? temporal.listEvents(request.params.worldId) : [],
    ]);
    const tempRule: import('@world-codex/domain').ValidationRule = {
      id: 'test-rule',
      worldId: request.params.worldId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      severity: input.severity,
      target: input.target,
      ...(input.targetSelector !== undefined ? { targetSelector: input.targetSelector } : {}),
      ...(input.when !== undefined ? { when: input.when } : {}),
      assert: input.assert,
      ...(input.message !== undefined ? { message: input.message } : {}),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const issues = evaluateRule(
      tempRule,
      {
        world,
        entities,
        entityTypes,
        facts,
        relationTypes,
        relations,
        events,
      },
      { includeDrafts: input.includeDrafts },
    );
    return {
      data: {
        pass: issues.length === 0,
        issues,
      },
    };
  });

  app.get<{ Params: ParamsRule }>('/api/v1/worlds/:worldId/rules/:ruleId', async (request) => {
    return { data: toValidationRuleDto(await service.getValidationRule(request.params.worldId, request.params.ruleId)) };
  });

  app.patch<{ Params: ParamsRule }>('/api/v1/worlds/:worldId/rules/:ruleId', async (request) => {
    const patch = updateValidationRuleRequestSchema.parse(request.body);
    return { data: toValidationRuleDto(await service.updateValidationRule(request.params.worldId, request.params.ruleId, patch, revisionHeader(request))) };
  });

  app.delete<{ Params: ParamsRule }>('/api/v1/worlds/:worldId/rules/:ruleId', async (request, reply) => {
    await service.deleteValidationRule(request.params.worldId, request.params.ruleId, revisionHeader(request));
    return reply.status(204).send();
  });

  // --- Narrative: Works ---
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/works', async (request, reply) => {
    const input = createWorkRequestSchema.parse(request.body);
    const work = await service.createWork(request.params.worldId, input, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(201).header('ETag', String(world.revision)).send({ data: toWorkDto(work) });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/works', async (request) => {
    const works = await service.listWorks(request.params.worldId);
    return pageEnvelope(works.map(toWorkDto), request.query);
  });

  app.get<{ Params: ParamsWork }>('/api/v1/worlds/:worldId/works/:workId', async (request) => {
    const work = await service.getWork(request.params.worldId, request.params.workId);
    if (!work) throw new DomainError('NOT_FOUND', 'Work not found', { workId: request.params.workId });
    return { data: toWorkDto(work) };
  });

  app.patch<{ Params: ParamsWork }>('/api/v1/worlds/:worldId/works/:workId', async (request, reply) => {
    const patch = updateWorkRequestSchema.parse(request.body);
    const work = await service.updateWork(request.params.worldId, request.params.workId, patch, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.header('ETag', String(world.revision)).send({ data: toWorkDto(work) });
  });

  app.delete<{ Params: ParamsWork }>('/api/v1/worlds/:worldId/works/:workId', async (request, reply) => {
    await service.deleteWork(request.params.worldId, request.params.workId, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(204).header('ETag', String(world.revision)).send();
  });

  // --- Narrative: Chapters ---
  app.post<{ Params: ParamsWork }>('/api/v1/worlds/:worldId/works/:workId/chapters', async (request, reply) => {
    const input = createChapterRequestSchema.parse(request.body);
    const chapter = await service.createChapter(request.params.worldId, request.params.workId, input, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(201).header('ETag', String(world.revision)).send({ data: toChapterDto(chapter) });
  });

  app.get<{ Params: ParamsWork; Querystring: PageQuery }>('/api/v1/worlds/:worldId/works/:workId/chapters', async (request) => {
    const chapters = await service.listChapters(request.params.worldId, request.params.workId);
    return pageEnvelope(chapters.map(toChapterDto), request.query);
  });

  app.get<{ Params: ParamsChapter }>('/api/v1/worlds/:worldId/chapters/:chapterId', async (request) => {
    const chapter = await service.getChapter(request.params.worldId, request.params.chapterId);
    if (!chapter) throw new DomainError('NOT_FOUND', 'Chapter not found', { chapterId: request.params.chapterId });
    return { data: toChapterDto(chapter) };
  });

  app.patch<{ Params: ParamsChapter }>('/api/v1/worlds/:worldId/chapters/:chapterId', async (request, reply) => {
    const patch = updateChapterRequestSchema.parse(request.body);
    const chapter = await service.updateChapter(request.params.worldId, request.params.chapterId, patch, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.header('ETag', String(world.revision)).send({ data: toChapterDto(chapter) });
  });

  app.delete<{ Params: ParamsChapter }>('/api/v1/worlds/:worldId/chapters/:chapterId', async (request, reply) => {
    await service.deleteChapter(request.params.worldId, request.params.chapterId, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(204).header('ETag', String(world.revision)).send();
  });

  // --- Narrative: Scenes ---
  app.post<{ Params: ParamsChapter }>('/api/v1/worlds/:worldId/chapters/:chapterId/scenes', async (request, reply) => {
    const input = createSceneRequestSchema.parse(request.body);
    const scene = await service.createScene(request.params.worldId, request.params.chapterId, input, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(201).header('ETag', String(world.revision)).send({ data: toSceneDto(scene) });
  });

  app.get<{ Params: ParamsChapter; Querystring: PageQuery }>('/api/v1/worlds/:worldId/chapters/:chapterId/scenes', async (request) => {
    const scenes = await service.listScenes(request.params.worldId, request.params.chapterId);
    return pageEnvelope(scenes.map(toSceneDto), request.query);
  });

  app.get<{ Params: ParamsScene }>('/api/v1/worlds/:worldId/scenes/:sceneId', async (request) => {
    const scene = await service.getScene(request.params.worldId, request.params.sceneId);
    if (!scene) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId: request.params.sceneId });
    return { data: toSceneDto(scene) };
  });

  app.patch<{ Params: ParamsScene }>('/api/v1/worlds/:worldId/scenes/:sceneId', async (request, reply) => {
    const patch = updateSceneRequestSchema.parse(request.body);
    const scene = await service.updateScene(request.params.worldId, request.params.sceneId, patch, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.header('ETag', String(world.revision)).send({ data: toSceneDto(scene) });
  });

  app.delete<{ Params: ParamsScene }>('/api/v1/worlds/:worldId/scenes/:sceneId', async (request, reply) => {
    await service.deleteScene(request.params.worldId, request.params.sceneId, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(204).header('ETag', String(world.revision)).send();
  });

  // --- Narrative: Scene Snapshot ---
  app.get<{ Params: ParamsScene }>('/api/v1/worlds/:worldId/scenes/:sceneId/snapshot', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const scene = await service.getScene(request.params.worldId, request.params.sceneId);
    if (!scene) throw new DomainError('NOT_FOUND', 'Scene not found', { sceneId: request.params.sceneId });
    const world = await service.getWorld(request.params.worldId);
    const atTick = scene.sceneTick ?? world.currentTick;
    const asOfRevision = scene.canonRevision ?? undefined;
    const state = await temporal.getSnapshot(request.params.worldId, atTick, asOfRevision);
    let snapshot = computeSnapshot(state.world, atTick, state.entities, state.facts, state.relations, state.relationTypes, state.events, state.mapFeatures, {
      ...(asOfRevision === undefined ? {} : { asOfRevision }),
    });
    return {
      data: toSnapshotDto(snapshot, state.world.revision),
      scene: toSceneDto(scene),
      atTick: atTick.toString(),
      ...(asOfRevision === undefined ? {} : { asOfRevision: asOfRevision.toString() }),
    };
  });

  // --- Narrative: Continuity Review ---
  app.post<{ Params: ParamsScene }>('/api/v1/worlds/:worldId/scenes/:sceneId/continuity-review', async (request) => {
    const result = await service.reviewSceneContinuity(request.params.worldId, request.params.sceneId);
    return { data: result };
  });

  // --- Narrative: Plotlines ---
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/plotlines', async (request, reply) => {
    const input = createPlotlineRequestSchema.parse(request.body);
    const plotline = await service.createPlotline(request.params.worldId, input, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(201).header('ETag', String(world.revision)).send({ data: toPlotlineDto(plotline) });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/plotlines', async (request) => {
    const plotlines = await service.listPlotlines(request.params.worldId);
    return pageEnvelope(plotlines.map(toPlotlineDto), request.query);
  });

  app.get<{ Params: ParamsPlotline }>('/api/v1/worlds/:worldId/plotlines/:plotlineId', async (request) => {
    const plotline = await service.getPlotline(request.params.worldId, request.params.plotlineId);
    if (!plotline) throw new DomainError('NOT_FOUND', 'Plotline not found', { plotlineId: request.params.plotlineId });
    return { data: toPlotlineDto(plotline) };
  });

  app.patch<{ Params: ParamsPlotline }>('/api/v1/worlds/:worldId/plotlines/:plotlineId', async (request, reply) => {
    const patch = updatePlotlineRequestSchema.parse(request.body);
    const plotline = await service.updatePlotline(request.params.worldId, request.params.plotlineId, patch, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.header('ETag', String(world.revision)).send({ data: toPlotlineDto(plotline) });
  });

  app.delete<{ Params: ParamsPlotline }>('/api/v1/worlds/:worldId/plotlines/:plotlineId', async (request, reply) => {
    await service.deletePlotline(request.params.worldId, request.params.plotlineId, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(204).header('ETag', String(world.revision)).send();
  });

  // --- Narrative: Foreshadowings ---
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/foreshadowings', async (request, reply) => {
    const input = createForeshadowingRequestSchema.parse(request.body);
    const foreshadowing = await service.createForeshadowing(request.params.worldId, input, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(201).header('ETag', String(world.revision)).send({ data: toForeshadowingDto(foreshadowing) });
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/foreshadowings/audit', async (request) => {
    const result = await service.auditForeshadowings(request.params.worldId);
    return { data: result };
  });

  app.get<{ Params: ParamsWorld; Querystring: ForeshadowingListQuery }>('/api/v1/worlds/:worldId/foreshadowings', async (request) => {
    const foreshadowings = await service.listForeshadowings(request.params.worldId, request.query.plotlineId);
    return pageEnvelope(foreshadowings.map(toForeshadowingDto), request.query);
  });

  app.get<{ Params: ParamsForeshadowing }>('/api/v1/worlds/:worldId/foreshadowings/:foreshadowingId', async (request) => {
    const foreshadowing = await service.getForeshadowing(request.params.worldId, request.params.foreshadowingId);
    if (!foreshadowing) throw new DomainError('NOT_FOUND', 'Foreshadowing not found', { foreshadowingId: request.params.foreshadowingId });
    return { data: toForeshadowingDto(foreshadowing) };
  });

  app.patch<{ Params: ParamsForeshadowing }>('/api/v1/worlds/:worldId/foreshadowings/:foreshadowingId', async (request, reply) => {
    const patch = updateForeshadowingRequestSchema.parse(request.body);
    const foreshadowing = await service.updateForeshadowing(request.params.worldId, request.params.foreshadowingId, patch, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.header('ETag', String(world.revision)).send({ data: toForeshadowingDto(foreshadowing) });
  });

  app.delete<{ Params: ParamsForeshadowing }>('/api/v1/worlds/:worldId/foreshadowings/:foreshadowingId', async (request, reply) => {
    await service.deleteForeshadowing(request.params.worldId, request.params.foreshadowingId, revisionHeader(request));
    const world = await service.getWorld(request.params.worldId);
    return reply.status(204).header('ETag', String(world.revision)).send();
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/ai/proposals', async (request, reply) => {
    const input = z.object({ request: z.string().trim().min(1).max(20_000), baseWorldRevision: z.string().regex(/^\d+$/), atTick: z.string().regex(/^-?\d+$/).optional(), changes: z.array(z.object({ id: z.string().min(1), command: z.string().min(1), payload: z.record(z.string(), z.unknown()).default({}), dependsOn: z.array(z.string()).default([]), evidenceRefs: z.array(z.string()).default([]), confidence: z.number().min(0).max(1).default(0), userDecision: z.literal('pending').default('pending') })).max(500).default([]) }).parse(request.body);
    const world = await service.getWorld(request.params.worldId);
    if (world.archivedAt) throw new DomainError('VALIDATION_ERROR', 'Archived worlds are read-only', { worldId: world.id });
    const baseRevision = parseRevision(input.baseWorldRevision);
    if (world.revision !== baseRevision) throw new DomainError('REVISION_CONFLICT', 'Proposal base revision is stale', { expected: baseRevision.toString(), actual: world.revision.toString() });
    let contextRefs: string[] = [];
    let generated: Pick<ProposalRecord, 'provider' | 'model' | 'promptVersion' | 'contextRefs' | 'changes' | 'citations' | 'unknowns'> = { provider: 'none', promptVersion: 'canon-context-v1', contextRefs: [], changes: input.changes as ProposalRecord['changes'], citations: [], unknowns: input.changes.length ? [] : ['No AI provider is configured; provide structured changes for offline review'] };
    if (proposalProvider) {
      const atTick = input.atTick === undefined ? undefined : parseTick(input.atTick);
      const [facts, relations, events, search] = temporal
        ? await Promise.all([temporal.listFacts(request.params.worldId), temporal.listRelations(request.params.worldId), temporal.listEvents(request.params.worldId), service.search(request.params.worldId, input.request, 20)])
        : [[], [], [], await service.search(request.params.worldId, input.request, 20)] as const;
      try {
      const context = buildCanonContext({ world, entities: await service.listEntities(request.params.worldId), facts, relations, events, search, ...(atTick === undefined ? {} : { atTick }), limit: 200 });
      contextRefs = [...context.entities.map((item) => item.id), ...context.facts.map((item) => item.id), ...context.relations.map((item) => item.id), ...context.events.map((item) => item.id), ...context.search.map((item) => item.id)].slice(0, 500);
      generated = await proposalProvider.generate({ request: input.request, worldId: request.params.worldId, baseWorldRevision: baseRevision, ...(atTick === undefined ? {} : { atTick }), context: jsonSafe(context) as Record<string, unknown> });
      } catch (error) {
        if (error instanceof AiProviderError) throw new DomainError('AI_PROVIDER_ERROR', error.message, error.details);
        throw error;
      }
    }
    const proposal: ProposalRecord = { id: randomUUID(), worldId: request.params.worldId, baseRevision, request: input.request, ...(input.atTick === undefined ? {} : { atTick: parseTick(input.atTick) }), provider: generated.provider, ...(generated.model === undefined ? {} : { model: generated.model }), promptVersion: generated.promptVersion ?? 'canon-context-v1', contextRefs: generated.contextRefs?.length ? generated.contextRefs : contextRefs, changes: generated.changes, citations: generated.citations, unknowns: generated.unknowns, status: 'draft', createdAt: new Date().toISOString() };
    await writeProposal(proposal, true);
    return reply.status(202).send({ data: jsonSafe(proposal) });
  });

  app.get<{ Params: ParamsWorld & { proposalId: string } }>('/api/v1/worlds/:worldId/ai/proposals/:proposalId', async (request) => {
    const proposal = await readProposal(request.params.worldId, request.params.proposalId);
    if (!proposal || proposal.worldId !== request.params.worldId) throw new DomainError('NOT_FOUND', 'Proposal not found');
    return { data: jsonSafe(proposal) };
  });

  app.post<{ Params: ParamsWorld & { proposalId: string } }>('/api/v1/worlds/:worldId/ai/proposals/:proposalId/validate', async (request) => {
    const proposal = await readProposal(request.params.worldId, request.params.proposalId);
    if (!proposal || proposal.worldId !== request.params.worldId) throw new DomainError('NOT_FOUND', 'Proposal not found');
    const world = await service.getWorld(request.params.worldId);
    const issues = [
      ...(validateWorldState ? await validateWorldState(request.params.worldId) : []),
      ...(temporal ? await validateProposalReferences(request.params.worldId, proposal.changes, service, temporal) : []),
    ];
    return { data: { proposalId: proposal.id, stale: world.revision !== proposal.baseRevision, issues } };
  });

  app.post<{ Params: ParamsWorld & { proposalId: string } }>('/api/v1/worlds/:worldId/ai/proposals/:proposalId/reject', async (request) => {
    const proposal = await readProposal(request.params.worldId, request.params.proposalId);
    if (!proposal || proposal.worldId !== request.params.worldId) throw new DomainError('NOT_FOUND', 'Proposal not found');
    if (proposal.status !== 'draft') throw new DomainError('VALIDATION_ERROR', 'Only draft proposals can be rejected', { status: proposal.status });
    const world = await service.getWorld(request.params.worldId);
    if (world.archivedAt) throw new DomainError('VALIDATION_ERROR', 'Archived worlds are read-only', { worldId: world.id });
    proposal.status = 'rejected';
    await writeProposal(proposal);
    return { data: jsonSafe(proposal) };
  });

  app.post<{ Params: ParamsWorld & { proposalId: string } }>('/api/v1/worlds/:worldId/ai/proposals/:proposalId/accept', async (request) => {
    const proposal = await readProposal(request.params.worldId, request.params.proposalId);
    if (!proposal || proposal.worldId !== request.params.worldId) throw new DomainError('NOT_FOUND', 'Proposal not found');
    if (proposal.status !== 'draft') throw new DomainError('VALIDATION_ERROR', 'Only draft proposals can be accepted', { status: proposal.status });
    if (!canon) throw new DomainError('INTERNAL_ERROR', 'Canon API is unavailable');
    const world = await service.getWorld(request.params.worldId);
    if (world.revision !== proposal.baseRevision) { proposal.status = 'stale'; await writeProposal(proposal); throw new DomainError('REVISION_CONFLICT', 'Proposal is stale', { expected: proposal.baseRevision.toString(), actual: world.revision.toString() }); }
    if (!proposal.changes.length) throw new DomainError('VALIDATION_ERROR', 'Proposal contains no accepted changes');
    const selection = z.object({ changeIds: z.array(z.string().min(1)).max(500).optional() }).optional().parse(request.body);
    const requestedIds = selection?.changeIds;
    if (requestedIds && new Set(requestedIds).size !== requestedIds.length) throw new DomainError('VALIDATION_ERROR', 'changeIds must be unique');
    if (requestedIds && requestedIds.some((id) => !proposal.changes.some((change) => change.id === id))) throw new DomainError('VALIDATION_ERROR', 'changeIds contains an unknown proposal change');
    const selectedChanges = requestedIds ? proposal.changes.filter((change) => requestedIds.includes(change.id) && change.userDecision === 'pending') : proposal.changes.filter((change) => change.userDecision === 'pending');
    if (requestedIds && selectedChanges.length !== requestedIds.length) throw new DomainError('VALIDATION_ERROR', 'changeIds must refer to pending proposal changes');
    if (!selectedChanges.length) throw new DomainError('VALIDATION_ERROR', 'Proposal has no pending changes to accept');
    const selectedIds = new Set(selectedChanges.map((change) => change.id));
    for (const change of selectedChanges) {
      for (const dependency of change.dependsOn) {
        const dependencyChange = proposal.changes.find((candidate) => candidate.id === dependency);
        if (!dependencyChange) throw new DomainError('VALIDATION_ERROR', 'Proposal dependency is unknown', { changeId: change.id, dependency });
        if (dependencyChange.userDecision === 'rejected' || (!selectedIds.has(dependency) && dependencyChange.userDecision !== 'accepted')) throw new DomainError('VALIDATION_ERROR', 'Proposal dependencies must be accepted together', { changeId: change.id, dependency });
      }
    }
    const orderedChanges = topologicalProposalChanges(selectedChanges);
    const canonChanges: Array<{ kind: 'entity' | 'fact' | 'relation' | 'event'; id: string; status: 'pending' | 'canon' | 'retconned' | 'archived' }> = [];
    for (const change of orderedChanges) {
      if (change.command !== 'SetCanonStatus') throw new DomainError('VALIDATION_ERROR', 'Only SetCanonStatus proposal changes can be accepted in the offline provider', { command: change.command });
      const payload = z.object({ kind: z.enum(['entity', 'fact', 'relation', 'event']), id: z.string().uuid(), status: z.enum(['pending', 'canon', 'retconned', 'archived']), reason: z.string().trim().min(1) }).parse(change.payload);
      canonChanges.push(payload);
    }
    await canon.changeStatuses(request.params.worldId, canonChanges, world.revision, 'Accepted AI proposal changes');
    for (const change of orderedChanges) change.userDecision = 'accepted';
    const latestWorld = await service.getWorld(request.params.worldId);
    const hasPendingChanges = proposal.changes.some((change) => change.userDecision === 'pending');
    proposal.baseRevision = latestWorld.revision;
    proposal.status = hasPendingChanges ? 'draft' : 'accepted';
    await writeProposal(proposal);
    return { data: jsonSafe(proposal) };
  });

  app.get<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/calendars', async (request) => ({ data: (await service.listCalendars(request.params.worldId)).map(toCalendarDto) }));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/calendars', async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(200), definition: calendarDefinitionInputSchema }).parse(request.body);
    const result = await service.createCalendar(request.params.worldId, { name: input.name, definition: toCalendarDefinition(input.definition) }, revisionHeader(request));
    return reply.status(201).send({ data: { calendar: toCalendarDto(result.calendar), version: toCalendarVersionDto(result.version) } });
  });
  app.get<{ Params: ParamsWorld & { calendarId: string } }>('/api/v1/worlds/:worldId/calendars/:calendarId/versions', async (request) => ({ data: (await service.listCalendarVersions(request.params.worldId, request.params.calendarId)).map(toCalendarVersionDto) }));
  app.post<{ Params: ParamsWorld & { calendarId: string } }>('/api/v1/worlds/:worldId/calendars/:calendarId/versions', async (request, reply) => {
    const input = z.object({ definition: calendarDefinitionInputSchema }).parse(request.body);
    const result = await service.createCalendarVersion(request.params.worldId, request.params.calendarId, toCalendarDefinition(input.definition), revisionHeader(request));
    return reply.status(201).send({ data: toCalendarVersionDto(result) });
  });
  app.post<{ Params: ParamsWorld & { calendarId: string; versionId: string } }>('/api/v1/worlds/:worldId/calendars/:calendarId/versions/:versionId/default', async (request) => {
    const versions = await service.listCalendarVersions(request.params.worldId, request.params.calendarId);
    if (!versions.some((version) => version.id === request.params.versionId)) throw new DomainError('NOT_FOUND', 'Calendar version not found', { versionId: request.params.versionId });
    return { data: toWorldDto(await service.setDefaultCalendarVersion(request.params.worldId, request.params.versionId, revisionHeader(request))) };
  });
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/calendars/convert', async (request) => {
    const input = z.object({ calendarVersionId: z.string().uuid().optional(), definition: calendarDefinitionInputSchema.optional(), date: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).optional(), tick: z.string().regex(/^-?\d+$/).optional() }).refine((value) => value.date !== undefined || value.tick !== undefined, { message: 'date or tick is required' }).refine((value) => value.calendarVersionId !== undefined || value.definition !== undefined, { message: 'calendarVersionId or definition is required' }).parse(request.body);
    const definition = input.calendarVersionId === undefined ? toCalendarDefinition(input.definition!) : (await service.getCalendarVersion(request.params.worldId, input.calendarVersionId)).definition;
    try {
      if (input.date) return { data: { tick: dateToTick(definition, { calendarId: definition.id, ...input.date }).toString(), calendarVersionId: input.calendarVersionId } };
      return { data: { ...tickToDate(definition, parseTick(input.tick as string)), calendarVersionId: input.calendarVersionId } };
    } catch (error) {
      if (error instanceof CalendarError) throw new DomainError('VALIDATION_ERROR', error.message, error.details);
      throw error;
    }
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/maps', async (request) => pageEnvelope((await service.listMaps(request.params.worldId)).map(toMapDto), request.query));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/maps', async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(200), crs: z.string().trim().min(1).max(100).default('CRS.Simple'), width: z.number().positive(), height: z.number().positive(), assetId: z.string().uuid().optional() }).parse(request.body);
    return reply.status(201).send({ data: toMapDto(await service.createMap(request.params.worldId, { name: input.name, crs: input.crs, width: input.width, height: input.height, ...(input.assetId === undefined ? {} : { assetId: input.assetId }) }, revisionHeader(request))) });
  });
  app.get<{ Params: ParamsMap }>('/api/v1/worlds/:worldId/maps/:mapId/layers', async (request) => ({ data: (await service.listMapLayers(request.params.worldId, request.params.mapId)).map(toMapLayerDto) }));
  app.post<{ Params: ParamsMap }>('/api/v1/worlds/:worldId/maps/:mapId/layers', async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(200), kind: z.enum(['base', 'overlay', 'annotation']).default('overlay'), sortOrder: z.number().int().min(0).max(100_000).default(0), visible: z.boolean().default(true), opacity: z.number().min(0).max(1).default(1), style: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    const layer = await service.createMapLayer(request.params.worldId, request.params.mapId, { ...input, style: validateMapStyle(input.style) }, revisionHeader(request));
    return reply.status(201).send({ data: toMapLayerDto(layer) });
  });
  app.patch<{ Params: ParamsMap & { layerId: string } }>('/api/v1/worlds/:worldId/maps/:mapId/layers/:layerId', async (request) => {
    const input = z.object({ name: z.string().trim().min(1).max(200), kind: z.enum(['base', 'overlay', 'annotation']), sortOrder: z.number().int().min(0).max(100_000), visible: z.boolean(), opacity: z.number().min(0).max(1), style: z.record(z.string(), z.unknown()) }).partial().refine((value) => Object.keys(value).length > 0, { message: 'At least one map layer field is required' }).parse(request.body);
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      ...(input.visible === undefined ? {} : { visible: input.visible }),
      ...(input.opacity === undefined ? {} : { opacity: input.opacity }),
      ...(input.style === undefined ? {} : { style: validateMapStyle(input.style) }),
    };
    return { data: toMapLayerDto(await service.updateMapLayer(request.params.worldId, request.params.mapId, request.params.layerId, patch, revisionHeader(request))) };
  });
  app.get<{ Params: ParamsMap; Querystring: PageQuery }>('/api/v1/worlds/:worldId/maps/:mapId/features', async (request) => pageEnvelope((await service.listMapFeatures(request.params.worldId, request.params.mapId)).map(toMapFeatureDto), request.query));
  app.post<{ Params: ParamsMap }>('/api/v1/worlds/:worldId/maps/:mapId/features', async (request, reply) => {
    const input = z.object({ layerId: z.string().uuid().optional(), entityId: z.string().uuid().optional(), kind: z.enum(['marker', 'polygon', 'polyline', 'label']), geometry: z.record(z.string(), z.unknown()), properties: z.record(z.string(), z.unknown()).default({}), validFromTick: z.string().regex(/^-?\d+$/).optional(), validToTick: z.string().regex(/^-?\d+$/).optional() }).parse(request.body);
    const geometry = validateGeometry(input.kind, input.geometry);
    const feature = await service.createMapFeature(request.params.worldId, request.params.mapId, { ...(input.layerId === undefined ? {} : { layerId: input.layerId }), ...(input.entityId === undefined ? {} : { entityId: input.entityId }), kind: input.kind, geometry, properties: validateMapProperties(input.properties), ...(input.validFromTick === undefined ? {} : { validFromTick: parseTick(input.validFromTick) }), ...(input.validToTick === undefined ? {} : { validToTick: parseTick(input.validToTick) }) }, revisionHeader(request));
    return reply.status(201).send({ data: toMapFeatureDto(feature) });
  });
  app.post<{ Params: ParamsMap }>('/api/v1/worlds/:worldId/maps/:mapId/import.geojson', async (request, reply) => {
    const input = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({ type: z.literal('Feature'), geometry: z.record(z.string(), z.unknown()), properties: z.record(z.string(), z.unknown()).default({}) })).max(200_000) }).parse(request.body);
    const world = await service.getWorld(request.params.worldId);
    if (world.archivedAt) throw new DomainError('VALIDATION_ERROR', 'Archived worlds are read-only', { worldId: world.id });
    await service.listMapFeatures(request.params.worldId, request.params.mapId);
    const layers = new Set((await service.listMapLayers(request.params.worldId, request.params.mapId)).map((layer) => layer.id));
    const entities = new Set((await service.listEntities(request.params.worldId)).map((entity) => entity.id));
    const normalized = input.features.map((source) => {
      const kind: 'marker' | 'polygon' | 'polyline' | null = source.geometry.type === 'Point' ? 'marker' : source.geometry.type === 'Polygon' ? 'polygon' : source.geometry.type === 'LineString' ? 'polyline' : null;
      if (!kind) throw new DomainError('VALIDATION_ERROR', 'GeoJSON feature geometry must be Point, Polygon, or LineString');
      const rawEntityId = source.properties.entityId;
      if (rawEntityId !== undefined && (!z.string().uuid().safeParse(rawEntityId).success || !entities.has(String(rawEntityId)))) throw new DomainError('VALIDATION_ERROR', 'GeoJSON feature entityId must reference an entity in this world', { entityId: rawEntityId });
      const rawLayerId = source.properties.layerId;
      if (rawLayerId !== undefined && (!z.string().uuid().safeParse(rawLayerId).success || !layers.has(String(rawLayerId)))) throw new DomainError('VALIDATION_ERROR', 'GeoJSON feature layerId must reference a layer in this map', { layerId: rawLayerId });
      const properties = { ...source.properties };
      delete properties.entityId;
      delete properties.layerId;
      return { kind, ...(rawLayerId === undefined ? {} : { layerId: String(rawLayerId) }), ...(rawEntityId === undefined ? {} : { entityId: String(rawEntityId) }), geometry: validateGeometry(kind, source.geometry), properties: validateMapProperties(properties) };
    });
    const features = (await service.createMapFeatures(request.params.worldId, request.params.mapId, normalized, revisionHeader(request))).map(toMapFeatureDto);
    return reply.status(201).send({ data: { count: features.length, features } });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/assets', async (request) => pageEnvelope((await service.listAssets(request.params.worldId)).map(toAssetDto), request.query));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/assets', async (request, reply) => {
    const bytes = Buffer.isBuffer(request.body) ? request.body : null;
    if (!bytes) throw new DomainError('VALIDATION_ERROR', 'Asset upload requires application/octet-stream body');
    const maxBytes = 25 * 1024 * 1024;
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new DomainError('VALIDATION_ERROR', 'Asset must be between 1 byte and 25 MiB');
    const declaredMediaType = typeof request.headers['x-asset-media-type'] === 'string' ? request.headers['x-asset-media-type'] : request.headers['content-type'];
    const mediaType = detectRasterMediaType(bytes);
    if (!mediaType || declaredMediaType !== mediaType) throw new DomainError('VALIDATION_ERROR', 'Asset MIME does not match a supported raster signature', { declaredMediaType, detectedMediaType: mediaType });
    const expectedRevision = revisionHeader(request);
    const world = await service.getWorld(request.params.worldId);
    if (world.archivedAt) throw new DomainError('VALIDATION_ERROR', 'Archived worlds are read-only', { worldId: world.id });
    if (world.revision !== expectedRevision) throw new DomainError('REVISION_CONFLICT', 'World revision does not match', { expected: expectedRevision.toString(), actual: world.revision.toString() });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = mediaType === 'image/png' ? 'png' : mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'gif';
    const storageKey = `${request.params.worldId}/${sha256}.${extension}`;
    const stored = await assetStore.put(storageKey, Buffer.from(bytes));
    try {
      const asset = await service.createAsset(request.params.worldId, { storageKey, mediaType, byteSize: BigInt(bytes.byteLength), sha256, metadata: { fileName: safeFileName(request.headers['x-file-name']), detectedMediaType: mediaType }, scanStatus: 'passed', scanMessage: 'Signature and size checks passed' }, expectedRevision);
      return reply.status(201).send({ data: toAssetDto(asset) });
    } catch (error) {
      if (stored && !(await service.listAssets(request.params.worldId)).some((asset) => asset.storageKey === storageKey)) await assetStore.delete(storageKey);
      throw error;
    }
  });
  app.get<{ Params: ParamsWorld & { assetId: string } }>('/api/v1/worlds/:worldId/assets/:assetId', async (request, reply) => {
    const asset = await service.getAsset(request.params.worldId, request.params.assetId);
    if (asset.scanStatus !== 'passed') throw new DomainError('NOT_FOUND', 'Asset is not available');
    const bytes = await assetStore.get(asset.storageKey);
    if (!bytes) throw new DomainError('NOT_FOUND', 'Asset bytes not found', { assetId: asset.id });
    return reply.type(asset.mediaType).header('Content-Length', asset.byteSize.toString()).send(bytes);
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/facts', async (request) => pageEnvelope(temporal ? (await temporal.listFacts(request.params.worldId)).map(toFactDto) : [], request.query));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/facts', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const input = createFactRequestSchema.parse(request.body);
    const fact = await temporal.createFact(request.params.worldId, { ...(input.branchId === undefined ? {} : { branchId: input.branchId }), subjectEntityId: input.subjectEntityId, predicateKey: input.predicateKey, objectKind: input.objectKind, value: input.value ?? null, ...(input.objectEntityId === undefined ? {} : { objectEntityId: input.objectEntityId }), ...(input.validFromTick === undefined ? {} : { validFromTick: parseTick(input.validFromTick) }), ...(input.validToTick === undefined ? {} : { validToTick: parseTick(input.validToTick) }), sourceKind: input.sourceKind }, revisionHeader(request));
    return reply.status(201).send({ data: toFactDto(fact) });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/relation-types', async (request) => pageEnvelope(temporal ? await temporal.listRelationTypes(request.params.worldId) : [], request.query));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/relation-types', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const input = createRelationTypeRequestSchema.parse(request.body);
    const result = await temporal.createRelationType(request.params.worldId, { forwardLabel: input.forwardLabel, ...(input.inverseLabel === undefined ? {} : { inverseLabel: input.inverseLabel }), symmetric: input.symmetric, sourceTypeIds: input.sourceTypeIds, targetTypeIds: input.targetTypeIds }, revisionHeader(request));
    return reply.status(201).send({ data: result });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/relations', async (request) => pageEnvelope(temporal ? (await temporal.listRelations(request.params.worldId)).map(toRelationDto) : [], request.query));
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/relations', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const input = createRelationRequestSchema.parse(request.body);
    const relation = await temporal.createRelation(request.params.worldId, { ...(input.branchId === undefined ? {} : { branchId: input.branchId }), sourceEntityId: input.sourceEntityId, targetEntityId: input.targetEntityId, relationTypeId: input.relationTypeId, ...(input.validFromTick === undefined ? {} : { validFromTick: parseTick(input.validFromTick) }), ...(input.validToTick === undefined ? {} : { validToTick: parseTick(input.validToTick) }), description: input.description }, revisionHeader(request));
    return reply.status(201).send({ data: toRelationDto(relation) });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/events', async (request) => pageEnvelope(temporal ? (await temporal.listEvents(request.params.worldId)).map(toEventDto) : [], request.query));
  app.get<{ Params: ParamsWorld; Querystring: { fromTick?: string; toTick?: string; canonStatus?: string } }>('/api/v1/worlds/:worldId/timeline', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    if (!request.query.fromTick || !request.query.toTick || !/^-?\d+$/.test(request.query.fromTick) || !/^-?\d+$/.test(request.query.toTick)) throw new DomainError('VALIDATION_ERROR', 'fromTick and toTick are required integers');
    const allowedStatuses = ['canon', 'pending', 'retconned', 'draft', 'all'];
    const canonStatus = request.query.canonStatus ?? 'canon';
    if (!allowedStatuses.includes(canonStatus)) throw new DomainError('VALIDATION_ERROR', 'canonStatus must be canon, pending, retconned, draft, or all');
    const result = await temporal.getTimeline(request.params.worldId, parseTick(request.query.fromTick), parseTick(request.query.toTick), { canonStatus: canonStatus as 'canon' | 'pending' | 'retconned' | 'draft' | 'all' });
    return { data: { facts: result.facts.map(toFactDto), relations: result.relations.map(toRelationDto), events: result.events.map(toEventDto), fromTick: request.query.fromTick, toTick: request.query.toTick, canonStatus } };
  });
  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/events', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const idempotencyKey = idempotencyHeader(request);
    const cacheKey = typeof idempotencyKey === 'string' ? `${request.params.worldId}:events:${idempotencyKey}` : undefined;
    const requestHash = JSON.stringify(request.body ?? null);
    const input = createEventRequestSchema.parse(request.body);
    const result = await runIdempotent(cacheKey, requestHash, async () => {
      const participantRoles = input.participants ?? input.participantIds.map((entityId) => ({ entityId, role: 'participant' }));
      let temporalExpression: import('@world-codex/domain').TemporalExpression | undefined;
      if (input.temporalExpression) {
        temporalExpression = {
          kind: input.temporalExpression.kind,
          ...(input.temporalExpression.startTick === undefined ? {} : { startTick: parseTick(input.temporalExpression.startTick) }),
          ...(input.temporalExpression.endTick === undefined ? {} : { endTick: parseTick(input.temporalExpression.endTick) }),
          ...(input.temporalExpression.precision === undefined ? {} : { precision: input.temporalExpression.precision }),
          ...(input.temporalExpression.relativeToEventId === undefined ? {} : { relativeToEventId: input.temporalExpression.relativeToEventId }),
          ...(input.temporalExpression.relativeOffsetTicks === undefined ? {} : { relativeOffsetTicks: parseTick(input.temporalExpression.relativeOffsetTicks) }),
          ...(input.temporalExpression.displayLabel === undefined ? {} : { displayLabel: input.temporalExpression.displayLabel }),
        };
      }
      const causalLinks: import('@world-codex/domain').EventCausalLink[] = input.causalLinks.map((link) => ({
        targetEventId: link.targetEventId,
        kind: link.kind,
        ...(link.description ? { description: link.description } : {}),
      }));
      const event = await temporal.createEvent(request.params.worldId, {
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
        name: input.name,
        eventType: input.eventType,
        startTick: parseTick(input.startTick),
        ...(input.endTick === undefined ? {} : { endTick: parseTick(input.endTick) }),
        ...(temporalExpression === undefined ? {} : { temporalExpression }),
        ...(causalLinks.length === 0 ? {} : { causalLinks }),
        participantIds: [...new Set(participantRoles.map((participant) => participant.entityId))],
        participantRoles,
        requiredRoles: input.requiredRoles,
        locationEntityIds: input.locationEntityIds,
        causeEventIds: input.causeEventIds,
        resultEventIds: input.resultEventIds,
        effects: input.effects.map((effect) => ({ id: effect.id ?? randomUUID(), type: effect.type, ...(effect.targetId === undefined ? {} : { targetId: effect.targetId }), payload: effect.payload, sequence: effect.sequence })),
        description: input.description,
      }, revisionHeader(request));
      return { statusCode: 201, body: { data: toEventDto(event) } };
    }, request.params.worldId, typeof idempotencyKey === 'string' ? idempotencyKey : undefined);
    return reply.status(result.statusCode).send(result.body);
  });

  app.get<{ Params: ParamsWorld & { eventId: string } }>('/api/v1/worlds/:worldId/events/:eventId/causality', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const causality = await temporal.getEventCausality(request.params.worldId, request.params.eventId);
    const toPathNodeDto = (node: typeof causality.upstreamCauses[number]): import('@world-codex/contracts').EventCausalityPathNodeDto => ({
      eventId: node.eventId,
      name: node.name,
      eventType: node.eventType,
      startTick: node.startTick.toString(),
      canonStatus: node.canonStatus,
      ...(node.relationKind === undefined ? {} : { relationKind: node.relationKind }),
      ...(node.description === undefined ? {} : { description: node.description }),
    });
    const result: import('@world-codex/contracts').EventCausalitySummaryDto = {
      event: toEventDto(causality.event),
      upstreamCauses: causality.upstreamCauses.map(toPathNodeDto),
      downstreamConsequences: causality.downstreamConsequences.map(toPathNodeDto),
      contradictingEvents: causality.contradictingEvents.map(toPathNodeDto),
      hasCycle: causality.hasCycle,
    };
    return { data: result };
  });

  async function runIdempotent(cacheKey: string | undefined, requestHash: string, execute: () => Promise<IdempotentResult>, persistentWorldId?: string, persistentKey?: string, operationScope?: string, operationKey?: string): Promise<IdempotentResult> {
    if (!cacheKey) return execute();
    if (persistentWorldId && persistentKey && idempotencyStore) {
      const persisted = await idempotencyStore.getIdempotency(persistentWorldId, persistentKey);
      if (persisted) {
        if (persisted.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload');
        return { statusCode: 201, body: persisted.response };
      }
    }
    if (operationScope && operationKey && idempotencyStore) {
      const persisted = await idempotencyStore.getOperationIdempotency(operationScope, operationKey);
      if (persisted) {
        if (persisted.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload');
        return { statusCode: persisted.statusCode ?? 200, body: persisted.response };
      }
    }
    const cached = idempotencyResponses.get(cacheKey);
    if (cached && Date.now() - cached.createdAt <= 10 * 60_000) {
      if (cached.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload');
      return { statusCode: cached.statusCode, body: cached.body };
    }
    if (cached) idempotencyResponses.delete(cacheKey);
    const active = idempotencyInflight.get(cacheKey);
    if (active) {
      if (active.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key is already in use with a different payload');
      return active.promise;
    }
    const promise = execute();
    idempotencyInflight.set(cacheKey, { requestHash, promise });
    try {
      const result = await promise;
      idempotencyResponses.set(cacheKey, { ...result, requestHash, createdAt: Date.now() });
      trimIdempotencyCache(idempotencyResponses);
      if (persistentWorldId && persistentKey && idempotencyStore) await idempotencyStore.putIdempotency(persistentWorldId, persistentKey, { requestHash, response: result.body, statusCode: result.statusCode });
      if (operationScope && operationKey && idempotencyStore) await idempotencyStore.putOperationIdempotency(operationScope, operationKey, { requestHash, response: result.body, statusCode: result.statusCode });
      return result;
    } finally {
      idempotencyInflight.delete(cacheKey);
    }
  }

  app.post<{ Params: ParamsCanon }>('/api/v1/worlds/:worldId/canon/:kind/:itemId', async (request) => {
    if (!canon) throw new DomainError('INTERNAL_ERROR', 'Canon API is unavailable');
    const kind = z.enum(['entity', 'fact', 'relation', 'event', 'claim']).parse(request.params.kind);
    const input = canonStatusChangeRequestSchema.parse(request.body);
    const result = await canon.changeStatus(request.params.worldId, kind, request.params.itemId, input.status, revisionHeader(request), input.reason);
    return { data: jsonSafe(result) };
  });

  app.get<{ Params: ParamsWorld; Querystring: { atTick?: string; entityIds?: string; asOfRevision?: string; branchId?: string } }>('/api/v1/worlds/:worldId/snapshot', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    if (!request.query.atTick || !/^-?\d+$/.test(request.query.atTick)) throw new DomainError('VALIDATION_ERROR', 'atTick is required');
    const atTick = parseTick(request.query.atTick);
    const asOfRevision = request.query.asOfRevision && /^\d+$/.test(request.query.asOfRevision) ? BigInt(request.query.asOfRevision) : undefined;
    const branchId = request.query.branchId?.trim() || undefined;
    const state = await temporal.getSnapshot(request.params.worldId, atTick, asOfRevision, branchId);
    let snapshot = computeSnapshot(state.world, atTick, state.entities, state.facts, state.relations, state.relationTypes, state.events, state.mapFeatures, {
      ...(asOfRevision === undefined ? {} : { asOfRevision }),
      ...(branchId === undefined ? {} : { branchId }),
    });
    const requestedIds = request.query.entityIds?.split(',').filter(Boolean) ?? [];
    if (requestedIds.length > 100 || requestedIds.some((id) => !z.string().uuid().safeParse(id).success)) throw new DomainError('VALIDATION_ERROR', 'entityIds must contain at most 100 comma-separated UUIDs');
    if (!requestedIds.length && snapshot.entities.length > 500) throw new DomainError('VALIDATION_ERROR', 'Large snapshots require an entityIds scope');
    if (requestedIds.length) {
      const selected = new Set(requestedIds);
      snapshot = { ...snapshot, entities: snapshot.entities.filter((entity) => selected.has(entity.id)), facts: snapshot.facts.filter((fact) => selected.has(fact.subjectEntityId) && (fact.objectKind !== 'entity' || (fact.objectEntityId && selected.has(fact.objectEntityId)))), relations: snapshot.relations.filter((relation) => selected.has(relation.sourceEntityId) && selected.has(relation.targetEntityId)), mapFeatures: snapshot.mapFeatures.filter((feature) => feature.entityId === undefined || selected.has(feature.entityId)), activeEvents: snapshot.activeEvents.filter((event) => event.participantIds.some((id) => selected.has(id)) || event.locationEntityIds.some((id) => selected.has(id))) };
    }
    return {
      data: toSnapshotDto(snapshot, state.world.revision),
      atTick: request.query.atTick,
      ...(asOfRevision === undefined ? {} : { asOfRevision: asOfRevision.toString() }),
      ...(branchId === undefined ? {} : { branchId }),
    };
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery }>('/api/v1/worlds/:worldId/branches', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const branches = await temporal.listBranches(request.params.worldId);
    return pageEnvelope(branches.map(toTimelineBranchDto), request.query);
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/branches', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const input = createBranchRequestSchema.parse(request.body);
    const branch = await temporal.createBranch(request.params.worldId, {
      name: input.name,
      parentBranchId: input.parentBranchId ?? null,
      forkTick: input.forkTick ? parseTick(input.forkTick) : null,
      status: input.status,
    }, revisionHeader(request));
    return reply.status(201).send({ data: toTimelineBranchDto(branch) });
  });

  app.get<{ Params: ParamsWorld; Querystring: PageQuery & { subjectEntityId?: string; assertedByEntityId?: string; claimKind?: string; truthStatus?: string; canonStatus?: string; branchId?: string } }>('/api/v1/worlds/:worldId/claims', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const query = claimQuerySchema.parse(request.query);
    const filter = {
      ...(query.subjectEntityId !== undefined ? { subjectEntityId: query.subjectEntityId } : {}),
      ...(query.assertedByEntityId !== undefined ? { assertedByEntityId: query.assertedByEntityId } : {}),
      ...(query.claimKind !== undefined ? { claimKind: query.claimKind } : {}),
      ...(query.truthStatus !== undefined ? { truthStatus: query.truthStatus } : {}),
      ...(query.canonStatus !== undefined ? { canonStatus: query.canonStatus } : {}),
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
    };
    const claims = await temporal.listClaims(request.params.worldId, filter);
    return pageEnvelope(claims.map(toClaimDto), request.query);
  });

  app.post<{ Params: ParamsWorld }>('/api/v1/worlds/:worldId/claims', async (request, reply) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const input = createClaimRequestSchema.parse(request.body);
    const claim = await temporal.createClaim(
      request.params.worldId,
      {
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
        ...(input.subjectEntityId === undefined ? {} : { subjectEntityId: input.subjectEntityId }),
        predicateKey: input.predicateKey,
        objectKind: input.objectKind,
        value: input.value ?? null,
        ...(input.objectEntityId === undefined ? {} : { objectEntityId: input.objectEntityId }),
        ...(input.assertedByEntityId === undefined ? {} : { assertedByEntityId: input.assertedByEntityId }),
        knownByEntityIds: input.knownByEntityIds,
        ...(input.validFromTick === undefined ? {} : { validFromTick: parseTick(input.validFromTick) }),
        ...(input.validToTick === undefined ? {} : { validToTick: parseTick(input.validToTick) }),
        truthStatus: input.truthStatus,
        claimKind: input.claimKind,
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        sourceRefs: input.sourceRefs,
      },
      revisionHeader(request)
    );
    return reply.status(201).send({ data: toClaimDto(claim) });
  });

  app.get<{ Params: ParamsWorld & { claimId: string } }>('/api/v1/worlds/:worldId/claims/:claimId', async (request) => {
    if (!temporal) throw new DomainError('INTERNAL_ERROR', 'Temporal API is unavailable');
    const claim = await temporal.getClaim(request.params.worldId, request.params.claimId);
    if (!claim) throw new DomainError('NOT_FOUND', 'Claim not found', { claimId: request.params.claimId });
    return { data: toClaimDto(claim) };
  });

  return app;
}

function toWorldDto(world: import('@world-codex/domain').World): WorldDto {
  return { id: world.id, ownerId: world.ownerId, name: world.name, slug: world.slug, description: world.description, genre: world.genre, canonStrategy: world.canonStrategy, defaultCalendarVersionId: world.defaultCalendarVersionId ?? null, currentTick: world.currentTick.toString(), revision: world.revision.toString(), createdAt: world.createdAt.toISOString(), updatedAt: world.updatedAt.toISOString(), archivedAt: world.archivedAt?.toISOString() ?? null };
}

function toRevisionDto(revision: import('@world-codex/application').RevisionRecord): Record<string, unknown> {
  return { id: revision.id, worldId: revision.worldId, sequence: revision.sequence.toString(), actorType: revision.actorType, sourceKind: revision.sourceKind, reason: revision.reason, changeSetHash: revision.changeSetHash, recordedAt: revision.recordedAt.toISOString() };
}

function toChangeDto(change: import('@world-codex/application').ChangeRecord): Record<string, unknown> {
  return { id: change.id, worldId: change.worldId, revisionId: change.revisionId, sequence: change.sequence.toString(), objectType: change.objectType, objectId: change.objectId, operation: change.operation, patch: change.patch };
}

function toEntityTypeDto(type: import('@world-codex/domain').EntityType): EntityTypeDto {
  return { id: type.id, worldId: type.worldId, typeKey: type.typeKey, label: type.label, schemaVersion: type.schemaVersion, schema: type.schema, createdAt: type.createdAt.toISOString(), updatedAt: type.updatedAt.toISOString() };
}

function toEntityTypeVersionDto(version: import('@world-codex/domain').EntityTypeVersion): Record<string, unknown> {
  return { id: version.id, worldId: version.worldId, entityTypeId: version.entityTypeId, schemaVersion: version.schemaVersion, schema: version.schema, createdRevision: version.createdRevision.toString(), createdAt: version.createdAt.toISOString() };
}

function toEntityDto(entity: import('@world-codex/domain').Entity): EntityDto {
  return { id: entity.id, worldId: entity.worldId, typeId: entity.typeId, ...(entity.schemaVersion === undefined ? {} : { schemaVersion: entity.schemaVersion }), name: entity.name, subtitle: entity.subtitle, parentEntityId: entity.parentEntityId, document: entity.document, documentText: entity.documentText, tags: entity.tags, canonStatus: entity.canonStatus, revision: entity.revision.toString(), createdAt: entity.createdAt.toISOString(), updatedAt: entity.updatedAt.toISOString() };
}

function toFactDto(fact: import('@world-codex/domain').Fact): FactDto {
  return {
    id: fact.id,
    worldId: fact.worldId,
    ...(fact.branchId === undefined ? {} : { branchId: fact.branchId }),
    subjectEntityId: fact.subjectEntityId,
    predicateKey: fact.predicateKey,
    objectKind: fact.objectKind,
    value: fact.value,
    ...(fact.objectEntityId === undefined ? {} : { objectEntityId: fact.objectEntityId }),
    ...(fact.validFromTick === undefined ? {} : { validFromTick: fact.validFromTick.toString() }),
    ...(fact.validToTick === undefined ? {} : { validToTick: fact.validToTick.toString() }),
    canonStatus: fact.canonStatus,
    sourceKind: fact.sourceKind,
    ...(fact.sourceRefId === undefined ? {} : { sourceRefId: fact.sourceRefId }),
    ...(fact.createdRevision === undefined ? {} : { createdRevision: fact.createdRevision.toString() }),
    ...(fact.retconnedRevision === undefined ? {} : { retconnedRevision: fact.retconnedRevision.toString() }),
    ...(fact.revisionFrom === undefined ? {} : { revisionFrom: fact.revisionFrom.toString() }),
    ...(fact.revisionTo === undefined ? {} : { revisionTo: fact.revisionTo === null ? null : fact.revisionTo.toString() }),
  };
}

function toRelationDto(relation: import('@world-codex/domain').Relation): RelationDto {
  return {
    id: relation.id,
    worldId: relation.worldId,
    ...(relation.branchId === undefined ? {} : { branchId: relation.branchId }),
    sourceEntityId: relation.sourceEntityId,
    targetEntityId: relation.targetEntityId,
    relationTypeId: relation.relationTypeId,
    ...(relation.validFromTick === undefined ? {} : { validFromTick: relation.validFromTick.toString() }),
    ...(relation.validToTick === undefined ? {} : { validToTick: relation.validToTick.toString() }),
    description: relation.description,
    canonStatus: relation.canonStatus,
    ...(relation.sourceKind === undefined ? {} : { sourceKind: relation.sourceKind }),
    ...(relation.sourceRefId === undefined ? {} : { sourceRefId: relation.sourceRefId }),
    ...(relation.createdRevision === undefined ? {} : { createdRevision: relation.createdRevision.toString() }),
    ...(relation.retconnedRevision === undefined ? {} : { retconnedRevision: relation.retconnedRevision.toString() }),
    ...(relation.revisionFrom === undefined ? {} : { revisionFrom: relation.revisionFrom.toString() }),
    ...(relation.revisionTo === undefined ? {} : { revisionTo: relation.revisionTo === null ? null : relation.revisionTo.toString() }),
  };
}

function toEventDto(event: WorldEvent): EventDto {
  return {
    id: event.id,
    worldId: event.worldId,
    ...(event.branchId === undefined ? {} : { branchId: event.branchId }),
    name: event.name,
    eventType: event.eventType,
    startTick: event.startTick.toString(),
    ...(event.endTick === undefined ? {} : { endTick: event.endTick.toString() }),
    ...(event.temporalExpression === undefined ? {} : {
      temporalExpression: {
        kind: event.temporalExpression.kind,
        ...(event.temporalExpression.startTick === undefined ? {} : { startTick: event.temporalExpression.startTick.toString() }),
        ...(event.temporalExpression.endTick === undefined ? {} : { endTick: event.temporalExpression.endTick.toString() }),
        ...(event.temporalExpression.precision === undefined ? {} : { precision: event.temporalExpression.precision }),
        ...(event.temporalExpression.relativeToEventId === undefined ? {} : { relativeToEventId: event.temporalExpression.relativeToEventId }),
        ...(event.temporalExpression.relativeOffsetTicks === undefined ? {} : { relativeOffsetTicks: event.temporalExpression.relativeOffsetTicks.toString() }),
        ...(event.temporalExpression.displayLabel === undefined ? {} : { displayLabel: event.temporalExpression.displayLabel }),
      },
    }),
    ...(event.causalLinks === undefined ? {} : {
      causalLinks: event.causalLinks.map((link) => ({
        targetEventId: link.targetEventId,
        kind: link.kind,
        ...(link.description === undefined ? {} : { description: link.description }),
      })),
    }),
    participantIds: event.participantIds,
    ...(event.participantRoles === undefined ? {} : { participants: event.participantRoles }),
    ...(event.requiredRoles === undefined ? {} : { requiredRoles: event.requiredRoles }),
    locationEntityIds: event.locationEntityIds,
    causeEventIds: event.causeEventIds,
    resultEventIds: event.resultEventIds,
    effects: event.effects as unknown as Record<string, unknown>[],
    description: event.description,
    canonStatus: event.canonStatus,
    ...(event.createdRevision === undefined ? {} : { createdRevision: event.createdRevision.toString() }),
  };
}

function toMapDto(map: import('@world-codex/domain').WorldMap): Record<string, unknown> & { id: string } {
  return { ...map, ...(map.assetId === undefined ? {} : { assetId: map.assetId }), createdAt: map.createdAt.toISOString(), updatedAt: map.updatedAt.toISOString() };
}

function toMapLayerDto(layer: import('@world-codex/domain').MapLayer): Record<string, unknown> {
  return { ...layer, createdAt: layer.createdAt.toISOString(), updatedAt: layer.updatedAt.toISOString() };
}

function toMapFeatureDto(feature: import('@world-codex/domain').MapFeature): Record<string, unknown> & { id: string } {
  return {
    id: feature.id,
    worldId: feature.worldId,
    ...(feature.branchId === undefined ? {} : { branchId: feature.branchId }),
    mapId: feature.mapId,
    ...(feature.layerId === undefined ? {} : { layerId: feature.layerId }),
    ...(feature.entityId === undefined ? {} : { entityId: feature.entityId }),
    kind: feature.kind,
    geometry: feature.geometry,
    properties: feature.properties,
    ...(feature.validFromTick === undefined ? {} : { validFromTick: feature.validFromTick.toString() }),
    ...(feature.validToTick === undefined ? {} : { validToTick: feature.validToTick.toString() }),
    ...(feature.sourceKind === undefined ? {} : { sourceKind: feature.sourceKind }),
    ...(feature.sourceRefId === undefined ? {} : { sourceRefId: feature.sourceRefId }),
    ...(feature.createdRevision === undefined ? {} : { createdRevision: feature.createdRevision.toString() }),
    ...(feature.retconnedRevision === undefined ? {} : { retconnedRevision: feature.retconnedRevision.toString() }),
    ...(feature.revisionFrom === undefined ? {} : { revisionFrom: feature.revisionFrom.toString() }),
    ...(feature.revisionTo === undefined ? {} : { revisionTo: feature.revisionTo === null ? null : feature.revisionTo.toString() }),
    createdAt: feature.createdAt.toISOString(),
    updatedAt: feature.updatedAt.toISOString(),
  };
}

function toTimelineBranchDto(branch: import('@world-codex/domain').TimelineBranch): TimelineBranchDto {
  return {
    id: branch.id,
    worldId: branch.worldId,
    name: branch.name,
    ...(branch.parentBranchId === undefined || branch.parentBranchId === null ? {} : { parentBranchId: branch.parentBranchId }),
    ...(branch.forkTick === undefined || branch.forkTick === null ? {} : { forkTick: branch.forkTick.toString() }),
    ...(branch.forkRevision === undefined || branch.forkRevision === null ? {} : { forkRevision: branch.forkRevision.toString() }),
    status: branch.status,
    createdAt: branch.createdAt.toISOString(),
  };
}

function toClaimDto(claim: import('@world-codex/domain').Claim): ClaimDto {
  return {
    id: claim.id,
    worldId: claim.worldId,
    ...(claim.branchId === undefined ? {} : { branchId: claim.branchId }),
    ...(claim.subjectEntityId === undefined ? {} : { subjectEntityId: claim.subjectEntityId }),
    predicateKey: claim.predicateKey,
    objectKind: claim.objectKind,
    value: claim.value,
    ...(claim.objectEntityId === undefined ? {} : { objectEntityId: claim.objectEntityId }),
    ...(claim.assertedByEntityId === undefined ? {} : { assertedByEntityId: claim.assertedByEntityId }),
    knownByEntityIds: claim.knownByEntityIds,
    ...(claim.validFromTick === undefined ? {} : { validFromTick: claim.validFromTick.toString() }),
    ...(claim.validToTick === undefined ? {} : { validToTick: claim.validToTick.toString() }),
    truthStatus: claim.truthStatus,
    claimKind: claim.claimKind,
    ...(claim.confidence === undefined ? {} : { confidence: claim.confidence }),
    sourceRefs: claim.sourceRefs,
    canonStatus: claim.canonStatus,
    ...(claim.createdRevision === undefined ? {} : { createdRevision: claim.createdRevision.toString() }),
    ...(claim.retconnedRevision === undefined ? {} : { retconnedRevision: claim.retconnedRevision.toString() }),
    ...(claim.revisionFrom === undefined ? {} : { revisionFrom: claim.revisionFrom.toString() }),
    ...(claim.revisionTo === undefined ? {} : { revisionTo: claim.revisionTo === null ? null : claim.revisionTo.toString() }),
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
  };
}

function toAssetDto(asset: import('@world-codex/domain').Asset): Record<string, unknown> & { id: string } {
  return { id: asset.id, worldId: asset.worldId, storageKey: asset.storageKey, mediaType: asset.mediaType, byteSize: asset.byteSize.toString(), sha256: asset.sha256, metadata: asset.metadata, scanStatus: asset.scanStatus, scanMessage: asset.scanMessage, createdAt: asset.createdAt.toISOString() };
}

function toValidationRuleDto(rule: import('@world-codex/domain').ValidationRule): ValidationRuleDto {
  return {
    id: rule.id,
    worldId: rule.worldId,
    name: rule.name,
    ...(rule.description !== undefined ? { description: rule.description } : {}),
    severity: rule.severity,
    target: rule.target,
    ...(rule.targetSelector !== undefined ? { targetSelector: rule.targetSelector } : {}),
    ...(rule.when !== undefined ? { when: rule.when } : {}),
    assert: rule.assert,
    ...(rule.message !== undefined ? { message: rule.message } : {}),
    enabled: rule.enabled,
    ...(rule.createdRevision !== undefined ? { createdRevision: rule.createdRevision.toString() } : {}),
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function toWorkDto(work: import('@world-codex/domain').Work): WorkDto {
  return {
    id: work.id,
    worldId: work.worldId,
    title: work.title,
    type: work.type,
    ...(work.description === undefined ? {} : { description: work.description }),
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
  };
}

function toChapterDto(chapter: import('@world-codex/domain').Chapter): ChapterDto {
  return {
    id: chapter.id,
    worldId: chapter.worldId,
    workId: chapter.workId,
    title: chapter.title,
    orderIndex: chapter.orderIndex,
    ...(chapter.description === undefined ? {} : { description: chapter.description }),
    createdAt: chapter.createdAt.toISOString(),
    updatedAt: chapter.updatedAt.toISOString(),
  };
}

function toSceneDto(scene: import('@world-codex/domain').Scene): SceneDto {
  return {
    id: scene.id,
    worldId: scene.worldId,
    workId: scene.workId,
    chapterId: scene.chapterId,
    ...(scene.title === undefined ? {} : { title: scene.title }),
    orderIndex: scene.orderIndex,
    ...(scene.sceneTick === undefined ? {} : { sceneTick: scene.sceneTick.toString() }),
    ...(scene.povCharacterId === undefined ? {} : { povCharacterId: scene.povCharacterId }),
    ...(scene.locationEntityId === undefined ? {} : { locationEntityId: scene.locationEntityId }),
    participantEntityIds: [...scene.participantEntityIds],
    plotlineIds: scene.plotlineIds ? [...scene.plotlineIds] : [],
    proseText: scene.proseText,
    status: scene.status,
    ...(scene.canonRevision === undefined ? {} : { canonRevision: scene.canonRevision.toString() }),
    createdAt: scene.createdAt.toISOString(),
    updatedAt: scene.updatedAt.toISOString(),
  };
}

function toPlotlineDto(plotline: import('@world-codex/domain').Plotline): PlotlineDto {
  return {
    id: plotline.id,
    worldId: plotline.worldId,
    title: plotline.title,
    summary: plotline.summary,
    status: plotline.status,
    currentStage: plotline.currentStage,
    characterEntityIds: [...plotline.characterEntityIds],
    eventIds: [...plotline.eventIds],
    createdAt: plotline.createdAt.toISOString(),
    updatedAt: plotline.updatedAt.toISOString(),
  };
}

function toForeshadowingDto(foreshadowing: import('@world-codex/domain').Foreshadowing): ForeshadowingDto {
  return {
    id: foreshadowing.id,
    worldId: foreshadowing.worldId,
    title: foreshadowing.title,
    description: foreshadowing.description,
    setupSceneId: foreshadowing.setupSceneId,
    ...(foreshadowing.setupTick === undefined ? {} : { setupTick: foreshadowing.setupTick.toString() }),
    ...(foreshadowing.payoffSceneId === undefined ? {} : { payoffSceneId: foreshadowing.payoffSceneId }),
    ...(foreshadowing.payoffTick === undefined ? {} : { payoffTick: foreshadowing.payoffTick.toString() }),
    relatedEntityIds: [...foreshadowing.relatedEntityIds],
    ...(foreshadowing.plotlineId === undefined ? {} : { plotlineId: foreshadowing.plotlineId }),
    status: foreshadowing.status,
    createdAt: foreshadowing.createdAt.toISOString(),
    updatedAt: foreshadowing.updatedAt.toISOString(),
  };
}

function safeFileName(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 'upload';
  return raw.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'upload';
}

function detectRasterMediaType(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function toCalendarDefinition(input: z.infer<typeof calendarDefinitionInputSchema>): CalendarDefinition {
  return {
    id: input.id,
    name: input.name,
    yearZero: input.yearZero,
    daysPerWeek: input.daysPerWeek,
    weekdays: input.weekdays,
    months: input.months,
    eras: input.eras.map((era) => era.endTick === undefined ? { id: era.id, name: era.name, abbreviation: era.abbreviation, startTick: parseTick(era.startTick) } : { id: era.id, name: era.name, abbreviation: era.abbreviation, startTick: parseTick(era.startTick), endTick: parseTick(era.endTick) }),
    ...(input.leapRule === undefined ? {} : { leapRule: input.leapRule.monthId === undefined ? { everyYears: input.leapRule.everyYears, extraDays: input.leapRule.extraDays } : { everyYears: input.leapRule.everyYears, extraDays: input.leapRule.extraDays, monthId: input.leapRule.monthId } }),
  };
}

function toCalendarDto(calendar: import('@world-codex/application').CalendarRecord): Record<string, unknown> {
  return { id: calendar.id, worldId: calendar.worldId, name: calendar.name, currentVersion: calendar.currentVersion, createdAt: calendar.createdAt.toISOString(), updatedAt: calendar.updatedAt.toISOString() };
}

function toCalendarVersionDto(version: import('@world-codex/application').CalendarVersionRecord): Record<string, unknown> {
  return { id: version.id, worldId: version.worldId, calendarId: version.calendarId, version: version.version, definition: { ...version.definition, eras: version.definition.eras.map((era) => ({ ...era, startTick: era.startTick.toString(), ...(era.endTick === undefined ? {} : { endTick: era.endTick.toString() }) })) }, createdRevision: version.createdRevision.toString(), createdAt: version.createdAt.toISOString() };
}

function validateGeometry(kind: import('@world-codex/domain').MapFeature['kind'], geometry: Record<string, unknown>): Record<string, unknown> {
  if (!['marker', 'polygon', 'polyline', 'label'].includes(kind)) throw new DomainError('VALIDATION_ERROR', 'Unsupported map feature kind');
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (kind === 'marker' && type !== 'Point') throw new DomainError('VALIDATION_ERROR', 'Marker geometry must be a Point');
  if (kind === 'polygon' && type !== 'Polygon') throw new DomainError('VALIDATION_ERROR', 'Polygon geometry must be a Polygon');
  if (kind === 'polyline' && type !== 'LineString') throw new DomainError('VALIDATION_ERROR', 'Polyline geometry must be a LineString');
  if (kind === 'label' && type !== 'Point') throw new DomainError('VALIDATION_ERROR', 'Label geometry must be a Point');
  if (!Array.isArray(coordinates) || coordinates.length === 0) throw new DomainError('VALIDATION_ERROR', 'Geometry coordinates are required');
  const position = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
  if (type === 'Point' && !position(coordinates)) throw new DomainError('VALIDATION_ERROR', 'Point geometry requires exactly two finite coordinates');
  if (type === 'LineString' && (!coordinates.every(position) || coordinates.length < 2)) throw new DomainError('VALIDATION_ERROR', 'Polyline geometry requires at least two positions');
  if (type === 'Polygon' && (!coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(position) && JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1])))) throw new DomainError('VALIDATION_ERROR', 'Polygon geometry requires closed rings with at least four positions');
  let coordinateCount = 0;
  const visit = (value: unknown): void => { if (Array.isArray(value)) value.forEach(visit); else if (typeof value === 'number' && Number.isFinite(value)) coordinateCount += 1; else throw new DomainError('VALIDATION_ERROR', 'Geometry coordinates must be finite numbers'); };
  visit(coordinates);
  if (coordinateCount > 20_000) throw new DomainError('VALIDATION_ERROR', 'Geometry contains too many coordinates');
  return geometry;
}

function validateMapProperties(properties: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(properties).length > 100) throw new DomainError('VALIDATION_ERROR', 'Map feature properties contain too many keys');
  let serialized: string;
  try { serialized = JSON.stringify(properties, (_key, value) => typeof value === 'bigint' ? `${value}n` : value); } catch { throw new DomainError('VALIDATION_ERROR', 'Map feature properties are not serializable'); }
  if (serialized.length > 100_000) throw new DomainError('VALIDATION_ERROR', 'Map feature properties are too large');
  return properties;
}

function validateMapStyle(style: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(style).length > 100) throw new DomainError('VALIDATION_ERROR', 'Map layer style contains too many keys');
  let serialized: string;
  try { serialized = JSON.stringify(style, (_key, value) => typeof value === 'bigint' ? `${value}n` : value); } catch { throw new DomainError('VALIDATION_ERROR', 'Map layer style is not serializable'); }
  if (serialized.length > 100_000) throw new DomainError('VALIDATION_ERROR', 'Map layer style is too large');
  return style;
}

function toSnapshotDto(snapshot: ReturnType<typeof computeSnapshot>, revision: bigint): Record<string, unknown> {
  return {
    worldId: snapshot.worldId,
    tick: snapshot.tick.toString(),
    revision: revision.toString(),
    ...(snapshot.asOfRevision === undefined ? {} : { asOfRevision: snapshot.asOfRevision.toString() }),
    ...(snapshot.branchId === undefined ? {} : { branchId: snapshot.branchId }),
    entities: snapshot.entities.map(toEntityDto),
    facts: snapshot.facts.map(toFactDto),
    relations: snapshot.relations.map((relation) => ({ ...toRelationDto(relation), sourceName: relation.sourceName, targetName: relation.targetName, relationLabel: relation.relationLabel })),
    mapFeatures: snapshot.mapFeatures.map(toMapFeatureDto),
    activeEvents: snapshot.activeEvents.map(toEventDto),
  };
}

function extractDocumentText(document: Record<string, unknown>): string {
  const values: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(document);
  return values.join(' ').replace(/\s+/g, ' ').trim().slice(0, 100_000);
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? nested.toString() : nested));
}

function trimIdempotencyCache<T extends { createdAt: number }>(cache: Map<string, T>): void {
  while (cache.size > 1000) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

type ImportInput = { name?: string; slug?: string };

async function buildBundle(worldId: string, service: WorldApplicationService, temporal: TemporalApplicationService): Promise<WorldBundle> {
  const world = await service.getWorld(worldId);
  const [entityTypes, entities, facts, relationTypes, relations, events, maps, assets, calendars, timelineBranches, claims, validationRules, works, chapters, scenes, plotlines, foreshadowings] = await Promise.all([
    service.listEntityTypes(worldId), service.listEntities(worldId), temporal.listFacts(worldId), temporal.listRelationTypes(worldId), temporal.listRelations(worldId), temporal.listEvents(worldId), service.listMaps(worldId), service.listAssets(worldId), service.listCalendars(worldId), temporal.listBranches(worldId), temporal.listClaims(worldId, { canonStatus: 'all' }), service.listValidationRules(worldId), service.listWorks(worldId), service.listChapters(worldId), service.listScenes(worldId), service.listPlotlines(worldId), service.listForeshadowings(worldId),
  ]);
  const entityTypeVersions = (await Promise.all(entityTypes.map((type) => service.listEntityTypeVersions(worldId, type.id)))).flat();
  const mapLayers = (await Promise.all(maps.map((map) => service.listMapLayers(worldId, map.id)))).flat();
  const mapFeatures = (await Promise.all(maps.map((map) => service.listMapFeatures(worldId, map.id)))).flat();
  const calendarVersions = (await Promise.all(calendars.map((calendar) => service.listCalendarVersions(worldId, calendar.id)))).flat();
  return createBundle({ world, entityTypes, entityTypeVersions, entities, facts, relationTypes, relations, events, maps, mapLayers, mapFeatures, assets, calendars, calendarVersions, timelineBranches, claims, validationRules, works, chapters, scenes, plotlines, foreshadowings });
}

async function validateProposalReferences(worldId: string, changes: ProposalRecord['changes'], service: WorldApplicationService, temporal: TemporalApplicationService): Promise<ValidationIssue[]> {
  const [entities, facts, relations, relationTypes, events] = await Promise.all([service.listEntities(worldId), temporal.listFacts(worldId), temporal.listRelations(worldId), temporal.listRelationTypes(worldId), temporal.listEvents(worldId)]);
  const entityIds = new Set(entities.map((item) => item.id));
  const referenceSets: Record<'factId' | 'relationId' | 'eventId' | 'relationTypeId', Set<string>> = {
    factId: new Set(facts.map((item) => item.id)),
    relationId: new Set(relations.map((item) => item.id)),
    eventId: new Set(events.map((item) => item.id)),
    relationTypeId: new Set(relationTypes.map((item) => item.id)),
  };
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const add = (change: ProposalRecord['changes'][number], value: string, label: string): void => {
    const key = `${change.id}:${label}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ ruleCode: 'BROKEN_REFERENCE', severity: 'blocker', subjectId: change.id, relatedIds: [value], message: `Proposal ${label} references an object that does not exist`, evidence: [value] });
  };
  const inspectEntity = (change: ProposalRecord['changes'][number], value: unknown, label: string): void => {
    if (typeof value === 'string' && !entityIds.has(value)) add(change, value, label);
    if (Array.isArray(value)) for (const item of value) inspectEntity(change, item, label);
  };
  for (const change of changes) {
    const payload = change.payload;
    for (const key of ['entityId', 'participantIds', 'locationEntityIds', 'sourceEntityId', 'targetEntityId', 'subjectEntityId', 'objectEntityId', 'parentEntityId']) if (key in payload) inspectEntity(change, payload[key], key);
    for (const key of ['factId', 'relationId', 'eventId', 'relationTypeId'] as const) if (typeof payload[key] === 'string' && !referenceSets[key].has(payload[key] as string)) add(change, payload[key] as string, key);
    if (change.command === 'SetCanonStatus' && typeof payload.id === 'string') {
      const kind = payload.kind;
      const kindSet = kind === 'entity' ? entityIds : kind === 'fact' ? new Set(facts.map((item) => item.id)) : kind === 'relation' ? new Set(relations.map((item) => item.id)) : kind === 'event' ? new Set(events.map((item) => item.id)) : undefined;
      if (!kindSet || !kindSet.has(payload.id)) add(change, payload.id, `${String(kind ?? 'object')}.id`);
    }
  }
  return issues;
}

function parseBundleOrThrow(text: string): ParsedWorldBundle {
  try { return parseBundle(text); } catch { throw new DomainError('VALIDATION_ERROR', 'Invalid World Codex bundle'); }
}

function parseBundleZipOrThrow(value: unknown): ParsedWorldBundle {
  try {
    if (!Buffer.isBuffer(value)) throw new Error('ZIP body required');
    return parseBundleZip(value);
  } catch { throw new DomainError('VALIDATION_ERROR', 'Invalid World Codex ZIP bundle'); }
}

function importInspection(bundle: WorldBundle): Record<string, unknown> {
  return { format: bundle.format, version: bundle.version, worldId: bundle.world.id, worldName: bundle.world.name, hash: bundleHash(bundle), counts: { entityTypes: bundle.entityTypes.length, entityTypeVersions: bundle.entityTypeVersions.length, entities: bundle.entities.length, facts: bundle.facts.length, relationTypes: bundle.relationTypes.length, relations: bundle.relations.length, events: bundle.events.length, maps: bundle.maps.length, mapLayers: bundle.mapLayers.length, mapFeatures: bundle.mapFeatures.length, assets: bundle.assets.length, calendars: bundle.calendars.length, calendarVersions: bundle.calendarVersions.length, timelineBranches: bundle.timelineBranches.length, claims: bundle.claims.length, validationRules: bundle.validationRules.length, works: bundle.works.length, chapters: bundle.chapters.length, scenes: bundle.scenes.length, plotlines: bundle.plotlines.length, foreshadowings: bundle.foreshadowings.length } };
}

function readTextBody(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  throw new DomainError('VALIDATION_ERROR', 'Text import body is required');
}

function parseTextImportInput(value: unknown): { text: string; name?: string; slug?: string } {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return { text: readTextBody(value) };
  const parsed = z.object({ text: z.string().max(10 * 1024 * 1024), name: z.string().trim().min(1).max(200).optional(), slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9\u4e00-\u9fff]+(?:-[a-z0-9\u4e00-\u9fff]+)*$/).optional() }).parse(value);
  return { text: parsed.text, ...(parsed.name === undefined ? {} : { name: parsed.name }), ...(parsed.slug === undefined ? {} : { slug: parsed.slug }) };
}

function parseCsvImportInput(value: unknown): { text: string; worldName?: string; description?: string; name?: string; slug?: string } {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return { text: readTextBody(value) };
  const parsed = z.object({ text: z.string().max(10 * 1024 * 1024), worldName: z.string().trim().min(1).max(300).optional(), description: z.string().max(100_000).optional(), name: z.string().trim().min(1).max(200).optional(), slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9\u4e00-\u9fff]+(?:-[a-z0-9\u4e00-\u9fff]+)*$/).optional() }).parse(value);
  return { text: parsed.text, ...(parsed.worldName === undefined ? {} : { worldName: parsed.worldName }), ...(parsed.description === undefined ? {} : { description: parsed.description }), ...(parsed.name === undefined ? {} : { name: parsed.name }), ...(parsed.slug === undefined ? {} : { slug: parsed.slug }) };
}

function topologicalProposalChanges(changes: ProposalRecord['changes']): ProposalRecord['changes'] {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const indegree = new Map(changes.map((change) => [change.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const change of changes) for (const dependency of change.dependsOn) {
    if (!byId.has(dependency)) continue;
    indegree.set(change.id, (indegree.get(change.id) ?? 0) + 1);
    dependents.set(dependency, [...(dependents.get(dependency) ?? []), change.id]);
  }
  const queue = changes.filter((change) => indegree.get(change.id) === 0).map((change) => change.id);
  const ordered: ProposalRecord['changes'] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const change = byId.get(id);
    if (!change) continue;
    ordered.push(change);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }
  if (ordered.length !== changes.length) throw new DomainError('VALIDATION_ERROR', 'Proposal changes contain a dependency cycle');
  return ordered;
}

function parseMarkdownOrThrow(text: string): WorldBundle {
  try { return parseMarkdownBundle(text); } catch { throw new DomainError('VALIDATION_ERROR', 'Invalid World Codex Markdown import'); }
}

function parseCsvOrThrow(text: string, options: { worldName?: string; description?: string } = {}): WorldBundle {
  try { return parseCsvBundle(text, options); } catch (error) { throw new DomainError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid World Codex CSV import'); }
}

function ensureImportCollections(bundle: WorldBundle): WorldBundle {
  bundle.entityTypeVersions ??= [];
  bundle.maps ??= [];
  bundle.mapLayers ??= [];
  bundle.mapFeatures ??= [];
  bundle.assets ??= [];
  bundle.calendars ??= [];
  bundle.calendarVersions ??= [];
  bundle.timelineBranches ??= [];
  bundle.claims ??= [];
  bundle.validationRules ??= [];
  bundle.works ??= [];
  bundle.chapters ??= [];
  bundle.scenes ??= [];
  bundle.plotlines ??= [];
  bundle.foreshadowings ??= [];
  return bundle;
}

function validateImportBundle(bundle: WorldBundle): void {
  ensureImportCollections(bundle);
  if (!bundle.world.name.trim() || bundle.world.name.length > 300 || bundle.world.slug.length > 100 || !/^[a-z0-9\u4e00-\u9fff]+(?:-[a-z0-9\u4e00-\u9fff]+)*$/.test(bundle.world.slug)) throw new DomainError('VALIDATION_ERROR', 'Import world name or slug is invalid');
  const limits: Array<[string, number, number]> = [['entityTypes', bundle.entityTypes.length, 50_000], ['entityTypeVersions', bundle.entityTypeVersions.length, 200_000], ['entities', bundle.entities.length, 50_000], ['facts', bundle.facts.length, 100_000], ['relationTypes', bundle.relationTypes.length, 50_000], ['relations', bundle.relations.length, 200_000], ['events', bundle.events.length, 100_000], ['maps', bundle.maps.length, 10_000], ['mapLayers', bundle.mapLayers.length, 100_000], ['mapFeatures', bundle.mapFeatures.length, 200_000], ['assets', bundle.assets.length, 10_000], ['calendars', bundle.calendars.length, 1_000], ['calendarVersions', bundle.calendarVersions.length, 10_000], ['timelineBranches', bundle.timelineBranches.length, 10_000], ['claims', bundle.claims.length, 200_000], ['validationRules', bundle.validationRules.length, 10_000], ['works', bundle.works.length, 10_000], ['chapters', bundle.chapters.length, 50_000], ['scenes', bundle.scenes.length, 100_000], ['plotlines', bundle.plotlines.length, 50_000], ['foreshadowings', bundle.foreshadowings.length, 50_000]];
  for (const [name, count, max] of limits) if (count > max) throw new DomainError('VALIDATION_ERROR', `Import contains too many ${name}`);
  try { decodeTick(bundle.world.currentTick ?? 0n); } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('VALIDATION_ERROR', 'Import world currentTick is invalid'); }
  const collections: Array<[string, Array<{ id: string; worldId?: string }>]> = [
    ['entityTypes', bundle.entityTypes], ['entityTypeVersions', bundle.entityTypeVersions], ['entities', bundle.entities], ['facts', bundle.facts], ['relationTypes', bundle.relationTypes], ['relations', bundle.relations], ['events', bundle.events], ['maps', bundle.maps], ['mapLayers', bundle.mapLayers], ['mapFeatures', bundle.mapFeatures], ['calendars', bundle.calendars], ['calendarVersions', bundle.calendarVersions], ['timelineBranches', bundle.timelineBranches], ['claims', bundle.claims], ['validationRules', bundle.validationRules], ['works', bundle.works], ['chapters', bundle.chapters], ['scenes', bundle.scenes], ['plotlines', bundle.plotlines], ['foreshadowings', bundle.foreshadowings],
  ];
  for (const [name, records] of collections) {
    const ids = new Set<string>();
    for (const record of records) {
      if (!record.id || ids.has(record.id)) throw new DomainError('VALIDATION_ERROR', `Import contains duplicate ${name} id`, { id: record.id });
      ids.add(record.id);
      if (record.worldId !== undefined && record.worldId !== bundle.world.id) throw new DomainError('VALIDATION_ERROR', `Import ${name} record belongs to another world`, { id: record.id });
    }
  }
  const typeIds = new Set(bundle.entityTypes.map((type) => type.id));
  const typeKeys = new Set<string>();
  for (const type of bundle.entityTypes) {
    if (typeKeys.has(type.typeKey)) throw new DomainError('VALIDATION_ERROR', 'Import contains duplicate entity type key', { typeKey: type.typeKey });
    typeKeys.add(type.typeKey);
  }
  const versionsByType = new Map<string, Set<number>>();
  for (const version of bundle.entityTypeVersions) {
    if (!typeIds.has(version.entityTypeId) || !Number.isInteger(version.schemaVersion) || version.schemaVersion < 1 || !isRecordValue(version.schema)) throw new DomainError('VALIDATION_ERROR', 'Import entity type version is invalid', { versionId: version.id });
    const versions = versionsByType.get(version.entityTypeId) ?? new Set<number>();
    if (versions.has(version.schemaVersion)) throw new DomainError('VALIDATION_ERROR', 'Import contains duplicate entity type schema version', { entityTypeId: version.entityTypeId, schemaVersion: version.schemaVersion });
    versions.add(version.schemaVersion);
    decodeTick(version.createdRevision);
    versionsByType.set(version.entityTypeId, versions);
  }
  for (const [entityTypeId, versions] of versionsByType) if (!versions.has(1)) throw new DomainError('VALIDATION_ERROR', 'Import entity type schema history must start at version 1', { entityTypeId });
  const entityIds = new Set(bundle.entities.map((entity) => entity.id));
  for (const entity of bundle.entities) {
    if (typeof entity.name !== 'string' || typeof entity.typeId !== 'string' || !Array.isArray(entity.tags) || !isRecordValue(entity.document)) throw new DomainError('VALIDATION_ERROR', 'Import entity shape is invalid', { entityId: entity.id });
    if (!typeIds.has(entity.typeId)) throw new DomainError('VALIDATION_ERROR', 'Import entity type reference is missing', { entityId: entity.id, typeId: entity.typeId });
    if (entity.schemaVersion !== undefined && (!Number.isInteger(entity.schemaVersion) || entity.schemaVersion < 1)) throw new DomainError('VALIDATION_ERROR', 'Import entity schema version is invalid', { entityId: entity.id, schemaVersion: entity.schemaVersion });
    const availableVersions = versionsByType.get(entity.typeId);
    if (entity.schemaVersion !== undefined && availableVersions && availableVersions.size > 0 && !availableVersions.has(entity.schemaVersion)) throw new DomainError('VALIDATION_ERROR', 'Import entity schema version is not present in type history', { entityId: entity.id, schemaVersion: entity.schemaVersion });
    if (entity.parentEntityId === entity.id) throw new DomainError('VALIDATION_ERROR', 'Import entity cannot be its own parent', { entityId: entity.id });
    if (entity.parentEntityId && !entityIds.has(entity.parentEntityId)) throw new DomainError('VALIDATION_ERROR', 'Import parent entity reference is missing', { entityId: entity.id, parentEntityId: entity.parentEntityId });
  }
  assertAcyclic(bundle.entities.map((entity) => [entity.id, entity.parentEntityId] as const).filter((edge): edge is [string, string] => edge[1] !== null));
  for (const fact of bundle.facts) {
    if (!entityIds.has(fact.subjectEntityId) || (fact.objectKind === 'entity' && (!fact.objectEntityId || !entityIds.has(fact.objectEntityId)))) throw new DomainError('VALIDATION_ERROR', 'Import fact reference is missing', { factId: fact.id });
    assertRange(fact.validFromTick, fact.validToTick, 'fact', fact.id);
  }
  const relationTypeIds = new Set(bundle.relationTypes.map((type) => type.id));
  for (const relationType of bundle.relationTypes) for (const typeId of [...relationType.sourceTypeIds, ...relationType.targetTypeIds]) if (!typeIds.has(typeId)) throw new DomainError('VALIDATION_ERROR', 'Import relation type endpoint type is missing', { relationTypeId: relationType.id, typeId });
  for (const relation of bundle.relations) {
    if (!entityIds.has(relation.sourceEntityId) || !entityIds.has(relation.targetEntityId) || !relationTypeIds.has(relation.relationTypeId)) throw new DomainError('VALIDATION_ERROR', 'Import relation reference is missing', { relationId: relation.id });
    assertRange(relation.validFromTick, relation.validToTick, 'relation', relation.id);
  }
  const eventIds = new Set(bundle.events.map((event) => event.id));
  for (const event of bundle.events) {
    if (typeof event.name !== 'string' || typeof event.eventType !== 'string' || !Array.isArray(event.participantIds) || !Array.isArray(event.locationEntityIds) || !Array.isArray(event.causeEventIds) || !Array.isArray(event.resultEventIds) || !Array.isArray(event.effects)) throw new DomainError('VALIDATION_ERROR', 'Import event shape is invalid', { eventId: event.id });
    if (event.participantRoles !== undefined && (!Array.isArray(event.participantRoles) || event.participantRoles.some((participant) => !isRecordValue(participant) || typeof participant.entityId !== 'string' || typeof participant.role !== 'string' || !participant.role.trim()))) throw new DomainError('VALIDATION_ERROR', 'Import event participant roles are invalid', { eventId: event.id });
    if (event.participantRoles !== undefined) {
      const participantIds = new Set(event.participantIds);
      const roleParticipantIds = new Set<string>();
      const rolePairs = new Set<string>();
      for (const participant of event.participantRoles) {
        if (!participantIds.has(participant.entityId)) throw new DomainError('VALIDATION_ERROR', 'Import event participant roles do not match participantIds', { eventId: event.id, entityId: participant.entityId });
        roleParticipantIds.add(participant.entityId);
        const pair = `${participant.entityId}:${participant.role}`;
        if (rolePairs.has(pair)) throw new DomainError('VALIDATION_ERROR', 'Import event contains duplicate participant roles', { eventId: event.id, entityId: participant.entityId, role: participant.role });
        rolePairs.add(pair);
      }
      if (roleParticipantIds.size !== participantIds.size || [...participantIds].some((entityId) => !roleParticipantIds.has(entityId))) throw new DomainError('VALIDATION_ERROR', 'Import event participant roles do not cover participantIds', { eventId: event.id });
    }
    if (event.requiredRoles !== undefined && (!Array.isArray(event.requiredRoles) || event.requiredRoles.some((role) => typeof role !== 'string' || !role.trim()))) throw new DomainError('VALIDATION_ERROR', 'Import event required roles are invalid', { eventId: event.id });
    try { decodeTick(event.startTick); if (event.endTick !== undefined) decodeTick(event.endTick); } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('VALIDATION_ERROR', 'Import event tick is invalid', { eventId: event.id }); }
    if (event.endTick !== undefined && decodeTick(event.endTick) < decodeTick(event.startTick)) throw new DomainError('VALIDATION_ERROR', 'Import event end precedes start', { eventId: event.id });
    if (new Set(event.participantIds).size !== event.participantIds.length || new Set(event.locationEntityIds).size !== event.locationEntityIds.length || new Set([...event.causeEventIds, ...event.resultEventIds]).size !== event.causeEventIds.length + event.resultEventIds.length || new Set(event.effects.map((effect) => effect.sequence)).size !== event.effects.length) throw new DomainError('VALIDATION_ERROR', 'Import event contains duplicate references or effect sequences', { eventId: event.id });
    for (const entityId of [...event.participantIds, ...(event.participantRoles ?? []).map((participant) => participant.entityId), ...event.locationEntityIds]) if (!entityIds.has(entityId)) throw new DomainError('VALIDATION_ERROR', 'Import event entity reference is missing', { eventId: event.id, entityId });
    for (const eventId of [...event.causeEventIds, ...event.resultEventIds]) if (typeof eventId !== 'string' || !eventIds.has(eventId)) throw new DomainError('VALIDATION_ERROR', 'Import event link reference is missing', { eventId: event.id, linkedEventId: eventId });
    if (event.causalLinks !== undefined) {
      if (!Array.isArray(event.causalLinks) || event.causalLinks.some((link) => !isRecordValue(link) || typeof link.targetEventId !== 'string' || typeof link.kind !== 'string')) throw new DomainError('VALIDATION_ERROR', 'Import event causal links are invalid', { eventId: event.id });
      for (const link of event.causalLinks) if (!eventIds.has(link.targetEventId)) throw new DomainError('VALIDATION_ERROR', 'Import event causal target is missing', { eventId: event.id, linkedEventId: link.targetEventId });
    }
    for (const effect of event.effects) if (!isRecordValue(effect) || typeof effect.type !== 'string' || typeof effect.sequence !== 'number' || !Number.isInteger(effect.sequence) || effect.sequence < 0 || (effect.targetId !== undefined && typeof effect.targetId !== 'string') || !isRecordValue(effect.payload)) throw new DomainError('VALIDATION_ERROR', 'Import event effect shape is invalid', { eventId: event.id });
  }
  assertAcyclic(bundle.events.flatMap((event) => [...event.causeEventIds, ...event.resultEventIds].map((linked) => [event.id, linked] as const)));
  const mapIds = new Set(bundle.maps.map((map) => map.id));
  const mapLayerIds = new Set<string>();
  const mapLayerNames = new Set<string>();
  for (const layer of bundle.mapLayers) {
    if (!mapIds.has(layer.mapId) || layer.worldId !== bundle.world.id || typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 200 || !['base', 'overlay', 'annotation'].includes(layer.kind) || !Number.isInteger(layer.sortOrder) || layer.sortOrder < 0 || typeof layer.visible !== 'boolean' || typeof layer.opacity !== 'number' || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !isRecordValue(layer.style)) throw new DomainError('VALIDATION_ERROR', 'Import map layer metadata is invalid', { layerId: layer.id });
    validateMapStyle(layer.style);
    if (mapLayerIds.has(layer.id)) throw new DomainError('VALIDATION_ERROR', 'Import contains duplicate map layer id', { layerId: layer.id });
    const nameKey = `${layer.mapId}:${layer.name}`;
    if (mapLayerNames.has(nameKey)) throw new DomainError('VALIDATION_ERROR', 'Import contains duplicate map layer name', { mapId: layer.mapId, name: layer.name });
    mapLayerIds.add(layer.id); mapLayerNames.add(nameKey);
  }
  const assetIds = new Set(bundle.assets.map((asset) => asset.id));
  for (const asset of bundle.assets) {
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) || typeof asset.mediaType !== 'string' || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mediaType) || (asset.scanStatus !== 'passed' && asset.scanStatus !== 'rejected')) throw new DomainError('VALIDATION_ERROR', 'Import asset metadata is invalid', { assetId: asset.id });
    try {
      const byteSize = decodeTick(asset.byteSize as unknown as string | number | bigint);
      if (byteSize <= 0n || byteSize > BigInt(25 * 1024 * 1024)) throw new Error('out-of-range');
    } catch { throw new DomainError('VALIDATION_ERROR', 'Import asset byteSize is invalid', { assetId: asset.id }); }
  }
  for (const map of bundle.maps) if (map.assetId !== undefined && !assetIds.has(map.assetId)) throw new DomainError('VALIDATION_ERROR', 'Import map asset reference is missing', { mapId: map.id, assetId: map.assetId });
  for (const feature of bundle.mapFeatures) {
    validateGeometry(feature.kind, feature.geometry);
    if (!mapIds.has(feature.mapId)) throw new DomainError('VALIDATION_ERROR', 'Import map feature references a missing map', { featureId: feature.id, mapId: feature.mapId });
    if (feature.layerId !== undefined && (!mapLayerIds.has(feature.layerId) || bundle.mapLayers.find((layer) => layer.id === feature.layerId)?.mapId !== feature.mapId)) throw new DomainError('VALIDATION_ERROR', 'Import map feature layer reference is missing or belongs to another map', { featureId: feature.id, layerId: feature.layerId });
    if (feature.entityId && !entityIds.has(feature.entityId)) throw new DomainError('VALIDATION_ERROR', 'Import map feature entity reference is missing', { featureId: feature.id, entityId: feature.entityId });
    assertRange(feature.validFromTick, feature.validToTick, 'map feature', feature.id);
  }
  const calendarIds = new Set(bundle.calendars.map((calendar) => calendar.id));
  const calendarVersionIds = new Set<string>();
  const versionsByCalendar = new Map<string, Set<number>>();
  for (const calendar of bundle.calendars) {
    if (typeof calendar.name !== 'string' || !calendar.name.trim() || !Number.isInteger(calendar.currentVersion) || calendar.currentVersion < 1) throw new DomainError('VALIDATION_ERROR', 'Import calendar metadata is invalid', { calendarId: calendar.id });
  }
  for (const version of bundle.calendarVersions) {
    if (calendarVersionIds.has(version.id) || !calendarIds.has(version.calendarId) || !Number.isInteger(version.version) || version.version < 1) throw new DomainError('VALIDATION_ERROR', 'Import calendar version metadata is invalid', { versionId: version.id });
    const versions = versionsByCalendar.get(version.calendarId) ?? new Set<number>();
    if (versions.has(version.version)) throw new DomainError('VALIDATION_ERROR', 'Import contains duplicate calendar version number', { calendarId: version.calendarId, version: version.version });
    versions.add(version.version); versionsByCalendar.set(version.calendarId, versions); calendarVersionIds.add(version.id);
    validateCalendarDefinitionShape(version.definition, version.id);
    try { decodeTick(version.createdRevision); } catch { throw new DomainError('VALIDATION_ERROR', 'Import calendar version revision is invalid', { versionId: version.id }); }
  }
  for (const calendar of bundle.calendars) {
    const versions = versionsByCalendar.get(calendar.id);
    if (!versions || !versions.has(1) || Math.max(...versions) !== calendar.currentVersion) throw new DomainError('VALIDATION_ERROR', 'Import calendar versions are incomplete', { calendarId: calendar.id });
  }
  if (bundle.world.defaultCalendarVersionId !== undefined && bundle.world.defaultCalendarVersionId !== null && !calendarVersionIds.has(bundle.world.defaultCalendarVersionId)) throw new DomainError('VALIDATION_ERROR', 'Import default calendar version reference is missing', { versionId: bundle.world.defaultCalendarVersionId });
  const branchIds = new Set(bundle.timelineBranches.map((branch) => branch.id));
  for (const branch of bundle.timelineBranches) {
    if (typeof branch.name !== 'string' || !branch.name.trim() || !['main', 'sandbox', 'alternate', 'archived'].includes(branch.status)) throw new DomainError('VALIDATION_ERROR', 'Import timeline branch metadata is invalid', { branchId: branch.id });
    if (branch.parentBranchId && !branchIds.has(branch.parentBranchId)) throw new DomainError('VALIDATION_ERROR', 'Import timeline branch parent is missing', { branchId: branch.id, parentBranchId: branch.parentBranchId });
  }
  assertAcyclic(bundle.timelineBranches.filter((branch): branch is typeof branch & { parentBranchId: string } => typeof branch.parentBranchId === 'string' && branch.parentBranchId.length > 0).map((branch) => [branch.id, branch.parentBranchId] as const));
  const claimKinds = new Set(['belief', 'rumor', 'official_record', 'testimony', 'prophecy', 'legend', 'secret', 'hypothesis']);
  const truthStatuses = new Set(['true', 'false', 'disputed', 'unknown', 'author_undecided']);
  const canonStatuses = new Set(['draft', 'pending', 'canon', 'retconned', 'archived']);
  for (const claim of bundle.claims) {
    if (typeof claim.predicateKey !== 'string' || !claim.predicateKey.trim() || !['scalar', 'entity', 'json'].includes(claim.objectKind) || !claimKinds.has(claim.claimKind) || !truthStatuses.has(claim.truthStatus) || !canonStatuses.has(claim.canonStatus) || !Array.isArray(claim.knownByEntityIds) || !Array.isArray(claim.sourceRefs)) throw new DomainError('VALIDATION_ERROR', 'Import claim shape is invalid', { claimId: claim.id });
    if (claim.subjectEntityId && !entityIds.has(claim.subjectEntityId)) throw new DomainError('VALIDATION_ERROR', 'Import claim subject is missing', { claimId: claim.id, subjectEntityId: claim.subjectEntityId });
    if (claim.objectKind === 'entity' && (!claim.objectEntityId || !entityIds.has(claim.objectEntityId))) throw new DomainError('VALIDATION_ERROR', 'Import claim target is missing', { claimId: claim.id });
    if (claim.assertedByEntityId && !entityIds.has(claim.assertedByEntityId)) throw new DomainError('VALIDATION_ERROR', 'Import claim assertor is missing', { claimId: claim.id, assertedByEntityId: claim.assertedByEntityId });
    for (const audienceId of claim.knownByEntityIds) if (!entityIds.has(audienceId)) throw new DomainError('VALIDATION_ERROR', 'Import claim audience is missing', { claimId: claim.id, entityId: audienceId });
    if (claim.branchId && branchIds.size > 0 && !branchIds.has(claim.branchId) && claim.branchId !== DEFAULT_BRANCH_ID) throw new DomainError('VALIDATION_ERROR', 'Import claim branch is missing', { claimId: claim.id, branchId: claim.branchId });
    assertRange(claim.validFromTick, claim.validToTick, 'claim', claim.id);
  }
  for (const rule of bundle.validationRules) {
    if (typeof rule.name !== 'string' || !rule.name.trim() || typeof rule.enabled !== 'boolean' || !['entity', 'fact', 'relation', 'event', 'world'].includes(rule.target) || !isRecordValue(rule.assert as unknown as Record<string, unknown>)) throw new DomainError('VALIDATION_ERROR', 'Import validation rule shape is invalid', { ruleId: rule.id });
  }
  const workIds = new Set(bundle.works.map((work) => work.id));
  const workTypes = new Set(['novel', 'screenplay', 'game', 'campaign', 'comic', 'other']);
  for (const work of bundle.works) if (typeof work.title !== 'string' || !work.title.trim() || !workTypes.has(work.type)) throw new DomainError('VALIDATION_ERROR', 'Import work shape is invalid', { workId: work.id });
  const chapterIds = new Set(bundle.chapters.map((chapter) => chapter.id));
  for (const chapter of bundle.chapters) {
    if (typeof chapter.title !== 'string' || !chapter.title.trim() || !workIds.has(chapter.workId) || !Number.isInteger(chapter.orderIndex)) throw new DomainError('VALIDATION_ERROR', 'Import chapter shape is invalid', { chapterId: chapter.id });
  }
  const plotlineIds = new Set(bundle.plotlines.map((plotline) => plotline.id));
  for (const plotline of bundle.plotlines) {
    if (typeof plotline.title !== 'string' || !plotline.title.trim() || !['active', 'resolved', 'abandoned'].includes(plotline.status) || !['setup', 'development', 'climax', 'resolution', 'unresolved'].includes(plotline.currentStage) || !Array.isArray(plotline.characterEntityIds) || !Array.isArray(plotline.eventIds)) throw new DomainError('VALIDATION_ERROR', 'Import plotline shape is invalid', { plotlineId: plotline.id });
    for (const entityId of plotline.characterEntityIds) if (!entityIds.has(entityId)) throw new DomainError('VALIDATION_ERROR', 'Import plotline character is missing', { plotlineId: plotline.id, entityId });
    for (const eventId of plotline.eventIds) if (!eventIds.has(eventId)) throw new DomainError('VALIDATION_ERROR', 'Import plotline event is missing', { plotlineId: plotline.id, eventId });
  }
  const sceneIds = new Set(bundle.scenes.map((scene) => scene.id));
  const sceneStatuses = new Set(['outline', 'draft', 'revised', 'final']);
  for (const scene of bundle.scenes) {
    if (!workIds.has(scene.workId) || !chapterIds.has(scene.chapterId) || !sceneStatuses.has(scene.status) || !Array.isArray(scene.participantEntityIds) || typeof scene.proseText !== 'string') throw new DomainError('VALIDATION_ERROR', 'Import scene shape is invalid', { sceneId: scene.id });
    const chapter = bundle.chapters.find((item) => item.id === scene.chapterId);
    if (chapter && chapter.workId !== scene.workId) throw new DomainError('VALIDATION_ERROR', 'Import scene work does not match chapter', { sceneId: scene.id });
    if (scene.povCharacterId && !entityIds.has(scene.povCharacterId)) throw new DomainError('VALIDATION_ERROR', 'Import scene POV is missing', { sceneId: scene.id, povCharacterId: scene.povCharacterId });
    if (scene.locationEntityId && !entityIds.has(scene.locationEntityId)) throw new DomainError('VALIDATION_ERROR', 'Import scene location is missing', { sceneId: scene.id, locationEntityId: scene.locationEntityId });
    for (const entityId of scene.participantEntityIds) if (!entityIds.has(entityId)) throw new DomainError('VALIDATION_ERROR', 'Import scene participant is missing', { sceneId: scene.id, entityId });
    for (const plotlineId of scene.plotlineIds ?? []) if (!plotlineIds.has(plotlineId)) throw new DomainError('VALIDATION_ERROR', 'Import scene plotline is missing', { sceneId: scene.id, plotlineId });
    if (scene.sceneTick !== undefined) decodeTick(scene.sceneTick);
  }
  for (const item of bundle.foreshadowings) {
    if (typeof item.title !== 'string' || !item.title.trim() || !sceneIds.has(item.setupSceneId) || !['open', 'resolved', 'abandoned'].includes(item.status) || !Array.isArray(item.relatedEntityIds)) throw new DomainError('VALIDATION_ERROR', 'Import foreshadowing shape is invalid', { foreshadowingId: item.id });
    if (item.payoffSceneId && !sceneIds.has(item.payoffSceneId)) throw new DomainError('VALIDATION_ERROR', 'Import foreshadowing payoff scene is missing', { foreshadowingId: item.id, payoffSceneId: item.payoffSceneId });
    if (item.plotlineId && !plotlineIds.has(item.plotlineId)) throw new DomainError('VALIDATION_ERROR', 'Import foreshadowing plotline is missing', { foreshadowingId: item.id, plotlineId: item.plotlineId });
    for (const entityId of item.relatedEntityIds) if (!entityIds.has(entityId)) throw new DomainError('VALIDATION_ERROR', 'Import foreshadowing entity is missing', { foreshadowingId: item.id, entityId });
  }
}

function validateCalendarDefinitionShape(value: unknown, versionId: string): asserts value is CalendarDefinition {
  if (!isRecordValue(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !Number.isInteger(value.yearZero) || !Number.isInteger(value.daysPerWeek) || !Array.isArray(value.weekdays) || !Array.isArray(value.months) || value.months.length === 0 || !Array.isArray(value.eras)) throw new DomainError('VALIDATION_ERROR', 'Import calendar definition is invalid', { versionId });
  const daysPerWeek = value.daysPerWeek as number;
  const weekdays = value.weekdays as unknown[];
  const months = value.months as unknown[];
  const eras = value.eras as unknown[];
  if (daysPerWeek < 1 || weekdays.some((item) => typeof item !== 'string' || !item.trim())) throw new DomainError('VALIDATION_ERROR', 'Import calendar definition is invalid', { versionId });
  const monthIds = new Set<string>();
  for (const month of months) {
    if (!isRecordValue(month) || typeof month.id !== 'string' || !month.id || monthIds.has(month.id) || typeof month.name !== 'string' || !month.name.trim() || !Number.isInteger(month.days) || (month.days as number) < 1) throw new DomainError('VALIDATION_ERROR', 'Import calendar month is invalid', { versionId });
    monthIds.add(month.id);
  }
  const eraIds = new Set<string>();
  for (const era of eras) {
    if (!isRecordValue(era) || typeof era.id !== 'string' || !era.id || eraIds.has(era.id) || typeof era.name !== 'string' || typeof era.abbreviation !== 'string') throw new DomainError('VALIDATION_ERROR', 'Import calendar era is invalid', { versionId });
    if (!isImportTick(era.startTick)) throw new DomainError('VALIDATION_ERROR', 'Import calendar era start tick is invalid', { versionId });
    const startTick = decodeTick(era.startTick);
    eraIds.add(era.id);
    if (era.endTick !== undefined) {
      if (!isImportTick(era.endTick) || decodeTick(era.endTick) <= startTick) throw new DomainError('VALIDATION_ERROR', 'Import calendar era range is invalid', { versionId });
    }
  }
  if (value.leapRule !== undefined) {
    const rule = value.leapRule;
    if (!isRecordValue(rule) || !Number.isInteger(rule.everyYears) || (rule.everyYears as number) < 1 || !Number.isInteger(rule.extraDays) || (rule.extraDays as number) < 1 || (rule.monthId !== undefined && (typeof rule.monthId !== 'string' || !monthIds.has(rule.monthId)))) throw new DomainError('VALIDATION_ERROR', 'Import calendar leap rule is invalid', { versionId });
  }
}

function isImportTick(value: unknown): value is string | number | bigint {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint';
}

function decodeCalendarDefinition(value: unknown, versionId: string): CalendarDefinition {
  const decoded = decodePortableValue(value);
  validateCalendarDefinitionShape(decoded, versionId);
  return {
    id: decoded.id,
    name: decoded.name,
    yearZero: decoded.yearZero,
    daysPerWeek: decoded.daysPerWeek,
    weekdays: [...decoded.weekdays],
    months: decoded.months.map((month) => ({ id: month.id, name: month.name, days: month.days })),
    eras: decoded.eras.map((era) => era.endTick === undefined ? { id: era.id, name: era.name, abbreviation: era.abbreviation, startTick: decodeTick(era.startTick) } : { id: era.id, name: era.name, abbreviation: era.abbreviation, startTick: decodeTick(era.startTick), endTick: decodeTick(era.endTick) }),
    ...(decoded.leapRule === undefined ? {} : { leapRule: decoded.leapRule.monthId === undefined ? { everyYears: decoded.leapRule.everyYears, extraDays: decoded.leapRule.extraDays } : { everyYears: decoded.leapRule.everyYears, extraDays: decoded.leapRule.extraDays, monthId: decoded.leapRule.monthId } }),
  };
}

function assertRange(from: bigint | string | number | undefined, to: bigint | string | number | undefined, kind: string, id: string): void {
  if (from !== undefined && to !== undefined && decodeTick(from) >= decodeTick(to)) throw new DomainError('VALIDATION_ERROR', `Import ${kind} range must be non-empty`, { id });
}

function assertAcyclic(edges: Array<readonly [string, string]>): void {
  const graph = new Map<string, string[]>();
  for (const [from, to] of edges) graph.set(from, [...(graph.get(from) ?? []), to]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new DomainError('VALIDATION_ERROR', 'Import contains a dependency cycle', { id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next);
    visiting.delete(id); visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
}

function decodeTick(value: bigint | string | number): bigint {
  try {
    if (typeof value === 'bigint') { assertInt64(value); return value; }
    if (typeof value === 'number' && Number.isSafeInteger(value)) { const parsed = BigInt(value); assertInt64(parsed); return parsed; }
    const text = String(value);
    const parsed = BigInt(/^-?\d+n$/.test(text) ? text.slice(0, -1) : text);
    assertInt64(parsed);
    return parsed;
  } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('VALIDATION_ERROR', 'Import tick must be an integer', { value: String(value) }); }
}

function parseTick(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new DomainError('VALIDATION_ERROR', 'tick must be a signed integer');
  return decodeTick(value);
}

function parseRevision(value: string): bigint {
  const revision = parseTick(value);
  if (revision < 0n) throw new DomainError('VALIDATION_ERROR', 'revision must not be negative');
  return revision;
}

function assertInt64(value: bigint): void {
  if (value < MIN_INT64 || value > MAX_INT64) throw new DomainError('VALIDATION_ERROR', 'tick is outside the supported int64 range');
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodePortableValue(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+n$/.test(value)) return BigInt(value.slice(0, -1));
  if (Array.isArray(value)) return value.map(decodePortableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, decodePortableValue(nested)]));
  return value;
}

function remapId(map: Map<string, string>, id: string, kind: string): string {
  const mapped = map.get(id);
  if (!mapped) throw new DomainError('VALIDATION_ERROR', `Import ${kind} reference could not be remapped`, { id });
  return mapped;
}

function remapImportedEffect(
  effect: EventEffect,
  producedIds: Map<string, string>,
  maps: { entityMap: Map<string, string>; factMap: Map<string, string>; relationMap: Map<string, string>; relationTypeMap: Map<string, string>; typeMap: Map<string, string>; mapFeatureMap: Map<string, string> },
): EventEffect {
  const payload = (decodePortableValue(effect.payload) ?? {}) as Record<string, unknown>;
  const resolveAny = (id: string): string | undefined => maps.entityMap.get(id) ?? maps.factMap.get(id) ?? maps.relationMap.get(id) ?? maps.mapFeatureMap.get(id) ?? producedIds.get(id);
  const requirePayloadId = (field: string, map: Map<string, string>, kind: string): void => {
    const value = payload[field];
    if (typeof value === 'string') payload[field] = remapId(map, value, kind);
  };
  if (effect.type === 'ADD_FACT') {
    requirePayloadId('subjectEntityId', maps.entityMap, 'effect fact subject');
    requirePayloadId('objectEntityId', maps.entityMap, 'effect fact object');
  } else if (effect.type === 'SET_FACT' || effect.type === 'SET_FIELD') {
    requirePayloadId('objectEntityId', maps.entityMap, 'effect fact object');
  } else if (effect.type === 'ADD_RELATION') {
    requirePayloadId('sourceEntityId', maps.entityMap, 'effect relation source');
    requirePayloadId('targetEntityId', maps.entityMap, 'effect relation target');
    requirePayloadId('relationTypeId', maps.relationTypeMap, 'effect relation type');
  } else if (effect.type === 'MOVE_ENTITY') {
    requirePayloadId('locationEntityId', maps.entityMap, 'effect move location');
  } else if (effect.type === 'CREATE_ENTITY') {
    requirePayloadId('typeId', maps.typeMap, 'effect entity type');
    requirePayloadId('parentEntityId', maps.entityMap, 'effect entity parent');
    if (typeof payload.id === 'string') payload.id = producedIds.get(payload.id) ?? maps.entityMap.get(payload.id) ?? payload.id;
  }
  let targetId: string | undefined;
  if (effect.targetId !== undefined) {
    targetId = effect.type === 'CHANGE_GEOMETRY'
      ? remapId(maps.mapFeatureMap, effect.targetId, 'effect map feature')
      : resolveAny(effect.targetId);
    if (!targetId) throw new DomainError('VALIDATION_ERROR', 'Import event effect target could not be remapped', { effectId: effect.id, targetId: effect.targetId, effectType: effect.type });
  }
  return { id: remapId(producedIds, effect.id, 'effect id'), type: effect.type, ...(targetId === undefined ? {} : { targetId }), payload, sequence: effect.sequence };
}

async function importBundle(bundle: ParsedWorldBundle, input: ImportInput, service: WorldApplicationService, temporal: TemporalApplicationService, canon: CanonApplicationService, assetStore: AssetStore): Promise<Record<string, unknown>> {
  ensureImportCollections(bundle);
  const suffix = randomUUID().slice(0, 8);
  const sourceName = input.name ?? `${bundle.world.name} (Imported)`;
  const slug = input.slug ?? `${bundle.world.slug}-imported-${suffix}`.slice(0, 100).replace(/-+$/g, '');
  const world = await service.createWorld({ name: sourceName, slug, description: bundle.world.description, genre: bundle.world.genre, canonStrategy: bundle.world.canonStrategy });
  const importedStorageKeys = new Set<string>();
  try {
  const revision = async (): Promise<bigint> => (await service.getWorld(world.id)).revision;
  const sourceCurrentTick = decodeTick(bundle.world.currentTick ?? 0n);
  if (sourceCurrentTick !== 0n) await service.updateWorldTime(world.id, await revision(), sourceCurrentTick);
  const existingBranches = await temporal.listBranches(world.id);
  const mainBranch = existingBranches.find((branch) => branch.status === 'main') ?? existingBranches[0];
  if (!mainBranch) throw new DomainError('INTERNAL_ERROR', 'Imported world is missing a main timeline branch');
  const branchMap = new Map<string, string>([[DEFAULT_BRANCH_ID, mainBranch.id], [mainBranch.id, mainBranch.id]]);
  for (const source of bundle.timelineBranches) {
    if (source.status === 'main' || source.name === 'main' || source.id === DEFAULT_BRANCH_ID) {
      branchMap.set(source.id, mainBranch.id);
    }
  }
  const pendingBranches = bundle.timelineBranches.filter((source) => !branchMap.has(source.id));
  const branchQueue = [...pendingBranches];
  let importedBranchCount = 0;
  while (branchQueue.length) {
    const readyIndex = branchQueue.findIndex((source) => !source.parentBranchId || branchMap.has(source.parentBranchId));
    if (readyIndex < 0) throw new DomainError('VALIDATION_ERROR', 'Import timeline branches cannot be ordered by parent dependency');
    const source = branchQueue.splice(readyIndex, 1)[0]!;
    const created = await temporal.createBranch(world.id, {
      name: source.name,
      parentBranchId: source.parentBranchId ? remapId(branchMap, source.parentBranchId, 'timeline branch parent') : null,
      ...(source.forkTick === undefined || source.forkTick === null ? {} : { forkTick: decodeTick(source.forkTick) }),
      ...(source.forkRevision === undefined || source.forkRevision === null ? {} : { forkRevision: decodeTick(source.forkRevision) }),
      status: source.status === 'main' ? 'alternate' : source.status,
    }, await revision());
    branchMap.set(source.id, created.id);
    importedBranchCount += 1;
  }
  const remapBranchId = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    if (branchMap.has(id)) return branchMap.get(id);
    if (id === DEFAULT_BRANCH_ID) return mainBranch.id;
    throw new DomainError('VALIDATION_ERROR', 'Import branch reference could not be remapped', { id });
  };
  const withBranch = (id: string | undefined): { branchId: string } | Record<string, never> => {
    const branchId = remapBranchId(id);
    return branchId === undefined ? {} : { branchId };
  };
  const calendarMap = new Map<string, string>();
  const calendarVersionMap = new Map<string, string>();
  for (const source of bundle.calendars) {
    const versions = bundle.calendarVersions.filter((version) => version.calendarId === source.id).sort((left, right) => left.version - right.version);
    const first = versions.find((version) => version.version === 1);
    if (!first) throw new DomainError('VALIDATION_ERROR', 'Import calendar is missing version 1', { calendarId: source.id });
    const created = await service.createCalendar(world.id, { name: source.name, definition: decodeCalendarDefinition(first.definition, first.id) }, await revision());
    calendarMap.set(source.id, created.calendar.id); calendarVersionMap.set(first.id, created.version.id);
    for (const version of versions.slice(1)) {
      const next = await service.createCalendarVersion(world.id, created.calendar.id, decodeCalendarDefinition(version.definition, version.id), await revision());
      calendarVersionMap.set(version.id, next.id);
    }
  }
  if (bundle.world.defaultCalendarVersionId !== undefined && bundle.world.defaultCalendarVersionId !== null) await service.setDefaultCalendarVersion(world.id, remapId(calendarVersionMap, bundle.world.defaultCalendarVersionId, 'default calendar version'), await revision());
  const typeMap = new Map<string, string>();
  const schemaVersionMap = new Map<string, number>();
  let importedEntityTypeVersionCount = 0;
  const existingTypes = await service.listEntityTypes(world.id);
  for (const type of bundle.entityTypes) {
    const existing = existingTypes.find((candidate) => candidate.typeKey === type.typeKey);
    const sourceVersions = bundle.entityTypeVersions.filter((version) => version.entityTypeId === type.id).sort((left, right) => left.schemaVersion - right.schemaVersion);
    const initialSchema = sourceVersions.find((version) => version.schemaVersion === 1)?.schema ?? type.schema;
    const created = existing ?? await service.createEntityType(world.id, { typeKey: type.typeKey, label: type.label, schema: (decodePortableValue(initialSchema) ?? {}) as Record<string, unknown> }, await revision());
    typeMap.set(type.id, created.id);
    if (!existing) schemaVersionMap.set(`${type.id}:1`, created.schemaVersion);
    else if (sourceVersions[0]?.schemaVersion === 1 && JSON.stringify(existing.schema) !== JSON.stringify(initialSchema)) {
      const importedVersion = await service.createEntityTypeVersion(world.id, created.id, (decodePortableValue(initialSchema) ?? {}) as Record<string, unknown>, await revision());
      schemaVersionMap.set(`${type.id}:1`, importedVersion.schemaVersion);
      importedEntityTypeVersionCount += 1;
    } else schemaVersionMap.set(`${type.id}:1`, created.schemaVersion);
    for (const version of sourceVersions.filter((item) => item.schemaVersion > 1)) {
      const importedVersion = await service.createEntityTypeVersion(world.id, created.id, (decodePortableValue(version.schema) ?? {}) as Record<string, unknown>, await revision());
      schemaVersionMap.set(`${type.id}:${version.schemaVersion}`, importedVersion.schemaVersion);
      importedEntityTypeVersionCount += 1;
    }
  }
  const entityMap = new Map<string, string>();
  const eventMaterializedEntityIds = new Set(bundle.events
    .filter((event) => event.canonStatus === 'canon' || event.canonStatus === 'retconned')
    .flatMap((event) => event.effects.filter((effect) => effect.type === 'CREATE_ENTITY').map((effect) => typeof effect.payload.id === 'string' ? effect.payload.id : effect.id)));
  const entityStatus: Array<{ source: string; target: string; status: import('@world-codex/domain').CanonStatus }> = [];
  const entitiesByParent = new Map<string | null, typeof bundle.entities>();
  for (const entity of bundle.entities) entitiesByParent.set(entity.parentEntityId, [...(entitiesByParent.get(entity.parentEntityId) ?? []), entity]);
  const entityQueue = [...(entitiesByParent.get(null) ?? [])];
  let importedEntityCount = 0;
  while (entityQueue.length) {
    const source = entityQueue.shift()!;
    importedEntityCount += 1;
    const sourceSchemaVersion = source.schemaVersion ?? 1;
    const mappedSchemaVersion = schemaVersionMap.get(`${source.typeId}:${sourceSchemaVersion}`);
    if (mappedSchemaVersion === undefined) throw new DomainError('VALIDATION_ERROR', 'Import entity schema version could not be remapped', { entityId: source.id, schemaVersion: sourceSchemaVersion });
    const created = await service.createEntityDraft(world.id, { typeId: remapId(typeMap, source.typeId, 'entity type'), schemaVersion: mappedSchemaVersion, snapshotBase: !eventMaterializedEntityIds.has(source.id), name: source.name, subtitle: source.subtitle ?? '', parentEntityId: source.parentEntityId === null ? null : remapId(entityMap, source.parentEntityId, 'parent entity'), document: (decodePortableValue(source.document) ?? {}) as Record<string, unknown>, documentText: source.documentText ?? '', tags: source.tags ?? [] }, await revision());
    entityMap.set(source.id, created.id);
    entityStatus.push({ source: source.id, target: created.id, status: source.canonStatus });
    entityQueue.push(...(entitiesByParent.get(source.id) ?? []));
  }
  if (importedEntityCount !== bundle.entities.length) throw new DomainError('VALIDATION_ERROR', 'Import entities cannot be ordered by parent dependency');
  const assetMap = new Map<string, string>();
  for (const source of bundle.assets) {
    const bytes = bundle.assetFiles?.get(source.id);
    if (!bytes) throw new DomainError('VALIDATION_ERROR', 'Asset binary is missing from ZIP bundle', { assetId: source.id });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const sourceByteSize = decodeTick(source.byteSize as unknown as string);
    if (sourceByteSize <= 0n || sourceByteSize > BigInt(25 * 1024 * 1024) || sha256 !== source.sha256 || BigInt(bytes.byteLength) !== sourceByteSize) throw new DomainError('VALIDATION_ERROR', 'Asset binary does not match bundle metadata', { assetId: source.id });
    if (detectRasterMediaType(Buffer.from(bytes)) !== source.mediaType) throw new DomainError('VALIDATION_ERROR', 'Asset binary MIME does not match bundle metadata', { assetId: source.id, mediaType: source.mediaType });
    const extension = source.mediaType === 'image/png' ? 'png' : source.mediaType === 'image/jpeg' ? 'jpg' : source.mediaType === 'image/webp' ? 'webp' : source.mediaType === 'image/gif' ? 'gif' : 'bin';
    const storageKey = `${world.id}/${sha256}.${extension}`;
    importedStorageKeys.add(storageKey);
    const stored = await assetStore.put(storageKey, Buffer.from(bytes));
    try {
      const created = await service.createAsset(world.id, { storageKey, mediaType: source.mediaType, byteSize: BigInt(bytes.byteLength), sha256, metadata: source.metadata, scanStatus: source.scanStatus, scanMessage: source.scanMessage }, await revision());
      assetMap.set(source.id, created.id);
    } catch (error) {
      if (stored) await assetStore.delete(storageKey);
      throw error;
    }
  }
  const mapMap = new Map<string, string>();
  for (const source of bundle.maps) {
    const created = await service.createMap(world.id, { name: source.name, crs: source.crs, width: source.width, height: source.height, ...(source.assetId === undefined ? {} : { assetId: remapId(assetMap, source.assetId, 'map asset') }) }, await revision());
    mapMap.set(source.id, created.id);
  }
  const mapLayerMap = new Map<string, string>();
  for (const source of bundle.mapLayers) {
    const targetMapId = remapId(mapMap, source.mapId, 'map layer map');
    const existingDefault = source.name === 'Default' && source.kind === 'base' && source.sortOrder === 0
      ? (await service.listMapLayers(world.id, targetMapId)).find((layer) => layer.name === source.name && layer.kind === source.kind && layer.sortOrder === source.sortOrder)
      : undefined;
    const created = existingDefault ?? await service.createMapLayer(world.id, targetMapId, { name: source.name, kind: source.kind, sortOrder: source.sortOrder, visible: source.visible, opacity: source.opacity, style: (decodePortableValue(source.style) ?? {}) as Record<string, unknown> }, await revision());
    mapLayerMap.set(source.id, created.id);
  }
  const mapFeatureMap = new Map<string, string>();
  for (const source of bundle.mapFeatures) {
    const geometry = validateGeometry(source.kind, (decodePortableValue(source.geometry) ?? {}) as Record<string, unknown>);
    const created = await service.createMapFeature(world.id, remapId(mapMap, source.mapId, 'map'), { ...(source.layerId === undefined ? {} : { layerId: remapId(mapLayerMap, source.layerId, 'map feature layer') }), ...(source.entityId === undefined ? {} : { entityId: remapId(entityMap, source.entityId, 'map feature entity') }), kind: source.kind, geometry, properties: validateMapProperties((decodePortableValue(source.properties) ?? {}) as Record<string, unknown>), ...(source.validFromTick === undefined ? {} : { validFromTick: decodeTick(source.validFromTick) }), ...(source.validToTick === undefined ? {} : { validToTick: decodeTick(source.validToTick) }) }, await revision());
    mapFeatureMap.set(source.id, created.id);
  }
  const factMap = new Map<string, string>();
  const factStatus: Array<{ source: string; target: string; status: import('@world-codex/domain').CanonStatus }> = [];
  for (const source of bundle.facts) {
    const created = await temporal.createFact(world.id, { subjectEntityId: remapId(entityMap, source.subjectEntityId, 'fact subject'), predicateKey: source.predicateKey, objectKind: source.objectKind, value: decodePortableValue(source.value), ...(source.objectEntityId === undefined ? {} : { objectEntityId: remapId(entityMap, source.objectEntityId, 'fact object') }), ...(source.validFromTick === undefined ? {} : { validFromTick: decodeTick(source.validFromTick) }), ...(source.validToTick === undefined ? {} : { validToTick: decodeTick(source.validToTick) }), sourceKind: source.sourceKind, ...withBranch(source.branchId) }, await revision());
    factMap.set(source.id, created.id); factStatus.push({ source: source.id, target: created.id, status: source.canonStatus });
  }
  const relationTypeMap = new Map<string, string>();
  for (const source of bundle.relationTypes) {
    const created = await temporal.createRelationType(world.id, { forwardLabel: source.forwardLabel, inverseLabel: source.inverseLabel, symmetric: source.symmetric, sourceTypeIds: source.sourceTypeIds.map((id) => remapId(typeMap, id, 'relation source type')), targetTypeIds: source.targetTypeIds.map((id) => remapId(typeMap, id, 'relation target type')) }, await revision());
    relationTypeMap.set(source.id, created.id);
  }
  const relationMap = new Map<string, string>();
  const relationStatus: Array<{ source: string; target: string; status: import('@world-codex/domain').CanonStatus }> = [];
  for (const source of bundle.relations) {
    const created = await temporal.createRelation(world.id, { sourceEntityId: remapId(entityMap, source.sourceEntityId, 'relation source'), targetEntityId: remapId(entityMap, source.targetEntityId, 'relation target'), relationTypeId: remapId(relationTypeMap, source.relationTypeId, 'relation type'), ...(source.validFromTick === undefined ? {} : { validFromTick: decodeTick(source.validFromTick) }), ...(source.validToTick === undefined ? {} : { validToTick: decodeTick(source.validToTick) }), description: source.description, ...withBranch(source.branchId) }, await revision());
    relationMap.set(source.id, created.id); relationStatus.push({ source: source.id, target: created.id, status: source.canonStatus });
  }
  const eventMap = new Map<string, string>();
  const eventStatus: Array<{ source: string; target: string; status: import('@world-codex/domain').CanonStatus }> = [];
  const eventBySourceId = new Map(bundle.events.map((event) => [event.id, event]));
  const eventDependencies = new Map<string, number>();
  const eventDependents = new Map<string, string[]>();
  for (const event of bundle.events) {
    const dependencies = [...event.causeEventIds, ...event.resultEventIds, ...(event.causalLinks ?? []).map((link) => link.targetEventId)];
    eventDependencies.set(event.id, dependencies.length);
    for (const dependency of dependencies) eventDependents.set(dependency, [...(eventDependents.get(dependency) ?? []), event.id]);
  }
  const eventQueue = bundle.events.filter((event) => eventDependencies.get(event.id) === 0).map((event) => event.id);
  let importedEventCount = 0;
  while (eventQueue.length) {
    const sourceId = eventQueue.shift()!;
    const source = eventBySourceId.get(sourceId)!;
    importedEventCount += 1;
    const sourceParticipants = source.participantRoles ?? source.participantIds.map((entityId) => ({ entityId, role: 'participant' }));
    const remappedParticipants = sourceParticipants.map((participant) => ({ entityId: remapId(entityMap, participant.entityId, 'event participant'), role: participant.role }));
    const producedIds = new Map<string, string>();
    for (const effect of source.effects) {
      const nextId = randomUUID();
      producedIds.set(effect.id, nextId);
      if (effect.type === 'CREATE_ENTITY' && typeof effect.payload.id === 'string') producedIds.set(effect.payload.id, nextId);
    }
    const created = await temporal.createEvent(world.id, { name: source.name, eventType: source.eventType, startTick: decodeTick(source.startTick), ...(source.endTick === undefined ? {} : { endTick: decodeTick(source.endTick) }), participantIds: [...new Set(remappedParticipants.map((participant) => participant.entityId))], participantRoles: remappedParticipants, ...(source.requiredRoles === undefined ? {} : { requiredRoles: source.requiredRoles }), locationEntityIds: source.locationEntityIds.map((id) => remapId(entityMap, id, 'event location')), causeEventIds: source.causeEventIds.map((id) => remapId(eventMap, id, 'event cause')), resultEventIds: source.resultEventIds.map((id) => remapId(eventMap, id, 'event result')), effects: source.effects.map((effect) => remapImportedEffect(effect, producedIds, { entityMap, factMap, relationMap, relationTypeMap, typeMap, mapFeatureMap })), effectsApplied: (source.canonStatus === 'canon' || source.canonStatus === 'retconned') && source.effects.length > 0, description: source.description, ...withBranch(source.branchId), ...(source.causalLinks === undefined ? {} : { causalLinks: source.causalLinks.map((link) => ({ ...link, targetEventId: remapId(eventMap, link.targetEventId, 'event causal target') })) }), ...(source.temporalExpression === undefined ? {} : { temporalExpression: source.temporalExpression }) }, await revision());
    eventMap.set(source.id, created.id); eventStatus.push({ source: source.id, target: created.id, status: source.canonStatus });
    for (const dependent of eventDependents.get(source.id) ?? []) {
      const remaining = (eventDependencies.get(dependent) ?? 0) - 1;
      eventDependencies.set(dependent, remaining);
      if (remaining === 0) eventQueue.push(dependent);
    }
  }
  if (importedEventCount !== bundle.events.length) throw new DomainError('VALIDATION_ERROR', 'Import events cannot be ordered by event-link dependency');
  for (const item of [...entityStatus.map((item) => ({ ...item, kind: 'entity' as const })), ...factStatus.map((item) => ({ ...item, kind: 'fact' as const })), ...relationStatus.map((item) => ({ ...item, kind: 'relation' as const })), ...eventStatus.map((item) => ({ ...item, kind: 'event' as const }))]) await applyImportedStatus(canon, world.id, item.kind, item.target, item.status, revision);
  const claimMap = new Map<string, string>();
  const claimStatus: Array<{ source: string; target: string; status: import('@world-codex/domain').CanonStatus }> = [];
  for (const source of bundle.claims) {
    const created = await temporal.createClaim(world.id, {
      predicateKey: source.predicateKey,
      objectKind: source.objectKind,
      value: decodePortableValue(source.value),
      knownByEntityIds: source.knownByEntityIds.map((id) => remapId(entityMap, id, 'claim audience')),
      truthStatus: source.truthStatus,
      claimKind: source.claimKind,
      sourceRefs: [...source.sourceRefs],
      ...(source.subjectEntityId === undefined ? {} : { subjectEntityId: remapId(entityMap, source.subjectEntityId, 'claim subject') }),
      ...(source.objectEntityId === undefined ? {} : { objectEntityId: remapId(entityMap, source.objectEntityId, 'claim object') }),
      ...(source.assertedByEntityId === undefined ? {} : { assertedByEntityId: remapId(entityMap, source.assertedByEntityId, 'claim assertor') }),
      ...(source.validFromTick === undefined ? {} : { validFromTick: decodeTick(source.validFromTick) }),
      ...(source.validToTick === undefined ? {} : { validToTick: decodeTick(source.validToTick) }),
      ...(source.confidence === undefined ? {} : { confidence: source.confidence }),
      ...withBranch(source.branchId),
    }, await revision());
    claimMap.set(source.id, created.id);
    claimStatus.push({ source: source.id, target: created.id, status: source.canonStatus });
  }
  for (const item of claimStatus) await applyImportedStatus(canon, world.id, 'claim', item.target, item.status, revision);
  const ruleMap = new Map<string, string>();
  for (const source of bundle.validationRules) {
    const created = await service.createValidationRule(world.id, {
      name: source.name,
      ...(source.description === undefined ? {} : { description: source.description }),
      severity: source.severity,
      target: source.target,
      ...(source.targetSelector === undefined ? {} : { targetSelector: {
        ...source.targetSelector,
        ...(source.targetSelector.typeId === undefined ? {} : { typeId: remapId(typeMap, source.targetSelector.typeId, 'rule target type') }),
        ...(source.targetSelector.relationTypeId === undefined ? {} : { relationTypeId: remapId(relationTypeMap, source.targetSelector.relationTypeId, 'rule relation type') }),
      } }),
      ...(source.when === undefined ? {} : { when: source.when }),
      assert: source.assert,
      ...(source.message === undefined ? {} : { message: source.message }),
      enabled: source.enabled,
    }, await revision());
    ruleMap.set(source.id, created.id);
  }
  const workMap = new Map<string, string>();
  for (const source of bundle.works) {
    const created = await service.createWork(world.id, { title: source.title, type: source.type, ...(source.description === undefined ? {} : { description: source.description }) }, await revision());
    workMap.set(source.id, created.id);
  }
  const chapterMap = new Map<string, string>();
  for (const source of bundle.chapters) {
    const created = await service.createChapter(world.id, remapId(workMap, source.workId, 'chapter work'), { title: source.title, orderIndex: source.orderIndex, ...(source.description === undefined ? {} : { description: source.description }) }, await revision());
    chapterMap.set(source.id, created.id);
  }
  const plotlineMap = new Map<string, string>();
  for (const source of bundle.plotlines) {
    const created = await service.createPlotline(world.id, {
      title: source.title,
      summary: source.summary,
      status: source.status,
      currentStage: source.currentStage,
      characterEntityIds: source.characterEntityIds.map((id) => remapId(entityMap, id, 'plotline character')),
      eventIds: source.eventIds.map((id) => remapId(eventMap, id, 'plotline event')),
    }, await revision());
    plotlineMap.set(source.id, created.id);
  }
  const sceneMap = new Map<string, string>();
  for (const source of bundle.scenes) {
    const created = await service.createScene(world.id, remapId(chapterMap, source.chapterId, 'scene chapter'), {
      ...(source.title === undefined ? {} : { title: source.title }),
      orderIndex: source.orderIndex,
      ...(source.sceneTick === undefined ? {} : { sceneTick: decodeTick(source.sceneTick) }),
      ...(source.povCharacterId === undefined ? {} : { povCharacterId: remapId(entityMap, source.povCharacterId, 'scene POV') }),
      ...(source.locationEntityId === undefined ? {} : { locationEntityId: remapId(entityMap, source.locationEntityId, 'scene location') }),
      participantEntityIds: source.participantEntityIds.map((id) => remapId(entityMap, id, 'scene participant')),
      plotlineIds: (source.plotlineIds ?? []).map((id) => remapId(plotlineMap, id, 'scene plotline')),
      proseText: source.proseText,
      status: source.status,
      ...(source.canonRevision === undefined ? {} : { canonRevision: decodeTick(source.canonRevision) }),
    }, await revision());
    sceneMap.set(source.id, created.id);
  }
  const foreshadowingMap = new Map<string, string>();
  for (const source of bundle.foreshadowings) {
    const created = await service.createForeshadowing(world.id, {
      title: source.title,
      ...(source.description === undefined ? {} : { description: source.description }),
      setupSceneId: remapId(sceneMap, source.setupSceneId, 'foreshadowing setup scene'),
      ...(source.setupTick === undefined ? {} : { setupTick: decodeTick(source.setupTick) }),
      ...(source.payoffSceneId === undefined ? {} : { payoffSceneId: remapId(sceneMap, source.payoffSceneId, 'foreshadowing payoff scene') }),
      ...(source.payoffTick === undefined ? {} : { payoffTick: decodeTick(source.payoffTick) }),
      relatedEntityIds: source.relatedEntityIds.map((id) => remapId(entityMap, id, 'foreshadowing entity')),
      ...(source.plotlineId === undefined ? {} : { plotlineId: remapId(plotlineMap, source.plotlineId, 'foreshadowing plotline') }),
      status: source.status,
    }, await revision());
    foreshadowingMap.set(source.id, created.id);
  }
  const importedWorld = await service.getWorld(world.id);
  return { world: toWorldDto(importedWorld), sourceHash: bundleHash(bundle), counts: { entityTypes: typeMap.size, entityTypeVersions: importedEntityTypeVersionCount, entities: entityMap.size, facts: factMap.size, relationTypes: relationTypeMap.size, relations: relationMap.size, events: eventMap.size, maps: mapMap.size, mapLayers: mapLayerMap.size, mapFeatures: bundle.mapFeatures.length, assets: assetMap.size, calendars: calendarMap.size, calendarVersions: calendarVersionMap.size, timelineBranches: importedBranchCount + 1, claims: claimMap.size, validationRules: ruleMap.size, works: workMap.size, chapters: chapterMap.size, scenes: sceneMap.size, plotlines: plotlineMap.size, foreshadowings: foreshadowingMap.size } };
  } catch (error) {
    await service.removeWorld(world.id);
    for (const storageKey of importedStorageKeys) {
      try { await assetStore.delete(storageKey); } catch { /* preserve the original import failure */ }
    }
    throw error;
  }
}

async function applyImportedStatus(canon: CanonApplicationService, worldId: string, kind: 'entity' | 'fact' | 'relation' | 'event' | 'claim', id: string, status: import('@world-codex/domain').CanonStatus, revision: () => Promise<bigint>): Promise<void> {
  const reason = 'Imported from a World Codex bundle';
  if (status === 'draft') return;
  if (status === 'archived') { await canon.changeStatus(worldId, kind, id, 'archived', await revision(), reason); return; }
  await canon.changeStatus(worldId, kind, id, 'pending', await revision(), reason);
  if (status === 'pending') return;
  await canon.changeStatus(worldId, kind, id, 'canon', await revision(), reason);
  if (status === 'retconned') await canon.changeStatus(worldId, kind, id, 'retconned', await revision(), reason);
}
