import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CanonApplicationService, WorldApplicationService, InMemoryWorldRepository, TemporalApplicationService, type CanonTarget } from '@world-codex/application';
import { createPool, PostgresWorldRepository, runMigrations } from '@world-codex/database';
import { openSqliteWorldRepository } from '@world-codex/database-sqlite';
import { validateWorld, validateIncremental, type ValidationContext } from '@world-codex/validator';
import type { ChangeSet, IncrementalValidationResult, ValidationIssue } from '@world-codex/domain';
import { createApp, createFileAssetStore } from './app';
import { createProposalProviderFromEnv } from '@world-codex/ai';

function createRepository() {
  if (process.env.DATABASE_URL) {
    console.log('World Codex API using PostgreSQL');
    return new PostgresWorldRepository(createPool());
  }
  if (process.env.WORLD_CODEX_STORE === 'memory') {
    console.warn('WORLD_CODEX_STORE=memory; API is using a volatile in-memory repository.');
    return new InMemoryWorldRepository();
  }
  const sqlitePath = process.env.WORLD_CODEX_SQLITE_PATH ?? path.resolve(process.cwd(), 'data/world-codex.sqlite');
  mkdirSync(path.dirname(sqlitePath), { recursive: true });
  console.log(`World Codex API using SQLite at ${sqlitePath}`);
  return openSqliteWorldRepository(sqlitePath);
}

async function main(): Promise<void> {
  if (process.env.DATABASE_URL && process.env.MIGRATE_ON_START === '1') {
    console.log('World Codex API running PostgreSQL migrations before startup');
    await runMigrations();
  }
  const repository = createRepository();
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production; the JSON-snapshot SQLite adapter is single-process only');
  const clock = { now: () => new Date() };
  const service = new WorldApplicationService(repository, { next: randomUUID }, clock);
  const temporal = new TemporalApplicationService(repository, { next: randomUUID }, clock);
  const validateWorldState = async (worldId: string, candidates: CanonTarget[] = [], changeSet?: ChangeSet): Promise<ValidationIssue[]> => {
  const world = await repository.getWorld(worldId);
  if (!world) return [{ ruleCode: 'WORLD_ACCESS_DENIED', severity: 'blocker', relatedIds: [worldId], message: 'World not found', evidence: [] }];
  const [entities, entityTypes, facts, relationTypes, relations, events, rules] = await Promise.all([
    repository.listEntities(worldId), repository.listEntityTypes(worldId), repository.listFacts(worldId), repository.listRelationTypes(worldId), repository.listRelations(worldId), repository.listEvents(worldId), repository.listValidationRules(worldId),
  ]);
  const stagedByKind = {
    entity: new Map(candidates.filter((item) => 'typeId' in item).map((item) => [item.id, item])),
    fact: new Map(candidates.filter((item) => 'predicateKey' in item).map((item) => [item.id, item])),
    relation: new Map(candidates.filter((item) => 'relationTypeId' in item).map((item) => [item.id, item])),
    event: new Map(candidates.filter((item) => 'eventType' in item).map((item) => [item.id, item])),
  };
  const replace = <T extends { id: string }>(items: T[], staged: Map<string, CanonTarget>): T[] => items.map((item) => (staged.get(item.id) ?? item) as T);
  const context: ValidationContext = {
    world,
    entities: replace(entities, stagedByKind.entity),
    entityTypes,
    facts: replace(facts, stagedByKind.fact),
    relationTypes,
    relations: replace(relations, stagedByKind.relation),
    events: replace(events, stagedByKind.event),
    rules,
  };
  if (changeSet) {
    return validateIncremental(context, changeSet, rules).issues;
  }
  return validateWorld(context, rules);
  };

  const validateWorldIncrementalState = async (worldId: string, changeSet: ChangeSet): Promise<IncrementalValidationResult> => {
  const world = await repository.getWorld(worldId);
  if (!world) {
    return {
      issues: [{ ruleCode: 'WORLD_ACCESS_DENIED', severity: 'blocker', relatedIds: [worldId], message: 'World not found', evidence: [] }],
      affectedRuleCodes: ['WORLD_ACCESS_DENIED'],
      skippedRuleCodes: [],
      impactedEntityIds: [],
      isIncremental: true,
    };
  }
  const [entities, entityTypes, facts, relationTypes, relations, events, rules] = await Promise.all([
    repository.listEntities(worldId), repository.listEntityTypes(worldId), repository.listFacts(worldId), repository.listRelationTypes(worldId), repository.listRelations(worldId), repository.listEvents(worldId), repository.listValidationRules(worldId),
  ]);
  return validateIncremental({ world, entities, entityTypes, facts, relationTypes, relations, events, rules }, changeSet, rules);
  };

  const canon = new CanonApplicationService(repository, clock, (worldId, target, _status, stagedTargets, changeSet) => validateWorldState(worldId, stagedTargets ?? [target], changeSet));
  const app = createApp(service, temporal, canon, (worldId) => validateWorldState(worldId), repository, createFileAssetStore(process.env.ASSET_STORAGE_DIR ?? `${process.cwd()}/data/assets`), createProposalProviderFromEnv(), repository, validateWorldIncrementalState);
  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? '127.0.0.1';
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (!loopbackHosts.has(host) && !process.env.WORLD_CODEX_API_TOKEN) throw new Error('WORLD_CODEX_API_TOKEN must be configured when API_HOST is not loopback');

  await app.listen({ host, port });
  console.log(`World Codex API listening on http://${host}:${port}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
