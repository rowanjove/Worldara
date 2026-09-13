import { describe, expect, it, vi } from 'vitest';
import { CanonApplicationService, InMemoryWorldRepository, TemporalApplicationService, WorldApplicationService } from '@world-codex/application';
import { createApp } from './app';
import { bundleToZip, parseBundle } from '@world-codex/portable';
import type { ProposalProvider } from '@world-codex/ai';
import { validateWorld, validateIncremental } from '@world-codex/validator';
import type { ChangeSet } from '@world-codex/domain';

function setupWithRepository(repo: InMemoryWorldRepository) {
  const service = new WorldApplicationService(repo, { next: () => crypto.randomUUID() }, { now: () => new Date('2026-09-07T00:00:00.000Z') });
  const clock = { now: () => new Date('2026-09-07T00:00:00.000Z') };
  return createApp(service, new TemporalApplicationService(repo, { next: () => crypto.randomUUID() }, clock), new CanonApplicationService(repo, clock, async () => []), undefined, repo, undefined, undefined, repo);
}

function setupWithValidator(repo = new InMemoryWorldRepository()) {
  const service = new WorldApplicationService(repo, { next: () => crypto.randomUUID() }, { now: () => new Date('2026-09-07T00:00:00.000Z') });
  const clock = { now: () => new Date('2026-09-07T00:00:00.000Z') };
  const temporal = new TemporalApplicationService(repo, { next: () => crypto.randomUUID() }, clock);
  const validateWorldState = async (worldId: string) => {
    const world = await repo.getWorld(worldId);
    if (!world) return [];
    const [entities, entityTypes, facts, relationTypes, relations, events, rules] = await Promise.all([
      repo.listEntities(worldId), repo.listEntityTypes(worldId), repo.listFacts(worldId), repo.listRelationTypes(worldId), repo.listRelations(worldId), repo.listEvents(worldId), repo.listValidationRules(worldId),
    ]);
    return validateWorld({ world, entities, entityTypes, facts, relationTypes, relations, events, rules });
  };
  const validateWorldIncrementalState = async (worldId: string, changeSet: ChangeSet) => {
    const world = await repo.getWorld(worldId);
    if (!world) {
      return {
        issues: [],
        affectedRuleCodes: [],
        skippedRuleCodes: [],
        impactedEntityIds: [],
        isIncremental: true,
      };
    }
    const [entities, entityTypes, facts, relationTypes, relations, events, rules] = await Promise.all([
      repo.listEntities(worldId), repo.listEntityTypes(worldId), repo.listFacts(worldId), repo.listRelationTypes(worldId), repo.listRelations(worldId), repo.listEvents(worldId), repo.listValidationRules(worldId),
    ]);
    return validateIncremental({ world, entities, entityTypes, facts, relationTypes, relations, events, rules }, changeSet, rules);
  };
  const canon = new CanonApplicationService(repo, clock, (worldId) => validateWorldState(worldId));
  return createApp(service, temporal, canon, validateWorldState, repo, undefined, undefined, repo, validateWorldIncrementalState);
}

function setup() { return setupWithRepository(new InMemoryWorldRepository()); }

describe('API walking skeleton', () => {
  it('serves a restricted browser CORS preflight for the local web origin', async () => {
    const app = setup();
    const allowed = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'http://localhost:3000' } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-headers']).toContain('x-asset-media-type');
    const denied = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://attacker.invalid' } });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it('creates a world, type, and entity draft through the same command path', async () => {
    const app = setup();
    const explicitChineseSlug = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: '北辰', slug: '北辰示例' } });
    expect(explicitChineseSlug.statusCode).toBe(201);
    const worldResponse = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: '北辰世界', genre: 'Fantasy' } });
    expect(worldResponse.statusCode).toBe(201);
    const world = worldResponse.json().data;
    const revisions = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/revisions` });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().data[0].sequence).toBe('1');
    const changes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/revisions/1/changes` });
    expect(changes.statusCode).toBe(200);
    expect(changes.json().data[0]).toMatchObject({ sequence: '1', objectType: 'world', objectId: world.id, operation: 'create' });
    const typeResponse = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': String(world.revision) }, payload: { typeKey: 'character', label: '人物' } });
    expect(typeResponse.statusCode).toBe(201);
    const entityResponse = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': String(Number(world.revision) + 1) }, payload: { typeId: typeResponse.json().data.id, name: '李衡', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '皇太子' }] }] } } });
    expect(entityResponse.statusCode).toBe(201);
    expect(entityResponse.json().data.name).toBe('李衡');
    expect(entityResponse.json().data.schemaVersion).toBe(1);
    await app.close();
  });

  it('initializes the PRD taxonomy for every new world', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Taxonomy World' } })).json().data;
    const types = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entity-types` })).json().data as Array<{ typeKey: string }>;
    expect(types.length).toBeGreaterThanOrEqual(20);
    expect(types.map((type) => type.typeKey)).toEqual(expect.arrayContaining(['core_character', 'core_place', 'core_faction', 'core_event', 'core_region', 'core_species', 'core_magic_system', 'core_plot_thread']));
    await app.close();
  });

  it('keeps entity type schemas as immutable, revisioned versions', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Schema Versions' } })).json().data;
    const created = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'relic', label: 'Relic', schema: { fields: [{ id: 'quality', type: 'text' }] } } });
    expect(created.statusCode).toBe(201);
    const type = created.json().data;
    const next = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types/${type.id}/versions`, headers: { 'if-match': '2' }, payload: { schema: { fields: [{ id: 'quality', type: 'select' }] } } });
    expect(next.statusCode).toBe(201);
    expect(next.json().data.schemaVersion).toBe(2);
    const versions = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entity-types/${type.id}/versions` });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().data.map((version: { schemaVersion: number }) => version.schemaVersion)).toEqual([1, 2]);
    const current = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entity-types` });
    expect(current.json().data.find((item: { id: string }) => item.id === type.id).schemaVersion).toBe(2);
    await app.close();
  });

  it('enforces FieldSchema types, required values, and entity references on drafts', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Typed Entities' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: {
      typeKey: 'person', label: 'Person', schema: { fields: [
        { key: 'age', label: 'Age', value_type: 'Number', required: true, validation_json: { min: 0 } },
        { key: 'ally', label: 'Ally', value_type: 'EntityReference' },
      ] },
    } })).json().data;
    const missing = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Missing age', document: {} } });
    expect(missing.statusCode).toBe(422);
    const target = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Target', document: { age: 20 } } });
    expect(target.statusCode).toBe(201);
    const source = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '3' }, payload: { typeId: type.id, name: 'Source', document: { age: 21, ally: target.json().data.id } } });
    expect(source.statusCode).toBe(201);
    const foreign = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '4' }, payload: { typeId: type.id, name: 'Foreign ref', document: { age: 22, ally: crypto.randomUUID() } } });
    expect(foreign.statusCode).toBe(422);
    await app.close();
  });

  it('rejects an update with a stale revision', async () => {
    const app = setup();
    const worldResponse = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Test World' } });
    const world = worldResponse.json().data;
    const response = await app.inject({ method: 'PATCH', url: `/api/v1/worlds/${world.id}`, headers: { 'if-match': '999' }, payload: { description: 'stale' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('REVISION_CONFLICT');
    await app.close();
  });

  it('rejects malformed idempotency keys before executing a write', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Idempotency Contract' } })).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': world.revision, 'idempotency-key': 'short' }, payload: { name: 'No write', eventType: 'test', startTick: '0' } });
    expect(response.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/events` })).json().data).toHaveLength(0);
    await app.close();
  });

  it('archives worlds by default and restores them with revision checks', async () => {
    const app = setup();
    const created = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Archive World' } });
    const world = created.json().data;
    expect(world.archivedAt).toBeNull();

    const archived = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/archive`, headers: { 'if-match': world.revision } });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.archivedAt).toEqual(expect.any(String));
    const proposal = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'Should be blocked', baseWorldRevision: archived.json().data.revision, changes: [] } });
    expect(proposal.statusCode).toBe(422);
    const blockedWrite = await app.inject({ method: 'PATCH', url: `/api/v1/worlds/${world.id}`, headers: { 'if-match': archived.json().data.revision }, payload: { description: 'must stay frozen' } });
    expect(blockedWrite.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/api/v1/worlds' })).json().data).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/worlds?includeArchived=true' })).json().data).toHaveLength(1);

    const restored = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/restore`, headers: { 'if-match': archived.json().data.revision } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.archivedAt).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/v1/worlds' })).json().data).toHaveLength(1);
    await app.close();
  });

  it('writes temporal records with optimistic concurrency and returns a snapshot envelope', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Temporal World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const first = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'A' } })).json().data;
    const second = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '3' }, payload: { typeId: type.id, name: 'B' } })).json().data;
    const relationType = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/relation-types`, headers: { 'if-match': '4' }, payload: { forwardLabel: 'knows' } })).json().data;
    const fact = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/facts`, headers: { 'if-match': '5' }, payload: { subjectEntityId: first.id, predicateKey: 'title', objectKind: 'scalar', value: 'captain', validFromTick: '0' } });
    expect(fact.statusCode).toBe(201);
    const relation = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/relations`, headers: { 'if-match': '6' }, payload: { sourceEntityId: first.id, targetEntityId: second.id, relationTypeId: relationType.id } });
    expect(relation.statusCode).toBe(201);
    const event = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '7' }, payload: { name: 'Meeting', eventType: 'social', startTick: '0', participantIds: [first.id, second.id], effects: [{ type: 'SET_STATUS', targetId: first.id, payload: { status: 'active' }, sequence: 0 }] } });
    expect(event.statusCode).toBe(201);
    const retry = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '8', 'idempotency-key': 'meeting-1' }, payload: { name: 'Meeting', eventType: 'social', startTick: '0', participantIds: [first.id, second.id] } });
    const replay = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '999', 'idempotency-key': 'meeting-1' }, payload: { name: 'Different payload', eventType: 'social', startTick: '0' } });
    expect(retry.statusCode).toBe(201);
    expect(replay.statusCode).toBe(409);
    const snapshot = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=0` });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().data.worldId).toBe(world.id);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/facts` })).json().data).toHaveLength(1);
    await app.close();
  });

  it('rejects malformed temporal references before repository writes', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Temporal Validation' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'A' } })).json().data;
    const invalidFact = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/facts`, headers: { 'if-match': '3' }, payload: { subjectEntityId: entity.id, predicateKey: 'friend', objectKind: 'entity' } });
    expect(invalidFact.statusCode).toBe(422);
    const invalidEvent = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '3' }, payload: { name: 'Broken', eventType: 'test', startTick: '0', participantIds: [crypto.randomUUID()] } });
    expect(invalidEvent.statusCode).toBe(404);
    await app.close();
  });

  it('coalesces concurrent event retries with the same idempotency key', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Concurrent Idempotency' } })).json().data;
    const payload = { name: 'Only Once', eventType: 'test', startTick: '0' };
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': world.revision, 'idempotency-key': 'same-event' }, payload }),
      app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': world.revision, 'idempotency-key': 'same-event' }, payload }),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().data.id).toBe(second.json().data.id);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/events` })).json().data).toHaveLength(1);
    await app.close();
  });

  it('serializes the same idempotency key across API instances sharing a store', async () => {
    const repo = new InMemoryWorldRepository();
    const firstApp = setupWithRepository(repo);
    const secondApp = setupWithRepository(repo);
    const world = (await firstApp.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Cross Instance Idempotency' } })).json().data;
    const payload = { name: 'Only Once Across Instances', eventType: 'test', startTick: '0' };
    const [first, second] = await Promise.all([
      firstApp.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': world.revision, 'idempotency-key': 'cross-instance-event' }, payload }),
      secondApp.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': world.revision, 'idempotency-key': 'cross-instance-event' }, payload }),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().data.id).toBe(second.json().data.id);
    expect((await firstApp.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/events` })).json().data).toHaveLength(1);
    await firstApp.close();
    await secondApp.close();
  });

  it('replays an event idempotency result after an API instance restart', async () => {
    const repo = new InMemoryWorldRepository();
    const app = setupWithRepository(repo);
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Persistent Idempotency' } })).json().data;
    const created = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': world.revision, 'idempotency-key': 'restart-event' }, payload: { name: 'Persisted', eventType: 'test', startTick: '0' } });
    expect(created.statusCode).toBe(201);
    await app.close();
    const restarted = setupWithRepository(repo);
    const replay = await restarted.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '999', 'idempotency-key': 'restart-event' }, payload: { name: 'Persisted', eventType: 'test', startTick: '0' } });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(created.json().data.id);
    expect((await restarted.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/events` })).json().data).toHaveLength(1);
    await restarted.close();
  });

  it('enforces the Draft -> Pending -> Canon transition and revision checks', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Canon World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Candidate' } })).json().data;
    const pending = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '3' }, payload: { status: 'pending', reason: 'Ready for review' } });
    expect(pending.statusCode).toBe(200);
    const canon = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '4' }, payload: { status: 'canon', reason: 'Reviewed' } });
    expect(canon.statusCode).toBe(200);
    expect(canon.json().data.canonStatus).toBe('canon');
    const invalid = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '5' }, payload: { status: 'draft', reason: 'Rollback' } });
    expect(invalid.statusCode).toBe(422);
    await app.close();
  });

  it('records the retcon revision on temporal facts', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Retcon Provenance World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Candidate' } })).json().data;
    const fact = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/facts`, headers: { 'if-match': '3' }, payload: { subjectEntityId: entity.id, predicateKey: 'title', objectKind: 'scalar', value: 'former' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${fact.id}`, headers: { 'if-match': '4' }, payload: { status: 'pending', reason: 'Review fact' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${fact.id}`, headers: { 'if-match': '5' }, payload: { status: 'canon', reason: 'Approve fact' } });
    const retconned = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${fact.id}`, headers: { 'if-match': '6' }, payload: { status: 'retconned', reason: 'Superseded by later history' } });
    expect(retconned.statusCode).toBe(200);
    expect(retconned.json().data).toMatchObject({ canonStatus: 'retconned', retconnedRevision: '7' });
    await app.close();
  });

  it('materializes Canon event effects atomically when an event is promoted', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Event Materialization World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Commander' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '3' }, payload: { status: 'pending', reason: 'Review commander' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '4' }, payload: { status: 'canon', reason: 'Approve commander' } });
    const event = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '5' }, payload: { name: 'Promotion', eventType: 'political', startTick: '10', participantIds: [entity.id], effects: [{ type: 'SET_STATUS', targetId: entity.id, payload: { status: 'active' }, sequence: 0 }, { type: 'ADD_FACT', payload: { subjectEntityId: entity.id, predicateKey: 'title', objectKind: 'scalar', value: 'commander' }, sequence: 1 }] } })).json().data;
    const pending = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '6' }, payload: { status: 'pending', reason: 'Review event' } });
    expect(pending.statusCode).toBe(200);
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '7' }, payload: { status: 'canon', reason: 'Approve event' } });
    expect(accepted.statusCode).toBe(200);
    const updated = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entities/${entity.id}` });
    expect(updated.json().data.document.status).toBe('active');
    const snapshot = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=10` });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().data.entities.find((item: { id: string }) => item.id === entity.id).document.status).toBe('active');
    const facts = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/facts` });
    expect(facts.statusCode).toBe(200);
    expect(facts.json().data.find((item: { predicateKey: string }) => item.predicateKey === 'title')).toMatchObject({ sourceKind: 'event', sourceRefId: event.id, createdRevision: '8' });
    const retconned = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '8' }, payload: { status: 'retconned', reason: 'Remove event from Canon' } });
    expect(retconned.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entities/${entity.id}` })).json().data.document.status).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/facts` })).json().data.find((item: { predicateKey: string }) => item.predicateKey === 'title')).toBeUndefined();
    await app.close();
  });

  it('accepts SET_FIELD event effects for entity document fields', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Set Field World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Candidate' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '3' }, payload: { status: 'pending', reason: 'Review' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '4' }, payload: { status: 'canon', reason: 'Approve' } });
    const eventResponse = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '5' }, payload: { name: 'Reveal', eventType: 'political', startTick: '10', participantIds: [entity.id], effects: [{ type: 'SET_FIELD', targetId: entity.id, payload: { field: 'rank', value: 'commander' }, sequence: 0 }] } });
    expect(eventResponse.statusCode).toBe(201);
    const event = eventResponse.json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '6' }, payload: { status: 'pending', reason: 'Review event' } });
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '7' }, payload: { status: 'canon', reason: 'Approve event' } });
    expect(accepted.statusCode).toBe(200);
    const updated = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entities/${entity.id}` });
    expect(updated.json().data.document.rank).toBe('commander');
    const before = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=0` });
    expect(before.json().data.entities.find((item: { id: string }) => item.id === entity.id).document.rank).toBeUndefined();
    const snapshot = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=10` });
    expect(snapshot.json().data.entities.find((item: { id: string }) => item.id === entity.id).document.rank).toBe('commander');
    await app.close();
  });

  it('keeps CREATE_ENTITY and ARCHIVE_ENTITY effects out of earlier snapshots', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Entity History' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'history-person', label: 'Person' } })).json().data;
    const existing = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Existing' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${existing.id}`, headers: { 'if-match': '3' }, payload: { status: 'pending', reason: 'review' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${existing.id}`, headers: { 'if-match': '4' }, payload: { status: 'canon', reason: 'approve' } });
    const event = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '5' }, payload: { name: 'Boundary', eventType: 'change', startTick: '10', effects: [{ type: 'ARCHIVE_ENTITY', targetId: existing.id, payload: {}, sequence: 0 }, { type: 'CREATE_ENTITY', payload: { typeId: type.id, name: 'Future' }, sequence: 1 }] } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '6' }, payload: { status: 'pending', reason: 'review' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '7' }, payload: { status: 'canon', reason: 'approve' } })).statusCode).toBe(200);
    const before = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=0` })).json().data.entities as Array<{ name: string }>;
    const after = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=10` })).json().data.entities as Array<{ name: string }>;
    expect(before.map((item) => item.name)).toContain('Existing');
    expect(before.map((item) => item.name)).not.toContain('Future');
    expect(after.map((item) => item.name)).not.toContain('Existing');
    expect(after.map((item) => item.name)).toContain('Future');
    await app.close();
  });

  it('materializes CHANGE_GEOMETRY as a temporal map-feature version', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Geometry Event World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'place', label: 'Place' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Harbor' } })).json().data;
    const map = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps`, headers: { 'if-match': '3' }, payload: { name: 'Coast', width: 1000, height: 800 } })).json().data;
    const feature = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features`, headers: { 'if-match': '4' }, payload: { entityId: entity.id, kind: 'marker', geometry: { type: 'Point', coordinates: [1, 2] } } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '5' }, payload: { status: 'pending', reason: 'Review place' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '6' }, payload: { status: 'canon', reason: 'Approve place' } });
    const event = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '7' }, payload: { name: 'Harbor moves', eventType: 'travel', startTick: '10', participantIds: [entity.id], effects: [{ type: 'CHANGE_GEOMETRY', targetId: feature.id, payload: { geometry: { type: 'Point', coordinates: [5, 8] } }, sequence: 0 }] } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '8' }, payload: { status: 'pending', reason: 'Review movement' } });
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/event/${event.id}`, headers: { 'if-match': '9' }, payload: { status: 'canon', reason: 'Approve movement' } });
    expect(accepted.statusCode).toBe(200);
    const features = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features` });
    expect(features.statusCode).toBe(200);
    expect(features.json().data).toHaveLength(2);
    expect(features.json().data.find((item: { id: string }) => item.id === feature.id).validToTick).toBe('10');
    expect(features.json().data.find((item: { id: string }) => item.id !== feature.id)).toMatchObject({ validFromTick: '10', geometry: { coordinates: [5, 8] } });
    const snapshot = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=10` });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().data.mapFeatures).toHaveLength(1);
    expect(snapshot.json().data.mapFeatures[0]).toMatchObject({ validFromTick: '10', geometry: { coordinates: [5, 8] } });
    await app.close();
  });

  it('validates and persists map features bound to a world entity', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Map World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'place', label: 'Place' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Harbor' } })).json().data;
    const map = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps`, headers: { 'if-match': '3' }, payload: { name: 'Main', width: 1000, height: 800 } })).json().data;
    const feature = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features`, headers: { 'if-match': '4' }, payload: { entityId: entity.id, kind: 'marker', geometry: { type: 'Point', coordinates: [10, 20] } } });
    expect(feature.statusCode).toBe(201);
    const invalid = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features`, headers: { 'if-match': '5' }, payload: { kind: 'polygon', geometry: { type: 'Point', coordinates: [10, 20] } } });
    expect(invalid.statusCode).toBe(422);
    const oversizedProperties = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key-${index}`, true]));
    const rejectedProperties = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features`, headers: { 'if-match': '5' }, payload: { kind: 'marker', geometry: { type: 'Point', coordinates: [10, 20] }, properties: oversizedProperties } });
    expect(rejectedProperties.statusCode).toBe(422);
    const imported = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/import.geojson`, headers: { 'if-match': '5' }, payload: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [30, 40] }, properties: { entityId: entity.id, source: 'geojson' } }, { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 0]]] }, properties: {} }] } });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.count).toBe(2);
    const invalidImport = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/import.geojson`, headers: { 'if-match': '7' }, payload: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [50, 60] }, properties: { entityId: '00000000-0000-4000-8000-000000000000' } }] } });
    expect(invalidImport.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features` })).json().data).toHaveLength(3);
    await app.close();
  });

  it('supports first-class map layers and layer-bound features', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Layer World' } })).json().data;
    const map = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps`, headers: { 'if-match': world.revision }, payload: { name: 'Layered', width: 100, height: 100 } })).json().data;
    const defaults = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/maps/${map.id}/layers` });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().data).toHaveLength(1);
    expect(defaults.json().data[0]).toMatchObject({ name: 'Default', kind: 'base', visible: true, opacity: 1 });
    const rejectedStyle = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/layers`, headers: { 'if-match': '2' }, payload: { name: 'Too Wide', style: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key-${index}`, true])) } });
    expect(rejectedStyle.statusCode).toBe(422);
    const overlay = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/layers`, headers: { 'if-match': '2' }, payload: { name: 'Borders', kind: 'overlay', opacity: 0.75, style: { color: '#ff0000' } } });
    expect(overlay.statusCode).toBe(201);
    const layer = overlay.json().data;
    expect(layer).toMatchObject({ name: 'Borders', kind: 'overlay', opacity: 0.75, style: { color: '#ff0000' } });
    const hidden = await app.inject({ method: 'PATCH', url: `/api/v1/worlds/${world.id}/maps/${map.id}/layers/${layer.id}`, headers: { 'if-match': '3' }, payload: { visible: false } });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data.visible).toBe(false);
    const feature = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features`, headers: { 'if-match': '4' }, payload: { layerId: layer.id, kind: 'marker', geometry: { type: 'Point', coordinates: [1, 2] } } });
    expect(feature.statusCode).toBe(201);
    expect(feature.json().data.layerId).toBe(layer.id);
    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    expect(exported.statusCode).toBe(200);
    expect(JSON.parse(exported.body).mapLayers).toHaveLength(2);
    expect(JSON.parse(exported.body).mapFeatures[0].layerId).toBe(layer.id);
    await app.close();
  });

  it('round-trips map layers and feature bindings through bundle import', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Layer Roundtrip World' } })).json().data;
    const map = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps`, headers: { 'if-match': '1' }, payload: { name: 'Roundtrip Map', width: 100, height: 100 } })).json().data;
    const layer = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/layers`, headers: { 'if-match': '2' }, payload: { name: 'Overlay', kind: 'overlay' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps/${map.id}/features`, headers: { 'if-match': '3' }, payload: { layerId: layer.id, kind: 'marker', geometry: { type: 'Point', coordinates: [3, 4] } } });
    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/commit', payload: { bundle: JSON.parse(exported.body), name: 'Layer Roundtrip Imported' } });
    expect(imported.statusCode).toBe(201);
    const importedWorldId = imported.json().data.world.id as string;
    const importedMaps = await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorldId}/maps` });
    const importedMapId = importedMaps.json().data[0].id as string;
    const importedLayers = await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorldId}/maps/${importedMapId}/layers` });
    const importedFeatures = await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorldId}/maps/${importedMapId}/features` });
    expect(importedLayers.json().data).toHaveLength(2);
    expect(importedFeatures.json().data).toHaveLength(1);
    expect(importedFeatures.json().data[0].layerId).not.toBe(layer.id);
    expect(importedFeatures.json().data[0].layerId).toBe(importedLayers.json().data.find((item: { name: string }) => item.name === 'Overlay').id);
    await app.close();
  });

  it('accepts only signature-verified raster assets and serves them by world', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Asset World' } })).json().data;
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const rejected = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/assets`, headers: { 'if-match': world.revision, 'content-type': 'application/octet-stream', 'x-asset-media-type': 'image/jpeg' }, payload: pngHeader });
    expect(rejected.statusCode).toBe(422);
    const uploaded = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/assets`, headers: { 'if-match': world.revision, 'content-type': 'application/octet-stream', 'x-asset-media-type': 'image/png', 'x-file-name': '..\\map.png' }, payload: pngHeader });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().data.metadata.fileName).toBe('map.png');
    const assetId = uploaded.json().data.id;
    const downloaded = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/assets/${assetId}` });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-type']).toContain('image/png');
    expect(Buffer.from(downloaded.rawPayload).equals(pngHeader)).toBe(true);
    const duplicate = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/assets`, headers: { 'if-match': '2', 'content-type': 'application/octet-stream', 'x-asset-media-type': 'image/png' }, payload: pngHeader });
    expect(duplicate.statusCode).toBe(409);
    const stillThere = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/assets/${assetId}` });
    expect(stillThere.statusCode).toBe(200);
    const map = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/maps`, headers: { 'if-match': '2' }, payload: { name: 'Map', width: 100, height: 100, assetId } });
    expect(map.statusCode).toBe(201);
    const archive = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.zip` });
    expect(archive.statusCode).toBe(200);
    const inspected = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect.zip', headers: { 'content-type': 'application/zip' }, payload: archive.rawPayload });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json().data.counts.assets).toBe(1);
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/commit.zip', headers: { 'content-type': 'application/zip', 'idempotency-key': 'asset-import-1' }, payload: archive.rawPayload });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.counts.assets).toBe(1);
    const structuralJson = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    const jsonImport = await app.inject({ method: 'POST', url: '/api/v1/imports/commit', payload: { bundle: JSON.parse(structuralJson.body), name: 'Missing Binary' } });
    expect(jsonImport.statusCode).toBe(422);
    await app.close();
  });

  it('keeps map asset references scoped to the same world and passed scans', async () => {
    const app = setup();
    const first = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Asset Owner' } })).json().data;
    const second = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Other World' } })).json().data;
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const uploaded = await app.inject({ method: 'POST', url: `/api/v1/worlds/${first.id}/assets`, headers: { 'if-match': first.revision, 'content-type': 'application/octet-stream', 'x-asset-media-type': 'image/png' }, payload: pngHeader });
    const assetId = uploaded.json().data.id;
    const crossWorld = await app.inject({ method: 'POST', url: `/api/v1/worlds/${second.id}/maps`, headers: { 'if-match': second.revision }, payload: { name: 'Invalid', width: 100, height: 100, assetId } });
    expect(crossWorld.statusCode).toBe(404);
    await app.close();
  });

  it('serves isolated search results and a portable export', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Export World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Searchable', document: { note: 'unique phrase' } } });
    const search = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/search?q=unique%20phrase` });
    expect(search.statusCode).toBe(200);
    expect(search.json().data[0].title).toBe('Searchable');
    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/json');
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.md` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.geojson` })).json().type).toBe('FeatureCollection');
    const archive = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.zip` });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers['content-type']).toContain('application/zip');
    const obsidian = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.obsidian.zip` });
    expect(obsidian.statusCode).toBe(200);
    expect(obsidian.headers['content-type']).toContain('application/zip');
    const inspectedZip = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect.zip', headers: { 'content-type': 'application/zip' }, payload: bundleToZip(parseBundle(exported.body)) });
    expect(inspectedZip.statusCode).toBe(200);
    const inspected = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: JSON.parse(exported.body) });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json().data.counts.entities).toBe(1);
    await app.close();
  });

  it('inspects and commits bounded Markdown and CSV imports through the normal pipeline', async () => {
    const app = setup();
    const markdown = [
      '---',
      'format: world-codex.markdown',
      'version: 1',
      'slug: markdown-world',
      'genre: Fantasy',
      'canonStrategy: strict',
      '---',
      '# Markdown World',
      '',
      'A small imported world.',
      '',
      '## Entities',
      '',
      '### Hero',
      '```yaml',
      'id: source-hero',
      'typeId: character',
      'canonStatus: draft',
      '```',
      'A portable hero document.',
    ].join('\n');
    const inspectedMarkdown = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect.markdown', headers: { 'content-type': 'text/markdown' }, payload: markdown });
    expect(inspectedMarkdown.statusCode).toBe(200);
    expect(inspectedMarkdown.json().data.counts.entities).toBe(1);
    const committedMarkdown = await app.inject({ method: 'POST', url: '/api/v1/imports/commit.markdown', headers: { 'idempotency-key': 'markdown-import-1' }, payload: { text: markdown, name: 'Markdown Imported' } });
    expect(committedMarkdown.statusCode).toBe(201);
    expect(committedMarkdown.json().data.world.name).toBe('Markdown Imported');
    expect(committedMarkdown.json().data.counts.entities).toBe(1);
    const conflictingMarkdown = await app.inject({ method: 'POST', url: '/api/v1/imports/commit.markdown', headers: { 'idempotency-key': 'markdown-import-1' }, payload: { text: markdown, name: 'Different Name' } });
    expect(conflictingMarkdown.statusCode).toBe(409);

    const csv = 'id,name,typeId,canonStatus,parentEntityId,documentText,tags\nsource-csv,"CSV, Hero",character,canon,,"quoted, document",hero|imported\n';
    const inspectedCsv = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect.csv', headers: { 'content-type': 'text/csv' }, payload: csv });
    expect(inspectedCsv.statusCode).toBe(200);
    expect(inspectedCsv.json().data.counts.entities).toBe(1);
    const committedCsv = await app.inject({ method: 'POST', url: '/api/v1/imports/commit.csv', headers: { 'idempotency-key': 'csv-import-1' }, payload: { text: csv, worldName: 'CSV Source', name: 'CSV Imported' } });
    expect(committedCsv.statusCode).toBe(201);
    expect(committedCsv.json().data.world.name).toBe('CSV Imported');
    expect(committedCsv.json().data.counts.entities).toBe(1);
    await app.close();
  });

  it('returns a contract error for malformed bundle input instead of an internal error', async () => {
    const app = setup();
    const response = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: { format: 'not-a-bundle' } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    const malformedShape = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: { format: 'world-codex.bundle', version: 1, world: { id: 'not-a-world' }, entities: [], entityTypes: [], facts: [], relationTypes: [], relations: [], events: [] } });
    expect(malformedShape.statusCode).toBe(422);
    const missingInitialVersion = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: { format: 'world-codex.bundle', version: 1, world: { id: 'w', name: 'W', slug: 'w', description: '', genre: 'Custom', canonStrategy: 'strict' }, entityTypes: [{ id: 't', worldId: 'w', typeKey: 'custom', label: 'Custom' }], entityTypeVersions: [{ id: 'v2', worldId: 'w', entityTypeId: 't', schemaVersion: 2, schema: {}, createdRevision: '1n', createdAt: '2026-01-01T00:00:00.000Z' }], entities: [], facts: [], relationTypes: [], relations: [], events: [] } });
    expect(missingInitialVersion.statusCode).toBe(422);
    expect(missingInitialVersion.json().error.message).toContain('start at version 1');
    await app.close();
  });

  it('rejects inconsistent or duplicate event participant roles during import inspection', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Participant Role Validation' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Hero' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '3' }, payload: { name: 'Role Event', eventType: 'social', startTick: '0', participantIds: [entity.id], participants: [{ entityId: entity.id, role: 'hero' }] } });
    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    const duplicate = JSON.parse(exported.body) as { events: Array<{ participantRoles?: Array<{ entityId: string; role: string }> }> };
    const event = duplicate.events[0]!;
    event.participantRoles = [{ entityId: entity.id, role: 'hero' }, { entityId: entity.id, role: 'hero' }];
    const duplicateResponse = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: duplicate });
    expect(duplicateResponse.statusCode).toBe(422);
    expect(duplicateResponse.json().error.message).toContain('duplicate participant roles');
    event.participantRoles = [{ entityId: crypto.randomUUID(), role: 'other' }];
    const mismatchResponse = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: duplicate });
    expect(mismatchResponse.statusCode).toBe(422);
    expect(mismatchResponse.json().error.message).toContain('do not match participantIds');
    await app.close();
  });

  it('imports a bundle into a new world with remapped references', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Source World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const schemaVersion = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types/${type.id}/versions`, headers: { 'if-match': '2' }, payload: { schema: { fields: [{ id: 'role', type: 'text' }] } } });
    expect(schemaVersion.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '3' }, payload: { typeId: type.id, name: 'Imported Character', document: { note: 'portable' } } });
    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    const importPayload = { bundle: JSON.parse(exported.body), name: 'Imported World' };
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/commit', headers: { 'idempotency-key': 'import-source-1' }, payload: importPayload });
    const replay = await app.inject({ method: 'POST', url: '/api/v1/imports/commit', headers: { 'idempotency-key': 'import-source-1' }, payload: importPayload });
    expect(imported.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.world.id).toBe(imported.json().data.world.id);
    expect(imported.json().data.world.name).toBe('Imported World');
    expect(imported.json().data.counts.entities).toBe(1);
    expect(imported.json().data.counts.entityTypeVersions).toBe(1);
    const importedTypes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${imported.json().data.world.id}/entity-types` });
    const importedVersions = await app.inject({ method: 'GET', url: `/api/v1/worlds/${imported.json().data.world.id}/entity-types/${importedTypes.json().data.find((item: { typeKey: string }) => item.typeKey === 'person').id}/versions` });
    expect(importedVersions.json().data.map((item: { schemaVersion: number }) => item.schemaVersion)).toEqual([1, 2]);
    const importedEntities = await app.inject({ method: 'GET', url: `/api/v1/worlds/${imported.json().data.world.id}/entities/${imported.json().data.world.id}` });
    expect(importedEntities.statusCode).toBe(404);
    const importedEntityList = await app.inject({ method: 'GET', url: `/api/v1/worlds/${imported.json().data.world.id}/entities` });
    expect(importedEntityList.json().data[0].schemaVersion).toBe(2);
    await app.close();
  });

  it('remaps event-effect targets and payload references during import', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Effect Source' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'effect-person', label: 'Person' } })).json().data;
    const actor = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Actor' } })).json().data;
    const place = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '3' }, payload: { typeId: type.id, name: 'Place' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/events`, headers: { 'if-match': '4' }, payload: { name: 'Move', eventType: 'move', startTick: '10', participantIds: [actor.id], effects: [{ type: 'MOVE_ENTITY', targetId: actor.id, payload: { locationEntityId: place.id }, sequence: 0 }] } });
    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/commit', payload: { bundle: JSON.parse(exported.body), name: 'Effect Target' } });
    expect(imported.statusCode).toBe(201);
    const importedWorldId = imported.json().data.world.id;
    const entities = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorldId}/entities` })).json().data as Array<{ id: string; name: string }>;
    const event = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorldId}/events` })).json().data[0];
    expect(event.effects[0].targetId).toBe(entities.find((item) => item.name === 'Actor')?.id);
    expect(event.effects[0].payload.locationEntityId).toBe(entities.find((item) => item.name === 'Place')?.id);
    await app.close();
  });

  it('persists import idempotency across API instances', async () => {
    const repo = new InMemoryWorldRepository();
    const payload = { text: 'name,typeId\nAlpha,character', worldName: 'CSV Source', name: 'CSV Restart Target' };
    const first = setupWithRepository(repo);
    const created = await first.inject({ method: 'POST', url: '/api/v1/imports/commit.csv', headers: { 'idempotency-key': 'restart-import-1' }, payload });
    expect(created.statusCode).toBe(201);
    await first.close();
    const restarted = setupWithRepository(repo);
    const replay = await restarted.inject({ method: 'POST', url: '/api/v1/imports/commit.csv', headers: { 'idempotency-key': 'restart-import-1' }, payload });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.world.id).toBe(created.json().data.world.id);
    await restarted.close();
  });

  it('keeps proposal decisions user-owned and rejects only drafts', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Proposal Audit' } })).json().data;
    const forged = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'forged', baseWorldRevision: world.revision, changes: [{ id: 'c1', command: 'noop', userDecision: 'accepted' }] } });
    expect(forged.statusCode).toBe(422);
    const created = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'review', baseWorldRevision: world.revision, changes: [] } });
    const proposalId = created.json().data.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals/${proposalId}/reject` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals/${proposalId}/reject` })).statusCode).toBe(422);
    await app.close();
  });

  it('sanitizes rich document strings on draft create and update', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Safe World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const created = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Safe', document: { text: '<script>alert(1)</script><p>ok</p>' } } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.document.text).not.toContain('<script>');
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/worlds/${world.id}/entities/${created.json().data.id}`, headers: { 'if-match': '3' }, payload: { document: { text: '<img src=x onerror=alert(1)>clean' } } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.document.text).not.toContain('onerror');
    await app.close();
  });

  it('keeps offline AI proposals separate from Canon until explicit acceptance', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Proposal World' } })).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'Suggest a ruler', baseWorldRevision: world.revision } });
    expect(response.statusCode).toBe(202);
    expect(response.json().data.status).toBe('draft');
    expect(response.json().data.unknowns.length).toBeGreaterThan(0);
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals/${response.json().data.id}/accept` });
    expect(accepted.statusCode).toBe(422);
    await app.close();
  });

  it('recovers persisted proposal review state after an API instance restart', async () => {
    const repo = new InMemoryWorldRepository();
    const first = setupWithRepository(repo);
    const world = (await first.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Durable Proposal World' } })).json().data;
    const created = await first.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'Keep this review', baseWorldRevision: world.revision, changes: [{ id: 'change-1', command: 'Unknown', payload: {}, dependsOn: [], evidenceRefs: [], confidence: 0.2, userDecision: 'pending' }] } });
    expect(created.statusCode).toBe(202);
    const proposalId = created.json().data.id as string;
    await first.close();
    const second = setupWithRepository(repo);
    const recovered = await second.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/ai/proposals/${proposalId}` });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().data.request).toBe('Keep this review');
    await second.close();
  });

  it('accepts dependency-ordered Canon changes atomically as one proposal batch', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Batch Proposal World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': world.revision }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Pending Person' } })).json().data;
    const proposal = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'Promote this person', baseWorldRevision: '3', changes: [
      { id: 'to-pending', command: 'SetCanonStatus', payload: { kind: 'entity', id: entity.id, status: 'pending', reason: 'Review complete' }, dependsOn: [], evidenceRefs: [], confidence: 1, userDecision: 'pending' },
      { id: 'to-canon', command: 'SetCanonStatus', payload: { kind: 'entity', id: entity.id, status: 'canon', reason: 'Approved' }, dependsOn: ['to-pending'], evidenceRefs: [], confidence: 1, userDecision: 'pending' },
    ] } });
    expect(proposal.statusCode).toBe(202);
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals/${proposal.json().data.id}/accept` });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.status).toBe('accepted');
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entities/${entity.id}` })).json().data.canonStatus).toBe('canon');
    await app.close();
  });

  it('uses a configured proposal provider without granting it Canon write access', async () => {
    const repo = new InMemoryWorldRepository();
    const service = new WorldApplicationService(repo, { next: () => crypto.randomUUID() }, { now: () => new Date('2026-09-07T00:00:00.000Z') });
    const clock = { now: () => new Date('2026-09-07T00:00:00.000Z') };
    const provider: ProposalProvider = { id: 'fixture-provider', generate: vi.fn(async () => ({ provider: 'fixture-provider', changes: [{ id: 'change-1', command: 'SetCanonStatus', payload: {}, dependsOn: [], evidenceRefs: [], confidence: 0.8, userDecision: 'pending' as const }], citations: [{ id: 'entity-1' }], unknowns: [] })) };
    const app = createApp(service, new TemporalApplicationService(repo, { next: () => crypto.randomUUID() }, clock), new CanonApplicationService(repo, clock, async () => []), undefined, repo, undefined, provider);
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Provider World' } })).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'Suggest a change', baseWorldRevision: world.revision } });
    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({ provider: 'fixture-provider', status: 'draft' });
    expect(provider.generate).toHaveBeenCalledOnce();
    await app.close();
  });

  it('reports missing entity references in offline AI proposals', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Proposal Validation World' } })).json().data;
    const missingEntityId = crypto.randomUUID();
    const created = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals`, payload: { request: 'Create an event', baseWorldRevision: world.revision, changes: [{ id: 'change-1', command: 'CreateEvent', payload: { participantIds: [missingEntityId] } }] } });
    expect(created.statusCode).toBe(202);
    const validated = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/ai/proposals/${created.json().data.id}/validate` });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ ruleCode: 'BROKEN_REFERENCE', relatedIds: [missingEntityId] })]));
    await app.close();
  });

  it('persists immutable calendar versions and converts through a stored version', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Calendar World' } })).json().data;
    const definition = { id: 'imperial', name: 'Imperial', yearZero: 1, daysPerWeek: 7, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], months: [{ id: 'm1', name: 'First', days: 30 }], eras: [{ id: 'era', name: 'Era', abbreviation: 'E', startTick: '0' }] };
    const created = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/calendars`, headers: { 'if-match': world.revision }, payload: { name: 'Imperial', definition } });
    expect(created.statusCode).toBe(201);
    const version = created.json().data.version;
    expect(version.version).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data.defaultCalendarVersionId).toBe(version.id);
    const converted = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/calendars/convert`, payload: { calendarVersionId: version.id, date: { year: 1, month: 1, day: 1 } } });
    expect(converted.statusCode).toBe(200);
    expect(converted.json().data.tick).toBe('0');
    const extreme = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/calendars/convert`, payload: { calendarVersionId: version.id, tick: '9223372036854775807' } });
    expect(extreme.statusCode).toBe(422);
    const nextDefinition = { ...definition, name: 'Imperial v2', months: [{ id: 'm1', name: 'First', days: 31 }] };
    const next = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/calendars/${created.json().data.calendar.id}/versions`, headers: { 'if-match': String(Number(world.revision) + 1) }, payload: { definition: nextDefinition } });
    expect(next.statusCode).toBe(201);
    expect(next.json().data.version).toBe(2);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/calendars/${created.json().data.calendar.id}/versions` })).json().data).toHaveLength(2);
    const second = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/calendars`, headers: { 'if-match': '3' }, payload: { name: 'Solar', definition: { ...definition, id: 'solar', name: 'Solar' } } });
    expect(second.statusCode).toBe(201);
    const secondVersion = second.json().data.version;
    const switched = await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/calendars/${second.json().data.calendar.id}/versions/${secondVersion.id}/default`, headers: { 'if-match': '4' } });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().data.defaultCalendarVersionId).toBe(secondVersion.id);
    const archive = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.zip` });
    expect(archive.statusCode).toBe(200);
    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/commit.zip', headers: { 'content-type': 'application/zip', 'idempotency-key': 'calendar-import-1' }, payload: archive.rawPayload });
    expect(imported.statusCode).toBe(201);
    const importedWorld = imported.json().data.world;
    const importedCalendars = await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorld.id}/calendars` });
    expect(importedCalendars.statusCode).toBe(200);
    expect(importedCalendars.json().data).toHaveLength(2);
    const importedVersions = await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorld.id}/calendars/${importedCalendars.json().data.find((item: { name: string }) => item.name === 'Imperial').id}/versions` });
    expect(importedVersions.json().data).toHaveLength(2);
    const importedSolar = importedCalendars.json().data.find((item: { name: string }) => item.name === 'Solar');
    const importedSolarVersions = await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorld.id}/calendars/${importedSolar.id}/versions` });
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/${importedWorld.id}` })).json().data.defaultCalendarVersionId).toBe(importedSolarVersions.json().data[0].id);
    await app.close();
  });

  it('returns validation error for malformed CSV import', async () => {
    const app = setup();
    const result = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect.csv', payload: { text: 'name,description\nAlpha,First' } });
    expect(result.statusCode).toBe(422);
    expect(result.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('allows health check without token when token is configured', async () => {
    const originalToken = process.env.WORLD_CODEX_API_TOKEN;
    process.env.WORLD_CODEX_API_TOKEN = 'secret-test-token';
    try {
      const app = setup();
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      const denied = await app.inject({ method: 'GET', url: '/api/v1/worlds' });
      expect(denied.statusCode).toBe(401);
      const authorized = await app.inject({ method: 'GET', url: '/api/v1/worlds', headers: { authorization: 'Bearer secret-test-token' } });
      expect(authorized.statusCode).toBe(200);
      await app.close();
    } finally {
      if (originalToken === undefined) delete process.env.WORLD_CODEX_API_TOKEN;
      else process.env.WORLD_CODEX_API_TOKEN = originalToken;
    }
  });

  it('supports canonStatus filtering on timeline query', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Timeline World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': '1' }, payload: { typeKey: 'person', label: 'Person' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'Hero' } })).json().data;
    const fact = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': '3' },
      payload: { subjectEntityId: entity.id, predicateKey: 'state', objectKind: 'scalar', value: 'peace', validFromTick: '0', validToTick: '100', sourceKind: 'manual' },
    });
    expect(fact.statusCode).toBe(201);
    const factId = fact.json().data.id;
    // Transition fact: draft -> pending -> canon -> retconned
    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`,
      headers: { 'if-match': '4' },
      payload: { status: 'pending', reason: 'Review fact' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`,
      headers: { 'if-match': '5' },
      payload: { status: 'canon', reason: 'Approve fact' },
    });
    const retcon = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`,
      headers: { 'if-match': '6' },
      payload: { status: 'retconned', reason: 'Erased from history' },
    });
    expect(retcon.statusCode).toBe(200);

    const defaultTimeline = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/timeline?fromTick=0&toTick=50` });
    expect(defaultTimeline.statusCode).toBe(200);
    expect(defaultTimeline.json().data.facts).toHaveLength(0);

    const allTimeline = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/timeline?fromTick=0&toTick=50&canonStatus=all` });
    expect(allTimeline.statusCode).toBe(200);
    expect(allTimeline.json().data.facts).toHaveLength(1);

    const invalidStatus = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/timeline?fromTick=0&toTick=50&canonStatus=invalid` });
    expect(invalidStatus.statusCode).toBe(422);

    await app.close();
  });

  it('cleans up inflight idempotency entry when request fails validation', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Idempotent Error World' } })).json().data;
    const fail = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types`,
      headers: { 'if-match': '1', 'idempotency-key': 'fail-key-1234' },
      payload: { typeKey: '', label: '' },
    });
    expect(fail.statusCode).toBe(422);

    const succeed = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types`,
      headers: { 'if-match': '1', 'idempotency-key': 'fail-key-1234' },
      payload: { typeKey: 'valid_type', label: 'Valid' },
    });
    expect(succeed.statusCode).toBe(201);
    await app.close();
  });

  it('bounds in-memory proposals cache when no store is configured', async () => {
    const repo = new InMemoryWorldRepository();
    const service = new WorldApplicationService(repo, { next: () => crypto.randomUUID() }, { now: () => new Date('2026-09-07T00:00:00.000Z') });
    const clock = { now: () => new Date('2026-09-07T00:00:00.000Z') };
    const app = createApp(service, new TemporalApplicationService(repo, { next: () => crypto.randomUUID() }, clock), new CanonApplicationService(repo, clock, async () => []), undefined, repo);
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Proposal Bound World' } })).json().data;

    let firstProposalId = '';
    for (let i = 0; i < 505; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/worlds/${world.id}/ai/proposals`,
        payload: { request: `Proposal ${i}`, baseWorldRevision: '1' },
      });
      expect(res.statusCode).toBe(202);
      if (i === 0) firstProposalId = res.json().data.id;
    }

    const checkFirst = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/ai/proposals/${firstProposalId}` });
    expect(checkFirst.statusCode).toBe(404);
    await app.close();
  });

  it('manages timeline branches for a world', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Branch World' } })).json().data;

    const listRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/branches` });
    expect(listRes.statusCode).toBe(200);
    const branches = listRes.json().data;
    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe('main');
    expect(branches[0].status).toBe('main');

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/branches`,
      headers: { 'if-match': '1' },
      payload: {
        name: 'what-if-timeline',
        status: 'sandbox',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const newBranch = createRes.json().data;
    expect(newBranch.name).toBe('what-if-timeline');
    expect(newBranch.status).toBe('sandbox');

    const listAgain = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/branches` });
    expect(listAgain.statusCode).toBe(200);
    expect(listAgain.json().data).toHaveLength(2);

    await app.close();
  });

  it('computes bitemporal snapshots filtering by tick, revision, and branch', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Bitemporal World' } })).json().data;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': '1' }, payload: { typeKey: 'city', label: 'City' } })).json().data;
    const entity = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '2' }, payload: { typeId: type.id, name: 'ChangAn' } })).json().data;

    // Promote entity to Canon so it is visible in snapshots
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '3' }, payload: { status: 'pending', reason: 'Review entity' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${entity.id}`, headers: { 'if-match': '4' }, payload: { status: 'canon', reason: 'Approve entity' } });

    // Fact 1: valid from tick 0 to 100, created at revision 6
    const f1 = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': '5' },
      payload: { subjectEntityId: entity.id, predicateKey: 'population', objectKind: 'scalar', value: '1000000', validFromTick: '0', validToTick: '100', sourceKind: 'manual' },
    });
    expect(f1.statusCode).toBe(201);
    const factId = f1.json().data.id;

    // Promote Fact 1 to Canon (revisions 7 and 8)
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`, headers: { 'if-match': '6' }, payload: { status: 'pending', reason: 'Review fact' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`, headers: { 'if-match': '7' }, payload: { status: 'canon', reason: 'Approve fact' } });

    // Snapshot at tick 50 without asOfRevision -> contains Fact 1
    const snap1 = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=50` });
    expect(snap1.statusCode).toBe(200);
    expect(snap1.json().data.facts).toHaveLength(1);
    expect(snap1.json().data.facts[0].id).toBe(factId);

    // Retcon Fact 1 at revision 9
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`, headers: { 'if-match': '8' }, payload: { status: 'retconned', reason: 'Retcon fact' } });

    // Snapshot at tick 50 with latest state -> fact is retconned so 0 facts
    const snapLatest = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=50` });
    expect(snapLatest.statusCode).toBe(200);
    expect(snapLatest.json().data.facts).toHaveLength(0);

    // Snapshot at tick 50 asOfRevision 8 (before retcon) -> fact is visible in historical slice!
    const snapHistorical = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/snapshot?atTick=50&asOfRevision=8` });
    expect(snapHistorical.statusCode).toBe(200);
    expect(snapHistorical.json().data.asOfRevision).toBe('8');
    expect(snapHistorical.json().data.facts).toHaveLength(1);
    expect(snapHistorical.json().data.facts[0].id).toBe(factId);

    await app.close();
  });

  it('supports Epic 2 knowledge & claims: objective truth vs official assertion vs character knowledge', async () => {
    const app = setup();
    // 1. Create world
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Claims World' } })).json().data;

    // 2. Create entity types (character, organization)
    const charType = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': '1' }, payload: { typeKey: 'character', label: 'Character' } })).json().data;
    const orgType = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': '2' }, payload: { typeKey: 'organization', label: 'Organization' } })).json().data;

    // 3. Create entities: Emperor, Imperial Government, Character A, Character B
    const emperor = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '3' }, payload: { typeId: charType.id, name: 'Emperor' } })).json().data;
    const gov = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '4' }, payload: { typeId: orgType.id, name: 'Imperial Government' } })).json().data;
    const charA = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '5' }, payload: { typeId: charType.id, name: 'Character A' } })).json().data;
    const charB = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': '6' }, payload: { typeId: charType.id, name: 'Character B' } })).json().data;

    // 4. Objective Truth (Fact): Emperor death_cause = poison
    const factRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': '7' },
      payload: {
        subjectEntityId: emperor.id,
        predicateKey: 'death_cause',
        objectKind: 'scalar',
        value: 'poison',
        sourceKind: 'manual',
      },
    });
    expect(factRes.statusCode).toBe(201);
    const factId = factRes.json().data.id;
    // Canonize Fact: draft -> pending -> canon
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`, headers: { 'if-match': '8' }, payload: { status: 'pending', reason: 'Review truth' } });
    const canonFact = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${factId}`, headers: { 'if-match': '9' }, payload: { status: 'canon', reason: 'Approve truth' } })).json().data;
    expect(canonFact.canonStatus).toBe('canon');

    // 5. Official Record (Claim 1): death_cause = illness, assertedBy = Imperial Government, claimKind = official_record, truthStatus = false, knownBy = [charA.id]
    const claim1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/claims`,
      headers: { 'if-match': '10' },
      payload: {
        subjectEntityId: emperor.id,
        predicateKey: 'death_cause',
        objectKind: 'scalar',
        value: 'illness',
        assertedByEntityId: gov.id,
        knownByEntityIds: [charA.id],
        claimKind: 'official_record',
        truthStatus: 'false',
        confidence: 0.9,
        sourceRefs: ['Imperial Decree #101'],
      },
    });
    expect(claim1Res.statusCode).toBe(201);
    const claim1 = claim1Res.json().data;
    expect(claim1.canonStatus).toBe('draft');
    expect(claim1.truthStatus).toBe('false');
    expect(claim1.claimKind).toBe('official_record');
    expect(claim1.assertedByEntityId).toBe(gov.id);
    expect(claim1.knownByEntityIds).toContain(charA.id);

    // Canonize Claim 1: draft -> pending -> canon (The official record itself is canonical even if truthStatus is false)
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/claim/${claim1.id}`, headers: { 'if-match': '11' }, payload: { status: 'pending', reason: 'Review official announcement' } });
    const canonClaim1 = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/claim/${claim1.id}`, headers: { 'if-match': '12' }, payload: { status: 'canon', reason: 'Approve official announcement into canon' } })).json().data;
    expect(canonClaim1.canonStatus).toBe('canon');

    // 6. Character B Secret Testimony (Claim 2): death_cause = poison, assertedBy = Physician B, claimKind = testimony, truthStatus = true, knownBy = [charB.id]
    const claim2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/claims`,
      headers: { 'if-match': '13' },
      payload: {
        subjectEntityId: emperor.id,
        predicateKey: 'death_cause',
        objectKind: 'scalar',
        value: 'poison',
        assertedByEntityId: charB.id,
        knownByEntityIds: [charB.id],
        claimKind: 'testimony',
        truthStatus: 'true',
        confidence: 1.0,
        sourceRefs: ['Physician Private Diary'],
      },
    });
    expect(claim2Res.statusCode).toBe(201);
    const claim2 = claim2Res.json().data;

    // Canonize Claim 2 as well
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/claim/${claim2.id}`, headers: { 'if-match': '14' }, payload: { status: 'pending', reason: 'Review testimony' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/claim/${claim2.id}`, headers: { 'if-match': '15' }, payload: { status: 'canon', reason: 'Approve testimony' } });

    // 7. Verify coexistence:
    // A) Objective truth exists and is poison
    const factsList = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/facts` });
    expect(factsList.statusCode).toBe(200);
    const deathFact = factsList.json().data.find((f: { predicateKey: string }) => f.predicateKey === 'death_cause');
    expect(deathFact.value).toBe('poison');
    expect(deathFact.canonStatus).toBe('canon');

    // B) Query claims by subject (Emperor) -> returns both official_record (illness) and testimony (poison)
    const emperorClaims = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/claims?subjectEntityId=${emperor.id}` });
    expect(emperorClaims.statusCode).toBe(200);
    expect(emperorClaims.json().data).toHaveLength(2);

    // C) Filter claims by truthStatus = false -> only official record
    const falseClaims = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/claims?truthStatus=false` });
    expect(falseClaims.statusCode).toBe(200);
    expect(falseClaims.json().data).toHaveLength(1);
    expect(falseClaims.json().data[0].value).toBe('illness');
    expect(falseClaims.json().data[0].assertedByEntityId).toBe(gov.id);

    // D) Filter claims by assertedBy = Imperial Government
    const govClaims = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/claims?assertedByEntityId=${gov.id}` });
    expect(govClaims.statusCode).toBe(200);
    expect(govClaims.json().data).toHaveLength(1);
    expect(govClaims.json().data[0].claimKind).toBe('official_record');

    // E) Query single claim by ID
    const singleClaim = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/claims/${claim1.id}` });
    expect(singleClaim.statusCode).toBe(200);
    expect(singleClaim.json().data.id).toBe(claim1.id);
    expect(singleClaim.json().data.sourceRefs).toContain('Imperial Decree #101');

    await app.close();
  });

  it('manages validation rules through CRUD and optimistic locking', async () => {
    const app = setupWithValidator();
    const worldRes = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Rule World' } });
    expect(worldRes.statusCode).toBe(201);
    const world = worldRes.json().data;

    // 1. Create validation rule
    const rulePayload = {
      name: 'Mortal Lifespan Cap',
      description: 'Mortals cannot live beyond 180 years',
      severity: 'error',
      target: 'entity',
      when: { fact: 'species', equals: 'mortal' },
      assert: { duration_between: { from: 'birth', to: 'death', lte: 180 } },
      message: 'Mortals cannot live beyond 180 years',
    };
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/rules`,
      headers: { 'if-match': world.revision },
      payload: rulePayload,
    });
    expect(createRes.statusCode).toBe(201);
    const rule = createRes.json().data;
    expect(rule.name).toBe('Mortal Lifespan Cap');
    expect(rule.enabled).toBe(true);
    expect(rule.target).toBe('entity');

    // 2. List rules
    const listRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/rules` });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);
    expect(listRes.json().data[0].id).toBe(rule.id);

    // 3. Get rule
    const getRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/rules/${rule.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.name).toBe('Mortal Lifespan Cap');

    // 4. Concurrency check on update
    const staleUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/worlds/${world.id}/rules/${rule.id}`,
      headers: { 'if-match': '1' },
      payload: { enabled: false },
    });
    expect(staleUpdate.statusCode).toBe(409);

    // 5. Successful update
    const currentWorld = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data;
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/worlds/${world.id}/rules/${rule.id}`,
      headers: { 'if-match': currentWorld.revision },
      payload: { enabled: false, message: 'Updated mortal lifespan rule' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.enabled).toBe(false);
    expect(updateRes.json().data.message).toBe('Updated mortal lifespan rule');

    // 6. Delete rule
    const afterUpdateWorld = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data;
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/worlds/${world.id}/rules/${rule.id}`,
      headers: { 'if-match': afterUpdateWorld.revision },
    });
    expect(deleteRes.statusCode).toBe(204);

    // 7. Verify deletion
    const afterDeleteGet = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/rules/${rule.id}` });
    expect(afterDeleteGet.statusCode).toBe(404);

    await app.close();
  });

  it('tests rules via rule test runner without persisting and evaluates custom rules in world validation', async () => {
    const app = setupWithValidator();
    const worldRes = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'DSL Validation World' } });
    const world = worldRes.json().data;
    const getRev = async () => (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data.revision;

    // Get character entity type
    const typesRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entity-types` });
    const characterType = typesRes.json().data.find((t: { typeKey: string }) => t.typeKey === 'character') ?? typesRes.json().data[0];

    // Create 3 entities:
    // Entity 1: Alice (mortal, lifespan 80 years: 100 -> 180)
    const aliceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { name: 'Alice', typeId: characterType.id, document: { species: 'mortal' } },
    });
    const alice = aliceRes.json().data;

    // Add birth/death facts for Alice
    const aBirth = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: alice.id, predicateKey: 'birth', objectKind: 'scalar', value: 100 },
    })).json().data;
    const aDeath = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: alice.id, predicateKey: 'death', objectKind: 'scalar', value: 180 },
    })).json().data;

    // Entity 2: Bob (mortal, lifespan 200 years: 100 -> 300) -> violates 180 limit!
    const bobRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { name: 'Bob', typeId: characterType.id, document: { species: 'mortal' } },
    });
    const bob = bobRes.json().data;

    const bBirth = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: bob.id, predicateKey: 'birth', objectKind: 'scalar', value: 100 },
    })).json().data;
    const bDeath = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: bob.id, predicateKey: 'death', objectKind: 'scalar', value: 300 },
    })).json().data;

    // Entity 3: Legolas (elf, lifespan 900 years: 100 -> 1000) -> not mortal, passes!
    const elfRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { name: 'Legolas', typeId: characterType.id, document: { species: 'elf' } },
    });
    const elf = elfRes.json().data;

    const eBirth = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: elf.id, predicateKey: 'birth', objectKind: 'scalar', value: 100 },
    })).json().data;
    const eDeath = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: elf.id, predicateKey: 'death', objectKind: 'scalar', value: 1000 },
    })).json().data;

    // 1. Run Rule Test Runner WITHOUT persisting rule (with includeDrafts: true)
    const testRunnerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/rules/test`,
      payload: {
        name: 'Mortal Max Age',
        target: 'entity',
        when: { field: 'species', equals: 'mortal' },
        assert: { duration_between: { from: 'birth', to: 'death', lte: 180 } },
        message: 'Mortals cannot live beyond 180 years',
        includeDrafts: true,
      },
    });
    expect(testRunnerRes.statusCode).toBe(200);
    const testResult = testRunnerRes.json().data;
    expect(testResult.pass).toBe(false);
    expect(testResult.issues).toHaveLength(1);
    expect(testResult.issues[0].subjectId).toBe(bob.id);
    expect(testResult.issues[0].message).toBe('Mortals cannot live beyond 180 years');

    // Verify that when includeDrafts is false, draft entities are not evaluated
    const testRunnerCanonOnlyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/rules/test`,
      payload: {
        name: 'Mortal Max Age',
        target: 'entity',
        when: { field: 'species', equals: 'mortal' },
        assert: { duration_between: { from: 'birth', to: 'death', lte: 180 } },
        message: 'Mortals cannot live beyond 180 years',
        includeDrafts: false,
      },
    });
    expect(testRunnerCanonOnlyRes.json().data.pass).toBe(true);

    // Check that no rule was actually persisted
    const rulesList = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/rules` });
    expect(rulesList.json().data).toHaveLength(0);

    // Promote Alice, Bob, Elf and their facts to Canon (pending -> canon)
    for (const id of [alice.id, bob.id, elf.id]) {
      await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${id}`, headers: { 'if-match': await getRev() }, payload: { status: 'pending', reason: 'Review' } });
      await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${id}`, headers: { 'if-match': await getRev() }, payload: { status: 'canon', reason: 'Approve' } });
    }
    for (const f of [aBirth, aDeath, bBirth, bDeath, eBirth, eDeath]) {
      await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${f.id}`, headers: { 'if-match': await getRev() }, payload: { status: 'pending', reason: 'Review' } });
      await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/fact/${f.id}`, headers: { 'if-match': await getRev() }, payload: { status: 'canon', reason: 'Approve' } });
    }

    // Baseline world validation should pass (no custom rules yet)
    const baseValidation = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/validation` });
    expect(baseValidation.statusCode).toBe(200);
    expect(baseValidation.json().data.issues).toHaveLength(0);

    // 2. Persist the rule into the world
    const createRuleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/rules`,
      headers: { 'if-match': await getRev() },
      payload: {
        name: 'Mortal Max Age',
        description: 'Enforce maximum mortal lifespan of 180',
        severity: 'error',
        target: 'entity',
        when: { field: 'species', equals: 'mortal' },
        assert: { duration_between: { from: 'birth', to: 'death', lte: 180 } },
        message: 'Mortals cannot live beyond 180 years',
        enabled: true,
      },
    });
    expect(createRuleRes.statusCode).toBe(201);
    const persistedRule = createRuleRes.json().data;

    // 3. World validation should now FAIL for Bob!
    const validatedWithRule = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/validation` });
    expect(validatedWithRule.statusCode).toBe(200);
    const ruleIssues = validatedWithRule.json().data.issues;
    expect(ruleIssues).toHaveLength(1);
    expect(ruleIssues[0].subjectId).toBe(bob.id);
    expect(ruleIssues[0].message).toBe('Mortals cannot live beyond 180 years');

    // 4. Search finds the rule
    const searchRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/search?q=mortal` });
    expect(searchRes.statusCode).toBe(200);
    const ruleSearchResult = searchRes.json().data.find((item: { kind: string }) => item.kind === 'rule');
    expect(ruleSearchResult).toBeDefined();
    expect(ruleSearchResult.title).toBe('Mortal Max Age');

    // 5. Disable the rule
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/worlds/${world.id}/rules/${persistedRule.id}`,
      headers: { 'if-match': await getRev() },
      payload: { enabled: false },
    });

    // 6. World validation should pass again!
    const revalidated = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/validation` });
    expect(revalidated.statusCode).toBe(200);
    expect(revalidated.json().data.issues).toHaveLength(0);

    await app.close();
  });

  it('implements Epic 4: Narrative scenes, scene snapshots, and continuity review (chapter defense against plot holes)', async () => {
    const app = setup();
    const createWorldRes = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Narrative Kingdom' } });
    const world = createWorldRes.json().data;
    const getRev = async (): Promise<string> => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` });
      return String(res.json().data.revision);
    };

    // 1. Create Work
    const workRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/works`,
      headers: { 'if-match': await getRev() },
      payload: { title: 'Chronicles of Valoria', type: 'novel', description: 'Epic fantasy saga' },
    });
    expect(workRes.statusCode).toBe(201);
    const work = workRes.json().data;
    expect(work.title).toBe('Chronicles of Valoria');
    expect(work.type).toBe('novel');

    // List & Get Work
    const listWorksRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/works` });
    expect(listWorksRes.statusCode).toBe(200);
    expect(listWorksRes.json().data).toHaveLength(1);

    const getWorkRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/works/${work.id}` });
    expect(getWorkRes.statusCode).toBe(200);
    expect(getWorkRes.json().data.id).toBe(work.id);

    // 2. Create Chapter
    const chapterRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/works/${work.id}/chapters`,
      headers: { 'if-match': await getRev() },
      payload: { title: 'Chapter 1: The Council', orderIndex: 1, description: 'Council meets' },
    });
    expect(chapterRes.statusCode).toBe(201);
    const chapter = chapterRes.json().data;
    expect(chapter.workId).toBe(work.id);
    expect(chapter.title).toBe('Chapter 1: The Council');

    // 3. Setup World Entities, Facts, and Claims
    // Types
    const charTypeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types`,
      headers: { 'if-match': await getRev() },
      payload: { typeKey: 'character', label: 'Character' },
    });
    const charType = charTypeRes.json().data;

    const locTypeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types`,
      headers: { 'if-match': await getRev() },
      payload: { typeKey: 'location', label: 'Location' },
    });
    const locType = locTypeRes.json().data;

    // Characters: Duncan (born 100, died 500), Malcolm (born 300)
    const duncanRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { typeId: charType.id, name: 'King Duncan' },
    });
    const duncan = duncanRes.json().data;

    const malcolmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { typeId: charType.id, name: 'Prince Malcolm' },
    });
    const malcolm = malcolmRes.json().data;

    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${duncan.id}`, headers: { 'if-match': await getRev() }, payload: { status: 'pending', reason: 'Review Duncan' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${duncan.id}`, headers: { 'if-match': await getRev() }, payload: { status: 'canon', reason: 'Approve Duncan' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${malcolm.id}`, headers: { 'if-match': await getRev() }, payload: { status: 'pending', reason: 'Review Malcolm' } });
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/canon/entity/${malcolm.id}`, headers: { 'if-match': await getRev() }, payload: { status: 'canon', reason: 'Approve Malcolm' } });

    // Locations: Dunsinane Castle, Inverness
    const dunsinaneRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { typeId: locType.id, name: 'Dunsinane Castle' },
    });
    const dunsinane = dunsinaneRes.json().data;

    const invernessRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { typeId: locType.id, name: 'Inverness Castle' },
    });
    const inverness = invernessRes.json().data;

    // Duncan's Birth & Death Facts
    const f1 = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: duncan.id, predicateKey: 'birth', objectKind: 'scalar', value: '100', validFromTick: '100' },
    });
    expect(f1.statusCode).toBe(201);
    const f2 = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: duncan.id, predicateKey: 'death', objectKind: 'scalar', value: '500', validFromTick: '500' },
    });
    expect(f2.statusCode).toBe(201);

    // Malcolm's Birth & Location Facts
    const f3 = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: malcolm.id, predicateKey: 'birth', objectKind: 'scalar', value: '300', validFromTick: '300' },
    });
    expect(f3.statusCode).toBe(201);
    const f4 = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: malcolm.id, predicateKey: 'location', objectKind: 'entity', objectEntityId: dunsinane.id, validFromTick: '400', validToTick: '600' },
    });
    expect(f4.statusCode).toBe(201);

    // Confidential Claim known ONLY to Duncan
    const c1 = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/claims`,
      headers: { 'if-match': await getRev() },
      payload: {
        predicateKey: 'royal_lineage_curse',
        claimKind: 'secret',
        truthStatus: 'true',
        objectKind: 'scalar',
        value: 'Duncan was not the rightful heir',
        knownByEntityIds: [duncan.id],
      },
    });
    expect(c1.statusCode).toBe(201);

    // 4. Create Scene 1: Valid Scene (Tick 450)
    const scene1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'The Council Gathers',
        orderIndex: 1,
        sceneTick: '450',
        povCharacterId: duncan.id,
        locationEntityId: dunsinane.id,
        participantEntityIds: [malcolm.id],
        proseText: 'Duncan and Malcolm discussed the defenses of the realm peacefully.',
        status: 'draft',
      },
    });
    expect(scene1Res.statusCode).toBe(201);
    const scene1 = scene1Res.json().data;
    expect(scene1.sceneTick).toBe('450');

    // Review Scene 1: Must pass!
    const review1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/scenes/${scene1.id}/continuity-review`,
    });
    expect(review1Res.statusCode).toBe(200);
    expect(review1Res.json().data.pass).toBe(true);
    expect(review1Res.json().data.issues).toHaveLength(0);

    // Scene Snapshot on Scene 1
    const snapRes = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/scenes/${scene1.id}/snapshot`,
    });
    expect(snapRes.statusCode).toBe(200);
    expect(snapRes.json().atTick).toBe('450');
    expect(snapRes.json().data.entities.length).toBeGreaterThanOrEqual(2);

    // 5. Scene 2: Dead Character Appearance (Tick 550, Duncan died at 500)
    const scene2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'Impossible Council',
        orderIndex: 2,
        sceneTick: '550',
        participantEntityIds: [duncan.id, malcolm.id],
        proseText: 'Duncan smiled and poured some wine.',
      },
    });
    expect(scene2Res.statusCode).toBe(201);
    const scene2 = scene2Res.json().data;

    // Review Scene 2: Must fail with DECEASED_CHARACTER
    const review2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/scenes/${scene2.id}/continuity-review`,
    });
    expect(review2Res.statusCode).toBe(200);
    const result2 = review2Res.json().data;
    expect(result2.pass).toBe(false);
    const deceasedIssue = result2.issues.find((i: { code: string }) => i.code === 'DECEASED_CHARACTER');
    expect(deceasedIssue).toBeDefined();
    expect(deceasedIssue.severity).toBe('blocker');
    expect(deceasedIssue.subjectId).toBe(duncan.id);

    // 6. Scene 3: Unborn Character Appearance (Tick 200, Malcolm born at 300)
    const scene3Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'Too Early Meeting',
        orderIndex: 3,
        sceneTick: '200',
        participantEntityIds: [malcolm.id],
        proseText: 'Malcolm was laughing in the garden.',
      },
    });
    expect(scene3Res.statusCode).toBe(201);
    const scene3 = scene3Res.json().data;

    // Review Scene 3: Must fail with UNBORN_CHARACTER
    const review3Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/scenes/${scene3.id}/continuity-review`,
    });
    expect(review3Res.statusCode).toBe(200);
    const result3 = review3Res.json().data;
    expect(result3.pass).toBe(false);
    const unbornIssue = result3.issues.find((i: { code: string }) => i.code === 'UNBORN_CHARACTER');
    expect(unbornIssue).toBeDefined();
    expect(unbornIssue.severity).toBe('blocker');
    expect(unbornIssue.subjectId).toBe(malcolm.id);

    // 7. Scene 4: Location Conflict (Tick 450, Malcolm recorded at Dunsinane, scene set at Inverness)
    const scene4Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'Secret Meeting at Inverness',
        orderIndex: 4,
        sceneTick: '450',
        locationEntityId: inverness.id,
        participantEntityIds: [malcolm.id],
        proseText: 'Malcolm wandered the halls of Inverness.',
      },
    });
    expect(scene4Res.statusCode).toBe(201);
    const scene4 = scene4Res.json().data;

    // Review Scene 4: Warning for LOCATION_CONFLICT
    const review4Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/scenes/${scene4.id}/continuity-review`,
    });
    expect(review4Res.statusCode).toBe(200);
    const result4 = review4Res.json().data;
    const locIssue = result4.issues.find((i: { code: string }) => i.code === 'LOCATION_CONFLICT');
    expect(locIssue).toBeDefined();
    expect(locIssue.severity).toBe('warning');

    // 8. Scene 5: Premature Knowledge Leak (POV Malcolm references secret claim royal_lineage_curse)
    const scene5Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'Internal Monologue',
        orderIndex: 5,
        sceneTick: '450',
        povCharacterId: malcolm.id,
        proseText: 'Malcolm wondered about the royal_lineage_curse that Duncan had hidden.',
      },
    });
    expect(scene5Res.statusCode).toBe(201);
    const scene5 = scene5Res.json().data;

    // Review Scene 5: Warning for PREMATURE_KNOWLEDGE
    const review5Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/scenes/${scene5.id}/continuity-review`,
    });
    expect(review5Res.statusCode).toBe(200);
    const result5 = review5Res.json().data;
    const secretIssue = result5.issues.find((i: { code: string }) => i.code === 'PREMATURE_KNOWLEDGE');
    expect(secretIssue).toBeDefined();
    expect(secretIssue.severity).toBe('warning');

    // 9. Search finds works and scenes
    const searchRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/search?q=Valoria` });
    expect(searchRes.statusCode).toBe(200);
    const workSearchItem = searchRes.json().data.find((item: { kind: string }) => item.kind === 'work');
    expect(workSearchItem).toBeDefined();
    expect(workSearchItem.title).toBe('Chronicles of Valoria');

    const searchSceneRes = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/search?q=defenses` });
    expect(searchSceneRes.statusCode).toBe(200);
    const sceneSearchItem = searchSceneRes.json().data.find((item: { kind: string }) => item.kind === 'scene');
    expect(sceneSearchItem).toBeDefined();
    expect(sceneSearchItem.title).toBe('The Council Gathers');

    // 10. Cascade Deletions
    const deleteChapterRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}`,
      headers: { 'if-match': await getRev() },
    });
    expect(deleteChapterRes.statusCode).toBe(204);

    const getDeletedScene = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/scenes/${scene1.id}` });
    expect(getDeletedScene.statusCode).toBe(404);

    await app.close();
  });

  it('runs incremental validation via POST /api/v1/worlds/:worldId/validation/incremental and skips unrelated rules', async () => {
    const app = setupWithValidator();
    const createWorld = await app.inject({
      method: 'POST',
      url: '/api/v1/worlds',
      payload: { name: 'Incremental World', slug: 'incremental-world', description: 'Test', genre: 'fantasy', canonStrategy: 'strict' },
    });
    const world = createWorld.json().data;
    const getRev = async (): Promise<string> => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` });
      return String(res.json().data.revision);
    };

    const createType = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types`,
      headers: { 'if-match': await getRev() },
      payload: { typeKey: 'character', label: 'Character', schema: {} },
    });
    const type = createType.json().data;

    const createAlice = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities`,
      headers: { 'if-match': await getRev() },
      payload: { typeId: type.id, name: 'Alice', subtitle: '', document: {}, documentText: '', tags: [] },
    });
    const alice = createAlice.json().data;

    // Add birth at 100 and death at 80 for Alice
    const f1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: alice.id, predicateKey: 'birth_tick', objectKind: 'scalar', value: '100' },
    });
    const f1 = f1Res.json().data;

    const f2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/facts`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: alice.id, predicateKey: 'death_tick', objectKind: 'scalar', value: '80' },
    });
    const f2 = f2Res.json().data;

    // Add an event at tick 50 with Alice as participant
    const evtRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/events`,
      headers: { 'if-match': await getRev() },
      payload: { name: 'Early Battle', eventType: 'battle', startTick: '50', participantIds: [alice.id], locationEntityIds: [], causeEventIds: [], resultEventIds: [], effects: [], description: '' },
    });
    const evt = evtRes.json().data;

    // Promote entity, facts, and event to pending so they are evaluated in canon validation
    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/entity/${alice.id}`,
      headers: { 'if-match': await getRev() },
      payload: {
        status: 'pending',
        reason: 'Move to pending',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/fact/${f1.id}`,
      headers: { 'if-match': await getRev() },
      payload: {
        status: 'pending',
        reason: 'Move to pending',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/fact/${f2.id}`,
      headers: { 'if-match': await getRev() },
      payload: {
        status: 'pending',
        reason: 'Move to pending',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/canon/event/${evt.id}`,
      headers: { 'if-match': await getRev() },
      payload: {
        status: 'pending',
        reason: 'Move to pending',
      },
    });

    // Call incremental validation for Alice's birth_tick change
    const incRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/validation/incremental`,
      payload: {
        changeSet: {
          entityIds: [alice.id],
          predicates: ['birth_tick'],
        },
      },
    });
    expect(incRes.statusCode).toBe(200);
    const incBody = incRes.json().data;
    expect(incBody.isIncremental).toBe(true);

    const issueCodes = incBody.issues.map((i: { ruleCode: string }) => i.ruleCode);
    expect(issueCodes).toContain('BIRTH_AFTER_DEATH');
    expect(issueCodes).toContain('EVENT_BEFORE_BIRTH');

    // Verify unrelated rules are reported as skipped
    expect(incBody.skippedRuleCodes).toContain('LOCATION_CONFLICT');
    expect(incBody.skippedRuleCodes).toContain('ASYMMETRIC_RELATION');
    expect(incBody.skippedRuleCodes).toContain('INVALID_RELATION');

    // Call full validation and verify Alice's issue parity
    const fullRes = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/validation`,
    });
    expect(fullRes.statusCode).toBe(200);
    const fullIssues = fullRes.json().data.issues;
    const fullAliceIssues = fullIssues.filter((i: { subjectId: string }) => i.subjectId === alice.id);
    const incAliceIssues = incBody.issues.filter((i: { subjectId: string }) => i.subjectId === alice.id);

    expect(incAliceIssues.map((i: { ruleCode: string }) => i.ruleCode).sort()).toEqual(
      fullAliceIssues.map((i: { ruleCode: string }) => i.ruleCode).sort()
    );

    await app.close();
  });

  it('supports Epic 6 event causality graph, temporal expressions, and causality lineage queries', async () => {
    const app = setupWithValidator();
    const created = await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Causality World' } });
    const world = created.json().data;

    const getRev = async (): Promise<string> => (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data.revision;

    // 1. Create root event E1 at startTick 100 with span precision
    const ev1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/events`,
      headers: { 'if-match': await getRev() },
      payload: {
        name: 'Fall of Ancient Empire',
        eventType: 'historical',
        startTick: '100',
        temporalExpression: {
          kind: 'point',
          precision: 'decade',
          displayLabel: '第一纪元末期',
        },
      },
    });
    expect(ev1Res.statusCode).toBe(201);
    const ev1 = ev1Res.json().data;
    expect(ev1.temporalExpression?.precision).toBe('decade');
    expect(ev1.temporalExpression?.displayLabel).toBe('第一纪元末期');

    // 2. Create relative event E2 ("50 ticks after E1") caused by E1
    const ev2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/events`,
      headers: { 'if-match': await getRev() },
      payload: {
        name: 'Great Migration',
        eventType: 'migration',
        startTick: '0',
        temporalExpression: {
          kind: 'relative',
          relativeToEventId: ev1.id,
          relativeOffsetTicks: '50',
          displayLabel: '帝国崩溃后50年',
        },
        causeEventIds: [ev1.id],
      },
    });
    expect(ev2Res.statusCode).toBe(201);
    const ev2 = ev2Res.json().data;
    expect(ev2.startTick).toBe('150'); // 100 + 50 resolved!

    // 3. Create event E3 which is caused by E2
    const ev3Res = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/events`,
      headers: { 'if-match': await getRev() },
      payload: {
        name: 'Founding of New Kingdom',
        eventType: 'political',
        startTick: '200',
        causeEventIds: [ev2.id],
      },
    });
    expect(ev3Res.statusCode).toBe(201);
    const ev3 = ev3Res.json().data;

    // 4. Create contradicting event E_Alt that contradicts E3
    const evAltRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/events`,
      headers: { 'if-match': await getRev() },
      payload: {
        name: 'Extinction in the Wasteland',
        eventType: 'tragedy',
        startTick: '200',
        causalLinks: [
          { targetEventId: ev3.id, kind: 'contradicts', description: 'Mutually exclusive historical outcomes' },
        ],
      },
    });
    expect(evAltRes.statusCode).toBe(201);
    const evAlt = evAltRes.json().data;

    // 5. Query causality lineage for E2
    const causalityRes = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/events/${ev2.id}/causality`,
    });
    expect(causalityRes.statusCode).toBe(200);
    const causality = causalityRes.json().data;
    expect(causality.event.id).toBe(ev2.id);
    expect(causality.upstreamCauses.some((c: { eventId: string }) => c.eventId === ev1.id)).toBe(true);
    expect(causality.downstreamConsequences.some((c: { eventId: string }) => c.eventId === ev3.id)).toBe(true);

    // 6. Query causality for E3 and verify contradicting event is reported
    const e3CausalityRes = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/events/${ev3.id}/causality`,
    });
    expect(e3CausalityRes.statusCode).toBe(200);
    const e3Causality = e3CausalityRes.json().data;
    expect(e3Causality.contradictingEvents.some((c: { eventId: string }) => c.eventId === evAlt.id)).toBe(true);

    // 7. Verify cycle rejection: attempt to create E_loop caused by E3 and causing E1 (E1 -> E2 -> E3 -> E_loop -> E1)
    const cycleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/events`,
      headers: { 'if-match': await getRev() },
      payload: {
        name: 'Causal Bootstrap Paradox',
        eventType: 'magic',
        startTick: '120',
        causeEventIds: [ev3.id],
        causalLinks: [
          { targetEventId: ev1.id, kind: 'causes' },
        ],
      },
    });
    expect(cycleRes.statusCode).toBe(422);
    expect(cycleRes.json().error.message).toContain('cycle detected');

    await app.close();
  });

  it('manages Plotlines and Foreshadowings with audit detection and scene review', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Narrative API World' } })).json().data;
    const getRev = async () => (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data.revision as string;

    // 1. Create a Plotline
    const plRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/plotlines`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'Throne Succession War',
        summary: 'Power struggle among the princes',
        currentStage: 'setup',
        status: 'active',
      },
    });
    expect(plRes.statusCode).toBe(201);
    const plotline = plRes.json().data;
    expect(plotline.title).toBe('Throne Succession War');
    expect(plotline.currentStage).toBe('setup');

    // 2. Query Plotlines list & get by id
    const plList = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/plotlines` });
    expect(plList.statusCode).toBe(200);
    expect(plList.json().data.length).toBe(1);

    const plGet = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/plotlines/${plotline.id}` });
    expect(plGet.statusCode).toBe(200);
    expect(plGet.json().data.id).toBe(plotline.id);

    // 3. Patch Plotline
    const plPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/worlds/${world.id}/plotlines/${plotline.id}`,
      headers: { 'if-match': await getRev() },
      payload: { currentStage: 'development' },
    });
    expect(plPatch.statusCode).toBe(200);
    expect(plPatch.json().data.currentStage).toBe('development');

    // 4. Create narrative structure (work, chapter, scenes)
    const workRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/works`,
      headers: { 'if-match': await getRev() },
      payload: { title: 'Crown of Ash' },
    });
    const work = workRes.json().data;

    const chapterRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/works/${work.id}/chapters`,
      headers: { 'if-match': await getRev() },
      payload: { title: 'Act I' },
    });
    const chapter = chapterRes.json().data;

    const sceneSetupRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'The Will Hidden in the Crypt',
        sceneTick: '100',
        orderIndex: 1,
        plotlineIds: [plotline.id],
        proseText: 'The old king hid his true last will beneath the sarcophagus.',
      },
    });
    expect(sceneSetupRes.statusCode).toBe(201);
    const sceneSetup = sceneSetupRes.json().data;
    expect(sceneSetup.plotlineIds).toEqual([plotline.id]);

    const scenePayoffRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'Reading of the Will',
        sceneTick: '50',
        orderIndex: 2,
        plotlineIds: [plotline.id],
        proseText: 'The archbishop unsealed the will from the crypt.',
      },
    });
    expect(scenePayoffRes.statusCode).toBe(201);
    const scenePayoff = scenePayoffRes.json().data;

    // 5. Create Foreshadowing linking them
    const fRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/foreshadowings`,
      headers: { 'if-match': await getRev() },
      payload: {
        title: 'The Secret Will',
        description: 'Reveals the younger prince as true heir',
        setupSceneId: sceneSetup.id,
        payoffSceneId: scenePayoff.id,
        plotlineId: plotline.id,
        status: 'resolved',
      },
    });
    expect(fRes.statusCode).toBe(201);
    const foreshadowing = fRes.json().data;
    expect(foreshadowing.setupSceneId).toBe(sceneSetup.id);
    expect(foreshadowing.payoffSceneId).toBe(scenePayoff.id);
    expect(foreshadowing.setupTick).toBe('100');
    expect(foreshadowing.payoffTick).toBe('50');

    // 6. Query Foreshadowings list (with plotline filter) & get by id
    const fList = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/foreshadowings?plotlineId=${plotline.id}`,
    });
    expect(fList.statusCode).toBe(200);
    expect(fList.json().data.length).toBe(1);

    const fGet = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/foreshadowings/${foreshadowing.id}`,
    });
    expect(fGet.statusCode).toBe(200);
    expect(fGet.json().data.title).toBe('The Secret Will');

    // 7. Audit Foreshadowings endpoint
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/worlds/${world.id}/foreshadowings/audit`,
    });
    expect(auditRes.statusCode).toBe(200);
    const audit = auditRes.json().data;
    expect(audit.totalForeshadowings).toBe(1);
    expect(audit.issues.some((i: { code: string }) => i.code === 'PREMATURE_PAYOFF')).toBe(true);

    // 8. Scene review endpoint captures PREMATURE_PAYOFF
    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/scenes/${scenePayoff.id}/continuity-review`,
    });
    expect(reviewRes.statusCode).toBe(200);
    const review = reviewRes.json().data;
    expect(review.pass).toBe(false);
    expect(review.issues.some((i: { code: string }) => i.code === 'PREMATURE_PAYOFF')).toBe(true);

    // 9. Patch & Delete Foreshadowing
    const fPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/worlds/${world.id}/foreshadowings/${foreshadowing.id}`,
      headers: { 'if-match': await getRev() },
      payload: { status: 'abandoned' },
    });
    expect(fPatch.statusCode).toBe(200);
    expect(fPatch.json().data.status).toBe('abandoned');

    const fDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/worlds/${world.id}/foreshadowings/${foreshadowing.id}`,
      headers: { 'if-match': await getRev() },
    });
    expect(fDelete.statusCode).toBe(204);

    // 10. Delete Plotline
    const plDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/worlds/${world.id}/plotlines/${plotline.id}`,
      headers: { 'if-match': await getRev() },
    });
    expect(plDelete.statusCode).toBe(204);

    await app.close();
  });

  it('detects unlinked mentions, turns them into wikilinks, and exposes backlinks', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Wiki World' } })).json().data;
    const getRev = async () => (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data.revision as string;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': await getRev() }, payload: { typeKey: 'wiki-person', label: 'Person' } })).json().data;
    const arlen = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': await getRev() }, payload: { typeId: type.id, name: '阿伦', document: { markdown: '阿伦进入黑塔。' } } })).json().data;
    const tower = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': await getRev() }, payload: { typeId: type.id, name: '黑塔' } })).json().data;
    const unlinked = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entities/${arlen.id}/unlinked-mentions` });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json().data.map((item: { name: string }) => item.name)).toContain('黑塔');
    const linked = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entities/${arlen.id}/link-mention`,
      headers: { 'if-match': await getRev() },
      payload: { name: '黑塔' },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data.documentText).toContain('[[黑塔]]');
    const backlinks = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entities/${tower.id}/backlinks` });
    expect(backlinks.json().data.map((item: { entityId: string }) => item.entityId)).toEqual([arlen.id]);
    await app.close();
  });

  it('migrates an entity type schema by renaming a field into a new immutable version', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Schema Migration World' } })).json().data;
    const type = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types`,
      headers: { 'if-match': '1' },
      payload: { typeKey: 'office', label: 'Office', schema: { fields: [{ key: 'title', label: 'Title', type: 'Text' }] } },
    })).json().data;
    const migrated = await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/entity-types/${type.id}/migrations`,
      headers: { 'if-match': '2' },
      payload: { operations: [{ op: 'RenameField', from: 'title', to: 'office_name' }] },
    });
    expect(migrated.statusCode).toBe(201);
    expect(migrated.json().data.schemaVersion).toBe(2);
    expect(migrated.json().data.schema.fields[0].key).toBe('office_name');
    const versions = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/entity-types/${type.id}/versions` });
    expect(versions.json().data.map((item: { schemaVersion: number }) => item.schemaVersion)).toEqual([1, 2]);
    await app.close();
  });

  it('round-trips claims, rules, branches, and narrative records through JSON export/import', async () => {
    const app = setup();
    const world = (await app.inject({ method: 'POST', url: '/api/v1/worlds', payload: { name: 'Portable Knowledge World' } })).json().data;
    const getRev = async () => (await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}` })).json().data.revision as string;
    const type = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entity-types`, headers: { 'if-match': await getRev() }, payload: { typeKey: 'portable-person', label: 'Person' } })).json().data;
    const emperor = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': await getRev() }, payload: { typeId: type.id, name: 'Emperor' } })).json().data;
    const chronicle = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/entities`, headers: { 'if-match': await getRev() }, payload: { typeId: type.id, name: 'Chronicle' } })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/branches`, headers: { 'if-match': await getRev() }, payload: { name: 'what-if', status: 'sandbox' } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/claims`,
      headers: { 'if-match': await getRev() },
      payload: { subjectEntityId: emperor.id, predicateKey: 'death_cause', objectKind: 'scalar', value: 'poison', assertedByEntityId: chronicle.id, knownByEntityIds: [chronicle.id], claimKind: 'official_record', truthStatus: 'false' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/rules`,
      headers: { 'if-match': await getRev() },
      payload: { name: 'human-max-age', severity: 'warning', target: 'entity', assert: { duration_between: { from: 'birth_date', to: 'death_date', lte: 180 } }, message: 'Humans rarely live past 180 years' },
    });
    const work = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/works`, headers: { 'if-match': await getRev() }, payload: { title: 'The Fall', type: 'novel' } })).json().data;
    const chapter = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/works/${work.id}/chapters`, headers: { 'if-match': await getRev() }, payload: { title: 'Chapter 1' } })).json().data;
    const scene = (await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/chapters/${chapter.id}/scenes`,
      headers: { 'if-match': await getRev() },
      payload: { title: 'The Poisoning', povCharacterId: emperor.id, participantEntityIds: [emperor.id], proseText: 'The cup was already empty.' },
    })).json().data;
    const plotline = (await app.inject({ method: 'POST', url: `/api/v1/worlds/${world.id}/plotlines`, headers: { 'if-match': await getRev() }, payload: { title: 'Succession', characterEntityIds: [emperor.id] } })).json().data;
    await app.inject({
      method: 'POST',
      url: `/api/v1/worlds/${world.id}/foreshadowings`,
      headers: { 'if-match': await getRev() },
      payload: { title: 'The empty cup', setupSceneId: scene.id, plotlineId: plotline.id, relatedEntityIds: [emperor.id] },
    });

    const exported = await app.inject({ method: 'GET', url: `/api/v1/worlds/${world.id}/export.json` });
    expect(exported.statusCode).toBe(200);
    const inspected = await app.inject({ method: 'POST', url: '/api/v1/imports/inspect', payload: JSON.parse(exported.body) });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json().data.counts.claims).toBe(1);
    expect(inspected.json().data.counts.validationRules).toBe(1);
    expect(inspected.json().data.counts.works).toBe(1);
    expect(inspected.json().data.counts.scenes).toBe(1);
    expect(inspected.json().data.counts.foreshadowings).toBe(1);

    const imported = await app.inject({ method: 'POST', url: '/api/v1/imports/commit', payload: { bundle: JSON.parse(exported.body), name: 'Portable Knowledge Copy' } });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.counts.claims).toBe(1);
    expect(imported.json().data.counts.validationRules).toBe(1);
    expect(imported.json().data.counts.works).toBe(1);
    expect(imported.json().data.counts.chapters).toBe(1);
    expect(imported.json().data.counts.scenes).toBe(1);
    expect(imported.json().data.counts.plotlines).toBe(1);
    expect(imported.json().data.counts.foreshadowings).toBe(1);
    expect(imported.json().data.counts.timelineBranches).toBeGreaterThanOrEqual(2);

    const copyId = imported.json().data.world.id as string;
    const claims = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${copyId}/claims?canonStatus=all` })).json().data as Array<{ predicateKey: string; value: unknown }>;
    expect(claims).toHaveLength(1);
    expect(claims[0]?.predicateKey).toBe('death_cause');
    expect(claims[0]?.value).toBe('poison');
    const rules = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${copyId}/rules` })).json().data as Array<{ name: string }>;
    expect(rules.some((rule) => rule.name === 'human-max-age')).toBe(true);
    const works = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${copyId}/works` })).json().data as Array<{ id: string; title: string }>;
    expect(works[0]?.title).toBe('The Fall');
    const branches = (await app.inject({ method: 'GET', url: `/api/v1/worlds/${copyId}/branches` })).json().data as Array<{ name: string }>;
    expect(branches.some((branch) => branch.name === 'what-if')).toBe(true);
    await app.close();
  });
});
