import type { Claim, ContinuityIssue, Entity, Fact, Relation, Scene, SceneReviewResult, World } from '@world-codex/domain';

export function reviewSceneContinuity(
  world: World,
  scene: Scene,
  entities: Entity[],
  facts: Fact[],
  _relations: Relation[],
  claims: Claim[],
): SceneReviewResult {
  const issues: ContinuityIssue[] = [];
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  const effectiveTick = scene.sceneTick ?? world.currentTick;
  if (scene.sceneTick === undefined || scene.sceneTick === null) {
    issues.push({
      code: 'UNANCHORED_SCENE_TICK',
      severity: 'info',
      sceneId: scene.id,
      message: `Scene does not specify a sceneTick; reviewing against current world tick (${world.currentTick.toString()}).`,
      evidence: [`World tick: ${world.currentTick.toString()}`],
    });
  }

  // 1. Verify POV character existence
  if (scene.povCharacterId) {
    const pov = entityMap.get(scene.povCharacterId);
    if (!pov) {
      issues.push({
        code: 'INVALID_POV',
        severity: 'blocker',
        sceneId: scene.id,
        subjectId: scene.povCharacterId,
        message: `POV character "${scene.povCharacterId}" does not exist in the world.`,
        evidence: [scene.povCharacterId],
      });
    }
  }

  // 2. Verify Location entity existence
  if (scene.locationEntityId) {
    const loc = entityMap.get(scene.locationEntityId);
    if (!loc) {
      issues.push({
        code: 'UNKNOWN_LOCATION',
        severity: 'blocker',
        sceneId: scene.id,
        subjectId: scene.locationEntityId,
        message: `Location entity "${scene.locationEntityId}" does not exist in the world.`,
        evidence: [scene.locationEntityId],
      });
    }
  }

  // 3. Verify Participant entities existence
  for (const participantId of scene.participantEntityIds) {
    const participant = entityMap.get(participantId);
    if (!participant) {
      issues.push({
        code: 'UNKNOWN_PARTICIPANT',
        severity: 'blocker',
        sceneId: scene.id,
        subjectId: participantId,
        message: `Participant entity "${participantId}" does not exist in the world.`,
        evidence: [participantId],
      });
    }
  }

  // 4. Character temporal & state checks (Birth / Death / Location)
  const characterIds = new Set<string>();
  if (scene.povCharacterId && entityMap.has(scene.povCharacterId)) {
    characterIds.add(scene.povCharacterId);
  }
  for (const participantId of scene.participantEntityIds) {
    if (entityMap.has(participantId)) {
      characterIds.add(participantId);
    }
  }

  const birthPredicates = new Set(['birth', 'birth_date', 'born', 'date_of_birth', 'birthtick', 'birth_tick']);
  const deathPredicates = new Set(['death', 'death_date', 'died', 'date_of_death', 'deceased', 'death_tick']);
  const locationPredicates = new Set(['location', 'current_location', 'stationed_at', 'residence']);

  for (const characterId of characterIds) {
    const character = entityMap.get(characterId)!;
    const charFacts = facts.filter((f) => f.subjectEntityId === characterId && f.canonStatus !== 'retconned');

    // Check Birth
    for (const fact of charFacts) {
      if (birthPredicates.has(fact.predicateKey.toLowerCase())) {
        let birthTick: bigint | undefined = fact.validFromTick;
        if (birthTick === undefined) {
          if (typeof fact.value === 'bigint') birthTick = fact.value;
          else if (typeof fact.value === 'number') birthTick = BigInt(fact.value);
          else if (typeof fact.value === 'string' && /^-?\d+$/.test(fact.value)) birthTick = BigInt(fact.value);
        }
        if (birthTick !== undefined && birthTick > effectiveTick) {
          issues.push({
            code: 'UNBORN_CHARACTER',
            severity: 'blocker',
            sceneId: scene.id,
            subjectId: character.id,
            message: `Character "${character.name}" has not been born yet at tick ${effectiveTick.toString()} (born at tick ${birthTick.toString()}).`,
            evidence: [
              `Character: ${character.name} (${character.id})`,
              `Fact: ${fact.id} (${fact.predicateKey})`,
              `Birth tick: ${birthTick.toString()}`,
              `Scene tick: ${effectiveTick.toString()}`,
            ],
          });
        }
      }

      // Check Death
      if (deathPredicates.has(fact.predicateKey.toLowerCase())) {
        let deathTick: bigint | undefined = fact.validFromTick;
        if (deathTick === undefined) {
          if (typeof fact.value === 'bigint') deathTick = fact.value;
          else if (typeof fact.value === 'number') deathTick = BigInt(fact.value);
          else if (typeof fact.value === 'string' && /^-?\d+$/.test(fact.value)) deathTick = BigInt(fact.value);
        }
        if (deathTick !== undefined && deathTick <= effectiveTick) {
          issues.push({
            code: 'DECEASED_CHARACTER',
            severity: 'blocker',
            sceneId: scene.id,
            subjectId: character.id,
            message: `Character "${character.name}" is deceased at tick ${effectiveTick.toString()} (died at tick ${deathTick.toString()}) but appears in scene.`,
            evidence: [
              `Character: ${character.name} (${character.id})`,
              `Fact: ${fact.id} (${fact.predicateKey})`,
              `Death tick: ${deathTick.toString()}`,
              `Scene tick: ${effectiveTick.toString()}`,
            ],
          });
        }
      }

      // Check Location conflict
      if (scene.locationEntityId && locationPredicates.has(fact.predicateKey.toLowerCase())) {
        const isActive =
          (fact.validFromTick === undefined || fact.validFromTick <= effectiveTick) &&
          (fact.validToTick === undefined || fact.validToTick > effectiveTick);

        if (isActive && fact.objectKind === 'entity' && fact.objectEntityId) {
          if (fact.objectEntityId !== scene.locationEntityId) {
            // Check if scene location is a child/descendant of the fact location
            let isSubLocation = false;
            let current = entityMap.get(scene.locationEntityId);
            const visited = new Set<string>();
            while (current && !visited.has(current.id)) {
              visited.add(current.id);
              if (current.id === fact.objectEntityId) {
                isSubLocation = true;
                break;
              }
              current = current.parentEntityId ? entityMap.get(current.parentEntityId) : undefined;
            }

            if (!isSubLocation) {
              const knownLocName = entityMap.get(fact.objectEntityId)?.name ?? fact.objectEntityId;
              const sceneLocName = entityMap.get(scene.locationEntityId)?.name ?? scene.locationEntityId;
              issues.push({
                code: 'LOCATION_CONFLICT',
                severity: 'warning',
                sceneId: scene.id,
                subjectId: character.id,
                message: `Character "${character.name}" is located at "${knownLocName}" at tick ${effectiveTick.toString()}, but scene takes place at "${sceneLocName}".`,
                evidence: [
                  `Character: ${character.name} (${character.id})`,
                  `Recorded location: ${knownLocName} (${fact.objectEntityId})`,
                  `Scene location: ${sceneLocName} (${scene.locationEntityId})`,
                ],
              });
            }
          }
        }
      }
    }
  }

  // 5. Premature knowledge / Secret leaks
  if (scene.povCharacterId) {
    const pov = entityMap.get(scene.povCharacterId);
    const textToScan = `${scene.title ?? ''} ${scene.proseText}`.toLowerCase();

    for (const claim of claims) {
      if (claim.canonStatus === 'retconned') continue;
      if (claim.assertedByEntityId === scene.povCharacterId) continue;
      // If claim has an explicit whitelist of knowers and POV is not in it
      if (claim.knownByEntityIds && claim.knownByEntityIds.length > 0 && !claim.knownByEntityIds.includes(scene.povCharacterId)) {
        const predicateNeedle = claim.predicateKey.toLowerCase();
        const valueNeedle = typeof claim.value === 'string' ? claim.value.toLowerCase() : '';

        const keyMatched = predicateNeedle.length > 3 && textToScan.includes(predicateNeedle);
        const valueMatched = valueNeedle.length > 3 && textToScan.includes(valueNeedle);

        if (keyMatched || valueMatched) {
          const povName = pov?.name ?? scene.povCharacterId;
          issues.push({
            code: 'PREMATURE_KNOWLEDGE',
            severity: 'warning',
            sceneId: scene.id,
            subjectId: scene.povCharacterId,
            message: `POV character "${povName}" does not know claim "${claim.predicateKey}", but it is referenced in the scene text.`,
            evidence: [
              `POV: ${povName} (${scene.povCharacterId})`,
              `Claim: ${claim.id} (${claim.predicateKey})`,
              `Known by: ${claim.knownByEntityIds.join(', ')}`,
            ],
          });
        }
      }
    }
  }

  const pass = !issues.some((i) => i.severity === 'blocker' || i.severity === 'error');
  return {
    sceneId: scene.id,
    pass,
    issues,
  };
}
