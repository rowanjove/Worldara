import { assertNonEmpty, DomainError, type CanonStatus, type Claim, type ClaimKind, type ClaimTruthStatus, type Entity, type EventCausalRelationKind, type Fact, type Relation, type RelationType, type World, type WorldEvent } from '@world-codex/domain';
import type { Clock, IdGenerator } from './ports';
import type { CreateClaimInput, CreateEventInput, CreateFactInput, CreateRelationInput, TemporalRepository } from './temporal-ports';

export class TemporalApplicationService {
  constructor(private readonly repository: TemporalRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}

  async listFacts(worldId: string): Promise<Fact[]> { await this.requireWorld(worldId); return this.repository.listFacts(worldId); }
  async listRelationTypes(worldId: string): Promise<RelationType[]> { await this.requireWorld(worldId); return this.repository.listRelationTypes(worldId); }
  async listRelations(worldId: string): Promise<Relation[]> { await this.requireWorld(worldId); return this.repository.listRelations(worldId); }
  async listEvents(worldId: string): Promise<WorldEvent[]> { await this.requireWorld(worldId); return this.repository.listEvents(worldId); }

  async getTimeline(worldId: string, fromTick: bigint, toTick: bigint, options?: { canonStatus?: 'canon' | 'pending' | 'retconned' | 'draft' | 'all' }): Promise<{ facts: Fact[]; relations: Relation[]; events: WorldEvent[] }> {
    if (fromTick >= toTick) throw new DomainError('VALIDATION_ERROR', 'Timeline range must be non-empty');
    const [facts, relations, events] = await Promise.all([this.listFacts(worldId), this.listRelations(worldId), this.listEvents(worldId)]);
    const targetStatus = options?.canonStatus ?? 'canon';
    const statusFilter = (status: import('@world-codex/domain').CanonStatus): boolean => {
      if (targetStatus === 'all') return true;
      if (targetStatus === 'canon') return status === 'canon' || status === 'pending';
      return status === targetStatus;
    };
    const overlaps = (from: bigint | undefined, to: bigint | undefined): boolean => (from === undefined || from < toTick) && (to === undefined || to > fromTick);
    return {
      facts: facts.filter((fact) => statusFilter(fact.canonStatus) && overlaps(fact.validFromTick, fact.validToTick)),
      relations: relations.filter((relation) => statusFilter(relation.canonStatus) && overlaps(relation.validFromTick, relation.validToTick)),
      events: events.filter((event) => statusFilter(event.canonStatus) && event.startTick < toTick && (event.endTick === undefined || event.endTick >= fromTick)),
    };
  }

  async getNeighborhood(worldId: string, entityId: string, depth = 1, atTick = 0n): Promise<{ entities: Entity[]; relations: Relation[] }> {
    if (!Number.isInteger(depth) || depth < 0 || depth > 2) throw new DomainError('VALIDATION_ERROR', 'depth must be between 0 and 2');
    await this.requireWorld(worldId);
    const [entities, relations] = await Promise.all([this.repository.listEntities(worldId), this.repository.listRelations(worldId)]);
    if (!entities.some((entity) => entity.id === entityId)) throw new DomainError('NOT_FOUND', 'Entity not found', { entityId });
    const activeRelations = relations.filter((relation) =>
      (relation.canonStatus === 'canon' || relation.canonStatus === 'pending') &&
      (relation.validFromTick === undefined || atTick >= relation.validFromTick) &&
      (relation.validToTick === undefined || atTick < relation.validToTick),
    );
    const selected = new Set<string>([entityId]);
    let frontier = [entityId];
    for (let level = 0; level < depth; level += 1) {
      const next: string[] = [];
      for (const relation of activeRelations) if ((frontier.includes(relation.sourceEntityId) || frontier.includes(relation.targetEntityId))) {
        const other = selected.has(relation.sourceEntityId) ? relation.targetEntityId : relation.sourceEntityId;
        if (!selected.has(other)) { selected.add(other); next.push(other); }
      }
      frontier = next; if (!frontier.length) break;
    }
    return { entities: entities.filter((entity) => selected.has(entity.id)), relations: activeRelations.filter((relation) => selected.has(relation.sourceEntityId) && selected.has(relation.targetEntityId)) };
  }

  async createFact(worldId: string, input: Omit<CreateFactInput, 'id' | 'worldId'>, expectedWorldRevision: bigint): Promise<Fact> {
    assertNonEmpty(input.predicateKey, 'predicateKey');
    if (input.objectKind === 'entity' && !input.objectEntityId) throw new DomainError('VALIDATION_ERROR', 'Entity facts require objectEntityId');
    if (input.objectKind !== 'entity' && input.objectEntityId !== undefined) throw new DomainError('VALIDATION_ERROR', 'Only entity facts may set objectEntityId');
    if (input.validFromTick !== undefined && input.validToTick !== undefined && input.validFromTick >= input.validToTick) throw new DomainError('VALIDATION_ERROR', 'Fact valid range must be non-empty');
    const command: CreateFactInput = { ...input, id: this.ids.next(), worldId };
    await this.requireWorld(worldId);
    return this.repository.createFact(command, expectedWorldRevision);
  }

  async createRelationType(worldId: string, input: { forwardLabel: string; inverseLabel?: string; symmetric?: boolean; sourceTypeIds?: string[]; targetTypeIds?: string[] }, expectedWorldRevision: bigint): Promise<RelationType> {
    assertNonEmpty(input.forwardLabel, 'forwardLabel');
    await this.requireWorld(worldId);
    const entityTypes = new Set((await this.repository.listEntityTypes(worldId)).map((type) => type.id));
    for (const typeId of [...(input.sourceTypeIds ?? []), ...(input.targetTypeIds ?? [])]) if (!entityTypes.has(typeId)) throw new DomainError('NOT_FOUND', 'Relation endpoint type not found in world', { typeId });
    return this.repository.createRelationType({ id: this.ids.next(), worldId, typeKey: `relation-${this.ids.next().slice(0, 8)}`, label: input.forwardLabel, schema: {}, now: this.clock.now(), forwardLabel: input.forwardLabel, inverseLabel: input.inverseLabel ?? input.forwardLabel, symmetric: input.symmetric ?? false, sourceTypeIds: input.sourceTypeIds ?? [], targetTypeIds: input.targetTypeIds ?? [] }, expectedWorldRevision);
  }

  async createRelation(worldId: string, input: Omit<CreateRelationInput, 'id' | 'worldId'>, expectedWorldRevision: bigint): Promise<Relation> {
    if (input.sourceEntityId === input.targetEntityId) throw new DomainError('VALIDATION_ERROR', 'Relation cannot target itself');
    await this.requireWorld(worldId);
    const relationType = (await this.repository.listRelationTypes(worldId)).find((candidate) => candidate.id === input.relationTypeId);
    if (!relationType) throw new DomainError('NOT_FOUND', 'Relation type not found', { relationTypeId: input.relationTypeId });
    const normalized = relationType.symmetric && input.sourceEntityId > input.targetEntityId
      ? { ...input, sourceEntityId: input.targetEntityId, targetEntityId: input.sourceEntityId }
      : input;
    const entities = await this.repository.listEntities(worldId);
    const source = entities.find((entity) => entity.id === normalized.sourceEntityId);
    const target = entities.find((entity) => entity.id === normalized.targetEntityId);
    if (!source || !target) throw new DomainError('NOT_FOUND', 'Relation endpoint not found', { sourceEntityId: normalized.sourceEntityId, targetEntityId: normalized.targetEntityId });
    if (relationType.sourceTypeIds.length > 0 && !relationType.sourceTypeIds.includes(source.typeId)) throw new DomainError('VALIDATION_ERROR', 'Source entity type is not allowed for relation', { relationTypeId: relationType.id, entityId: source.id, typeId: source.typeId });
    if (relationType.targetTypeIds.length > 0 && !relationType.targetTypeIds.includes(target.typeId)) throw new DomainError('VALIDATION_ERROR', 'Target entity type is not allowed for relation', { relationTypeId: relationType.id, entityId: target.id, typeId: target.typeId });
    return this.repository.createRelation({ ...normalized, id: this.ids.next(), worldId }, expectedWorldRevision);
  }

  async createEvent(worldId: string, input: Omit<CreateEventInput, 'id' | 'worldId'>, expectedWorldRevision: bigint): Promise<WorldEvent> {
    assertNonEmpty(input.name, 'name');
    await this.requireWorld(worldId);
    const existingEvents = await this.repository.listEvents(worldId);
    const eventIds = new Set(existingEvents.map((event) => event.id));

    let startTick = input.startTick;
    let endTick = input.endTick;
    if (input.temporalExpression) {
      if (input.temporalExpression.kind === 'relative' && input.temporalExpression.relativeToEventId) {
        const relativeTarget = existingEvents.find((e) => e.id === input.temporalExpression!.relativeToEventId);
        if (!relativeTarget) {
          throw new DomainError('NOT_FOUND', 'Relative temporal target event not found', { eventId: input.temporalExpression.relativeToEventId });
        }
        startTick = relativeTarget.startTick + (input.temporalExpression.relativeOffsetTicks ?? 0n);
        if (input.temporalExpression.startTick === undefined) {
          input.temporalExpression.startTick = startTick;
        }
      }
      if (input.temporalExpression.endTick !== undefined && endTick === undefined) {
        endTick = input.temporalExpression.endTick;
      }
    }
    if (endTick !== undefined && endTick < startTick) throw new DomainError('VALIDATION_ERROR', 'Event end must not precede start');

    const participantRoles = input.participantRoles ?? input.participantIds.map((entityId) => ({ entityId, role: 'participant' }));
    if (new Set(participantRoles.map((participant) => `${participant.entityId}:${participant.role}`)).size !== participantRoles.length) throw new DomainError('VALIDATION_ERROR', 'Event participants and roles must be unique');
    const command: CreateEventInput = { ...input, startTick, ...(endTick === undefined ? {} : { endTick }), participantRoles, id: this.ids.next(), worldId };

    const entities = new Set((await this.repository.listEntities(worldId)).map((entity) => entity.id));
    const entityRefs = [...new Set(participantRoles.map((participant) => participant.entityId)), ...input.locationEntityIds];
    if (new Set(entityRefs).size !== entityRefs.length) throw new DomainError('VALIDATION_ERROR', 'Event participant and location references must be unique');
    for (const entityId of entityRefs) if (!entities.has(entityId)) throw new DomainError('NOT_FOUND', 'Event entity reference not found', { entityId });

    const causalLinks = input.causalLinks ?? [];
    const causalTargetIds = causalLinks.map((link) => link.targetEventId);
    const linkedIds = [...input.causeEventIds, ...input.resultEventIds, ...causalTargetIds];
    if (new Set(linkedIds).size !== linkedIds.length) throw new DomainError('VALIDATION_ERROR', 'Event links must be unique');
    for (const linkedId of linkedIds) {
      if (!eventIds.has(linkedId)) throw new DomainError('NOT_FOUND', 'Linked event not found', { eventId: linkedId });
      if (linkedId === command.id) throw new DomainError('VALIDATION_ERROR', 'Event cannot link to itself');
    }

    const graph = new Map<string, string[]>();
    for (const event of existingEvents) {
      const targets: string[] = [...event.resultEventIds];
      for (const link of event.causalLinks ?? []) {
        if (['causes', 'triggers', 'enables', 'results_in'].includes(link.kind)) {
          targets.push(link.targetEventId);
        }
      }
      graph.set(event.id, targets);
      for (const causeId of event.causeEventIds) {
        const existingCause = graph.get(causeId) ?? [];
        existingCause.push(event.id);
        graph.set(causeId, existingCause);
      }
    }
    const commandTargets: string[] = [...input.resultEventIds];
    for (const link of causalLinks) {
      if (['causes', 'triggers', 'enables', 'results_in'].includes(link.kind)) {
        commandTargets.push(link.targetEventId);
      }
    }
    graph.set(command.id, commandTargets);
    for (const causeId of input.causeEventIds) {
      const existingCause = graph.get(causeId) ?? [];
      existingCause.push(command.id);
      graph.set(causeId, existingCause);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new DomainError('VALIDATION_ERROR', 'Event link cycle detected', { eventId: id });
      if (visited.has(id)) return;
      visiting.add(id);
      for (const next of graph.get(id) ?? []) visit(next);
      visiting.delete(id); visited.add(id);
    };
    for (const key of graph.keys()) visit(key);

    const sequences = input.effects.map((effect) => effect.sequence);
    if (new Set(sequences).size !== sequences.length) throw new DomainError('VALIDATION_ERROR', 'Event effect sequence must be unique');
    return this.repository.createEvent(command, expectedWorldRevision);
  }

  async getSnapshot(worldId: string, tick: bigint, asOfRevision?: bigint, branchId?: string): Promise<{ world: World; entities: Entity[]; facts: Fact[]; relations: Relation[]; events: WorldEvent[]; relationTypes: RelationType[]; mapFeatures: import('@world-codex/domain').MapFeature[]; asOfRevision?: bigint; branchId?: string }> {
    const world = await this.requireWorld(worldId);
    const effectiveAsOfRevision = asOfRevision ?? world.revision;
    const [entities, facts, relations, events, relationTypes, mapFeatures] = await Promise.all([this.repository.listSnapshotBaseEntities(worldId, effectiveAsOfRevision), this.repository.listFacts(worldId), this.repository.listRelations(worldId), this.repository.listEvents(worldId), this.repository.listRelationTypes(worldId), this.repository.listAllMapFeatures(worldId)]);
    return {
      world,
      entities,
      facts,
      relations,
      events,
      relationTypes,
      mapFeatures,
      ...(asOfRevision === undefined ? {} : { asOfRevision }),
      ...(branchId === undefined ? {} : { branchId }),
    };
  }

  async createClaim(worldId: string, input: Omit<CreateClaimInput, 'id' | 'worldId'>, expectedWorldRevision: bigint): Promise<Claim> {
    assertNonEmpty(input.predicateKey, 'predicateKey');
    if (input.objectKind === 'entity' && !input.objectEntityId) throw new DomainError('VALIDATION_ERROR', 'Entity claims require objectEntityId');
    if (input.objectKind !== 'entity' && input.objectEntityId !== undefined) throw new DomainError('VALIDATION_ERROR', 'Only entity claims may set objectEntityId');
    if (input.validFromTick !== undefined && input.validToTick !== undefined && input.validFromTick >= input.validToTick) throw new DomainError('VALIDATION_ERROR', 'Claim valid range must be non-empty');
    await this.requireWorld(worldId);
    const entities = new Set((await this.repository.listEntities(worldId)).map((entity) => entity.id));
    if (input.subjectEntityId && !entities.has(input.subjectEntityId)) throw new DomainError('NOT_FOUND', 'Claim subject not found', { entityId: input.subjectEntityId });
    if (input.objectKind === 'entity' && (!input.objectEntityId || !entities.has(input.objectEntityId))) throw new DomainError('NOT_FOUND', 'Claim target not found', { entityId: input.objectEntityId });
    if (input.assertedByEntityId && !entities.has(input.assertedByEntityId)) throw new DomainError('NOT_FOUND', 'Claim assertor not found', { entityId: input.assertedByEntityId });
    for (const audienceId of input.knownByEntityIds) {
      if (!entities.has(audienceId)) throw new DomainError('NOT_FOUND', 'Claim audience member not found', { entityId: audienceId });
    }
    const command: CreateClaimInput = { ...input, id: this.ids.next(), worldId };
    return this.repository.createClaim(command, expectedWorldRevision);
  }

  async listClaims(worldId: string, filter?: {
    subjectEntityId?: string;
    assertedByEntityId?: string;
    claimKind?: ClaimKind;
    truthStatus?: ClaimTruthStatus;
    canonStatus?: CanonStatus | 'all';
    branchId?: string;
  }): Promise<Claim[]> {
    await this.requireWorld(worldId);
    const claims = await this.repository.listClaims(worldId);
    return claims.filter((claim) => {
      if (filter?.subjectEntityId && claim.subjectEntityId !== filter.subjectEntityId) return false;
      if (filter?.assertedByEntityId && claim.assertedByEntityId !== filter.assertedByEntityId) return false;
      if (filter?.claimKind && claim.claimKind !== filter.claimKind) return false;
      if (filter?.truthStatus && claim.truthStatus !== filter.truthStatus) return false;
      if (filter?.branchId && claim.branchId !== filter.branchId) return false;
      if (filter?.canonStatus && filter.canonStatus !== 'all') {
        if (claim.canonStatus !== filter.canonStatus) return false;
      } else if (!filter?.canonStatus) {
        if (claim.canonStatus !== 'canon' && claim.canonStatus !== 'pending') return false;
      }
      return true;
    });
  }

  async getClaim(worldId: string, claimId: string): Promise<Claim | null> {
    await this.requireWorld(worldId);
    return this.repository.getClaim(worldId, claimId);
  }

  async createBranch(worldId: string, input: { id?: string; name: string; parentBranchId?: string | null; forkTick?: bigint | null; forkRevision?: bigint | null; status?: import('@world-codex/domain').TimelineBranchStatus }, expectedWorldRevision: bigint): Promise<import('@world-codex/domain').TimelineBranch> {
    assertNonEmpty(input.name, 'name');
    await this.requireWorld(worldId);
    const id = input.id ?? this.ids.next();
    return this.repository.createBranch({
      id,
      worldId,
      name: input.name.trim(),
      parentBranchId: input.parentBranchId ?? null,
      forkTick: input.forkTick ?? null,
      forkRevision: input.forkRevision ?? null,
      status: input.status ?? 'alternate',
      now: this.clock.now(),
    }, expectedWorldRevision);
  }

  async listBranches(worldId: string): Promise<import('@world-codex/domain').TimelineBranch[]> {
    await this.requireWorld(worldId);
    return this.repository.listBranches(worldId);
  }

  async getEventCausality(worldId: string, eventId: string): Promise<{
    event: WorldEvent;
    upstreamCauses: Array<{
      eventId: string;
      name: string;
      eventType: string;
      startTick: bigint;
      canonStatus: WorldEvent['canonStatus'];
      relationKind?: EventCausalRelationKind;
      description?: string;
    }>;
    downstreamConsequences: Array<{
      eventId: string;
      name: string;
      eventType: string;
      startTick: bigint;
      canonStatus: WorldEvent['canonStatus'];
      relationKind?: EventCausalRelationKind;
      description?: string;
    }>;
    contradictingEvents: Array<{
      eventId: string;
      name: string;
      eventType: string;
      startTick: bigint;
      canonStatus: WorldEvent['canonStatus'];
      relationKind?: EventCausalRelationKind;
      description?: string;
    }>;
    hasCycle: boolean;
  }> {
    await this.requireWorld(worldId);
    const events = await this.repository.listEvents(worldId);
    const eventMap = new Map(events.map((e) => [e.id, e]));
    const targetEvent = eventMap.get(eventId);
    if (!targetEvent) throw new DomainError('NOT_FOUND', 'Event not found', { eventId });

    const forward = new Map<string, Array<{ targetId: string; kind: EventCausalRelationKind; description?: string }>>();
    const backward = new Map<string, Array<{ sourceId: string; kind: EventCausalRelationKind; description?: string }>>();
    const contradictions = new Set<string>();

    for (const ev of events) {
      for (const resId of ev.resultEventIds) {
        forward.set(ev.id, [...(forward.get(ev.id) ?? []), { targetId: resId, kind: 'results_in' }]);
        backward.set(resId, [...(backward.get(resId) ?? []), { sourceId: ev.id, kind: 'results_in' }]);
      }
      for (const causeId of ev.causeEventIds) {
        forward.set(causeId, [...(forward.get(causeId) ?? []), { targetId: ev.id, kind: 'causes' }]);
        backward.set(ev.id, [...(backward.get(ev.id) ?? []), { sourceId: causeId, kind: 'causes' }]);
      }
      for (const link of ev.causalLinks ?? []) {
        if (['causes', 'triggers', 'enables', 'results_in'].includes(link.kind)) {
          forward.set(ev.id, [...(forward.get(ev.id) ?? []), { targetId: link.targetEventId, kind: link.kind, ...(link.description ? { description: link.description } : {}) }]);
          backward.set(link.targetEventId, [...(backward.get(link.targetEventId) ?? []), { sourceId: ev.id, kind: link.kind, ...(link.description ? { description: link.description } : {}) }]);
        } else if (['prevents', 'contradicts'].includes(link.kind)) {
          if (ev.id === eventId) contradictions.add(link.targetEventId);
          if (link.targetEventId === eventId) contradictions.add(ev.id);
        }
      }
    }

    const toQueueItem = (id: string, kind?: EventCausalRelationKind, description?: string): { id: string; kind?: EventCausalRelationKind; description?: string } => ({
      id,
      ...(kind ? { kind } : {}),
      ...(description ? { description } : {}),
    });

    const upstreamCauses: Array<{
      eventId: string;
      name: string;
      eventType: string;
      startTick: bigint;
      canonStatus: WorldEvent['canonStatus'];
      relationKind?: EventCausalRelationKind;
      description?: string;
    }> = [];
    const visitedUpstream = new Set<string>([eventId]);
    const queueUpstream: Array<{ id: string; kind?: EventCausalRelationKind; description?: string }> = (backward.get(eventId) ?? []).map((e) => toQueueItem(e.sourceId, e.kind, e.description));

    while (queueUpstream.length > 0) {
      const item = queueUpstream.shift()!;
      if (visitedUpstream.has(item.id)) continue;
      visitedUpstream.add(item.id);
      const ev = eventMap.get(item.id);
      if (ev) {
        upstreamCauses.push({
          eventId: ev.id,
          name: ev.name,
          eventType: ev.eventType,
          startTick: ev.startTick,
          canonStatus: ev.canonStatus,
          ...(item.kind ? { relationKind: item.kind } : {}),
          ...(item.description ? { description: item.description } : {}),
        });
        for (const next of backward.get(item.id) ?? []) {
          if (!visitedUpstream.has(next.sourceId)) {
            queueUpstream.push(toQueueItem(next.sourceId, next.kind, next.description));
          }
        }
      }
    }

    const downstreamConsequences: Array<{
      eventId: string;
      name: string;
      eventType: string;
      startTick: bigint;
      canonStatus: WorldEvent['canonStatus'];
      relationKind?: EventCausalRelationKind;
      description?: string;
    }> = [];
    const visitedDownstream = new Set<string>([eventId]);
    const queueDownstream: Array<{ id: string; kind?: EventCausalRelationKind; description?: string }> = (forward.get(eventId) ?? []).map((e) => toQueueItem(e.targetId, e.kind, e.description));

    while (queueDownstream.length > 0) {
      const item = queueDownstream.shift()!;
      if (visitedDownstream.has(item.id)) continue;
      visitedDownstream.add(item.id);
      const ev = eventMap.get(item.id);
      if (ev) {
        downstreamConsequences.push({
          eventId: ev.id,
          name: ev.name,
          eventType: ev.eventType,
          startTick: ev.startTick,
          canonStatus: ev.canonStatus,
          ...(item.kind ? { relationKind: item.kind } : {}),
          ...(item.description ? { description: item.description } : {}),
        });
        for (const next of forward.get(item.id) ?? []) {
          if (!visitedDownstream.has(next.targetId)) {
            queueDownstream.push(toQueueItem(next.targetId, next.kind, next.description));
          }
        }
      }
    }

    const contradictingEvents: Array<{
      eventId: string;
      name: string;
      eventType: string;
      startTick: bigint;
      canonStatus: WorldEvent['canonStatus'];
      relationKind?: EventCausalRelationKind;
      description?: string;
    }> = [];
    for (const cId of contradictions) {
      const ev = eventMap.get(cId);
      if (ev) {
        contradictingEvents.push({
          eventId: ev.id,
          name: ev.name,
          eventType: ev.eventType,
          startTick: ev.startTick,
          canonStatus: ev.canonStatus,
          relationKind: 'contradicts',
        });
      }
    }

    let hasCycle = false;
    const cycleVisited = new Set<string>();
    const cycleVisiting = new Set<string>();
    const checkCycle = (curr: string): boolean => {
      if (cycleVisiting.has(curr)) return true;
      if (cycleVisited.has(curr)) return false;
      cycleVisiting.add(curr);
      for (const next of forward.get(curr) ?? []) {
        if (checkCycle(next.targetId)) return true;
      }
      cycleVisiting.delete(curr);
      cycleVisited.add(curr);
      return false;
    };
    hasCycle = checkCycle(eventId);

    return {
      event: targetEvent,
      upstreamCauses,
      downstreamConsequences,
      contradictingEvents,
      hasCycle,
    };
  }

  private async requireWorld(id: string): Promise<World> { const world = await this.repository.getWorld(id); if (!world) throw new DomainError('NOT_FOUND', 'World not found', { worldId: id }); return world; }
}
