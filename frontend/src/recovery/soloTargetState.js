import { TARGET_RARITY_RULES } from '../config/gameConfig.js'
import { getCreatureById } from '../data/creatureCatalog.js'
import {
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
  createSoloPendingCatchId,
} from './soloRecoveryCheckpoint.js'

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function cloneArray(value) {
  return structuredClone(Array.isArray(value) ? value : [])
}

export function normalizeSoloTarget(
  target,
  { caught = false, roundStartedAtEpochMs = 0 } = {},
) {
  const creature = getCreatureById(target?.creatureId)
  if (!creature) {
    return null
  }

  const lifetimeMs = Number.isFinite(target.lifetimeMs) && target.lifetimeMs > 0
    ? target.lifetimeMs
    : TARGET_RARITY_RULES[target.rarity]?.lifetimeMs ??
      TARGET_RARITY_RULES[creature.rarity].lifetimeMs
  const derivedSpawnedAt = target.expiresAt - lifetimeMs
  const spawnedAt = Number.isFinite(target.spawnedAt)
    ? target.spawnedAt
    : Math.min(
        target.expiresAt,
        Math.max(roundStartedAtEpochMs, derivedSpawnedAt),
      )
  const normalized = {
    ...structuredClone(target),
    id: target.id,
    creatureId: creature.id,
    lat: target.lat,
    lon: target.lon,
    name: creature.name,
    type: creature.type,
    color: creature.color,
    symbol: creature.symbol,
    shortDescription: creature.shortDescription,
    imageUrl: creature.imageUrl,
    soundUrl: creature.soundUrl,
    rarity: target.rarity ?? creature.rarity,
    score: isNonNegativeInteger(target.score) ? target.score : creature.score,
    lifetimeMs,
    spawnedAt,
    expiresAt: target.expiresAt,
  }

  if (caught) {
    normalized.caughtAt = target.caughtAt
  } else {
    delete normalized.caughtAt
  }

  return normalized
}

export function normalizeSoloTargetCollections(checkpoint) {
  const caughtTargets = checkpoint.caughtTargets
    .map((target) => normalizeSoloTarget(target, {
      caught: true,
      roundStartedAtEpochMs: checkpoint.round.startedAtEpochMs ?? 0,
    }))
    .filter(Boolean)
  const caughtIds = new Set(caughtTargets.map((target) => target.id))
  const seenActiveIds = new Set()
  const targets = checkpoint.targets
    .map((target) => normalizeSoloTarget(target, {
      roundStartedAtEpochMs: checkpoint.round.startedAtEpochMs ?? 0,
    }))
    .filter((target) => {
      if (
        !target ||
        caughtIds.has(target.id) ||
        seenActiveIds.has(target.id)
      ) {
        return false
      }
      seenActiveIds.add(target.id)
      return true
    })

  return { targets, caughtTargets }
}

export function applySoloTargetCatchTransition(
  gameplayState,
  {
    targetId,
    caughtAtEpochMs,
    settledPosition = gameplayState.player?.settledPosition,
    createCatchId = createSoloPendingCatchId,
  },
) {
  const caughtTargets = cloneArray(gameplayState.caughtTargets)
  const existingCaught = caughtTargets.find((target) => target.id === targetId)

  if (existingCaught) {
    const targets = gameplayState.targets.filter(
      (target) => target.id !== targetId,
    )
    return {
      changed: targets.length !== gameplayState.targets.length,
      caughtTarget: null,
      duplicate: true,
      chaseStopped: false,
      state: { ...gameplayState, targets },
    }
  }

  const target = gameplayState.targets.find(
    (candidate) => candidate.id === targetId,
  )
  if (!target) {
    return { changed: false, caughtTarget: null, duplicate: false, chaseStopped: false, state: gameplayState }
  }
  if (
    caughtAtEpochMs >= target.expiresAt ||
    caughtAtEpochMs >= gameplayState.round.endsAtEpochMs
  ) {
    return { changed: false, caughtTarget: null, duplicate: false, chaseStopped: false, state: gameplayState }
  }

  const caughtTarget = {
    ...structuredClone(target),
    caughtAt: caughtAtEpochMs,
  }
  const pendingCatches = cloneArray(
    gameplayState.backendSync?.pendingCatches,
  )
  if (!pendingCatches.some((pendingCatch) => pendingCatch.targetId === targetId)) {
    pendingCatches.push({
      catchId: createCatchId(),
      targetId,
      creatureId: target.creatureId,
      caughtAtEpochMs,
    })
  }
  const chaseStopped = Boolean(
    gameplayState.movement?.purpose ===
      SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE &&
    gameplayState.movement.chasedTargetId === targetId,
  )

  return {
    changed: true,
    caughtTarget,
    duplicate: false,
    chaseStopped,
    state: {
      ...gameplayState,
      targets: gameplayState.targets.filter(
        (candidate) => candidate.id !== targetId,
      ),
      caughtTargets: [caughtTarget, ...caughtTargets],
      score: gameplayState.score + target.score,
      xp: gameplayState.xp + target.score,
      movement: chaseStopped ? null : gameplayState.movement,
      player: {
        ...gameplayState.player,
        settledPosition: structuredClone(settledPosition),
      },
      backendSync: {
        ...gameplayState.backendSync,
        pendingCatches,
      },
    },
  }
}

export function applySoloTargetExpiryTransition(
  gameplayState,
  { targetId, settledPosition = gameplayState.player?.settledPosition },
) {
  const target = gameplayState.targets.find(
    (candidate) => candidate.id === targetId,
  )
  if (!target) {
    return { changed: false, expiredTarget: null, chaseStopped: false, state: gameplayState }
  }
  const chaseStopped = Boolean(
    gameplayState.movement?.purpose ===
      SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE &&
    gameplayState.movement.chasedTargetId === targetId,
  )

  return {
    changed: true,
    expiredTarget: target,
    chaseStopped,
    state: {
      ...gameplayState,
      targets: gameplayState.targets.filter(
        (candidate) => candidate.id !== targetId,
      ),
      movement: chaseStopped ? null : gameplayState.movement,
      player: {
        ...gameplayState.player,
        settledPosition: structuredClone(settledPosition),
      },
    },
  }
}

export function acknowledgeSoloPendingCatch(gameplayState, catchId) {
  const pendingCatches = gameplayState.backendSync.pendingCatches.filter(
    (pendingCatch) => pendingCatch.catchId !== catchId,
  )
  return pendingCatches.length === gameplayState.backendSync.pendingCatches.length
    ? gameplayState
    : {
        ...gameplayState,
        backendSync: { ...gameplayState.backendSync, pendingCatches },
      }
}
