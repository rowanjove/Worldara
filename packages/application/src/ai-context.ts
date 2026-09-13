import type { Entity, Fact, Relation, World, WorldEvent } from '@world-codex/domain';
import type { SearchResult } from './ports';

export interface CanonContextInput {
  world: World;
  entities: readonly Entity[];
  facts: readonly Fact[];
  relations: readonly Relation[];
  events: readonly WorldEvent[];
  search: readonly SearchResult[];
  atTick?: bigint;
  limit?: number;
}

export interface CanonContext {
  world: World;
  atTick?: string;
  entities: Entity[];
  facts: Fact[];
  relations: Relation[];
  events: WorldEvent[];
  search: SearchResult[];
}

/**
 * Build a bounded, deterministic AI context. Only Canon records are eligible;
 * temporal rows are additionally intersected with the requested world tick.
 * This is a pure selector so API, MCP and future workers can share the same
 * retrieval policy without giving a provider database access.
 */
export function buildCanonContext(input: CanonContextInput): CanonContext {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
  const active = (from: bigint | undefined, to: bigint | undefined): boolean => input.atTick === undefined || ((from === undefined || from <= input.atTick) && (to === undefined || input.atTick < to));
  const entities = input.entities.filter((entity) => entity.canonStatus === 'canon').slice(0, limit);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const facts = input.facts.filter((fact) => fact.canonStatus === 'canon' && active(fact.validFromTick, fact.validToTick) && entityIds.has(fact.subjectEntityId)).slice(0, limit);
  const relations = input.relations.filter((relation) => relation.canonStatus === 'canon' && active(relation.validFromTick, relation.validToTick) && entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId)).slice(0, limit);
  const events = input.events.filter((event) => event.canonStatus === 'canon' && active(event.startTick, event.endTick)).slice(0, limit);
  const allowedIds = new Set([...entities.map((item) => item.id), ...facts.map((item) => item.id), ...relations.map((item) => item.id), ...events.map((item) => item.id)]);
  const search = input.search.filter((result) => allowedIds.has(result.id)).slice(0, limit);
  return { world: input.world, ...(input.atTick === undefined ? {} : { atTick: input.atTick.toString() }), entities, facts, relations, events, search };
}
