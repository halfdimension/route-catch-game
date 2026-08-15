import {
  createRouteAnimationPlan,
  createRouteMovementAnchor,
  reconstructAnchoredRouteMovement,
} from '../hooks/useRouteAnimation.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_ROUND_PHASES,
  calculateSoloCheckpointExpiresAt,
  createSoloClientRoundId,
  isSoloCheckpointStorageExpired,
  isSoloCheckpointResumable,
  validateSoloRecoveryCheckpoint,
} from './soloRecoveryCheckpoint.js'
import { parseSoloIdentityKey } from './soloRecoveryIdentity.js'
import { reconcileSoloTargetRecoveryTimeline } from './soloTargetRecoveryTimeline.js'

export const SOLO_RECOVERY_BOOTSTRAP_STATES = Object.freeze({
  AUTH_UNRESOLVED: 'AUTH_UNRESOLVED',
  LOADING: 'RECOVERY_LOADING',
  READY: 'RECOVERY_READY',
})

export const SOLO_RECOVERY_BOOTSTRAP_KINDS = Object.freeze({
  NONE: 'NONE',
  RESUME: 'RESUME',
  RECONCILING: 'RECONCILING',
  REJECTED: 'REJECTED',
  UNAVAILABLE: 'UNAVAILABLE',
  STALE: 'STALE',
})

export const SOLO_RECOVERY_UNAVAILABLE_WARNING =
  'Active-round recovery is unavailable. SOLO gameplay can continue.'
export const SOLO_BACKEND_SYNC_WARNING =
  'Recovered locally; backend session sync is temporarily unavailable.'

function cloneOr(value, fallback) {
  return structuredClone(value ?? fallback)
}

function runningUpdatedAt(checkpoint, nowEpochMs, startedAtEpochMs, endsAtEpochMs) {
  return Math.max(
    checkpoint.createdAtEpochMs,
    startedAtEpochMs,
    Math.min(nowEpochMs, endsAtEpochMs - 1),
  )
}

export function createBackendSoloRoundTimeline(backendSession) {
  const durationSeconds = Number(backendSession?.durationSeconds)
  const startedAtEpochMs = Date.parse(backendSession?.startedAt)

  if (
    !Number.isSafeInteger(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(startedAtEpochMs)
  ) {
    return null
  }

  return {
    durationSeconds,
    startedAtEpochMs,
    endsAtEpochMs: startedAtEpochMs + durationSeconds * 1000,
  }
}

export function isBackendSessionCompatibleWithIdentity(
  backendSession,
  identityKey,
) {
  const identity = parseSoloIdentityKey(identityKey)
  if (!identity) {
    return false
  }

  if (identity.kind === 'user') {
    return (
      typeof backendSession?.userId === 'string' &&
      backendSession.userId.toLowerCase() === identity.subjectId
    )
  }

  return backendSession?.userId == null
}

export function isSameSoloRecoveryRound(previousCheckpoint, {
  identityKey,
  clientRoundId,
  backendSessionId,
  timeline,
}) {
  if (!previousCheckpoint || !clientRoundId) {
    return false
  }

  const previousRound = previousCheckpoint.round
  const timelineIsValid = (
    Number.isSafeInteger(timeline?.durationSeconds) &&
    timeline.durationSeconds > 0 &&
    Number.isFinite(timeline.startedAtEpochMs) &&
    timeline.endsAtEpochMs ===
      timeline.startedAtEpochMs + timeline.durationSeconds * 1000
  )
  return (
    timelineIsValid &&
    previousCheckpoint.identityKey === identityKey &&
    previousRound.clientRoundId === clientRoundId &&
    previousRound.backendSessionId === backendSessionId
  )
}

export function buildSoloRunningCheckpoint({
  identityKey,
  backendSessionId,
  timeline,
  playerPosition,
  simulationSpeedMetersPerSecond,
  movement = null,
  gameplayState,
  previousCheckpoint = null,
  clientRoundId,
  nowEpochMs = Date.now(),
}) {
  const previousRoundIsCompatible = previousCheckpoint && (
    previousCheckpoint.identityKey === identityKey &&
    previousCheckpoint.round.backendSessionId === backendSessionId
  )
  const nextClientRoundId = clientRoundId ?? (
    previousRoundIsCompatible
      ? previousCheckpoint.round.clientRoundId
      : createSoloClientRoundId()
  )
  const preservePrevious = isSameSoloRecoveryRound(previousCheckpoint, {
    identityKey,
    clientRoundId: nextClientRoundId,
    backendSessionId,
    timeline,
  })
  const createdAtEpochMs = preservePrevious
    ? previousCheckpoint.createdAtEpochMs
    : nowEpochMs
  const preservedGameplay = preservePrevious ? previousCheckpoint : {}
  const targets = gameplayState?.targets ?? preservedGameplay.targets ?? []
  const caughtTargets =
    gameplayState?.caughtTargets ?? preservedGameplay.caughtTargets ?? []
  const score = gameplayState?.score ?? preservedGameplay.score ?? 0
  const xp = gameplayState?.xp ?? preservedGameplay.xp ?? 0
  const spawning = gameplayState?.spawning ?? preservedGameplay.spawning ?? {
    paused: false,
    nextSpawnAtEpochMs: null,
  }
  const backendSync = gameplayState?.backendSync ??
    preservedGameplay.backendSync ?? { pendingCatches: [] }
  const updatedAtEpochMs = runningUpdatedAt(
    { createdAtEpochMs },
    nowEpochMs,
    timeline.startedAtEpochMs,
    timeline.endsAtEpochMs,
  )

  return validateSoloRecoveryCheckpoint({
    schemaVersion: 1,
    identityKey,
    round: {
      clientRoundId: nextClientRoundId,
      backendSessionId,
      phase: SOLO_RECOVERY_ROUND_PHASES.RUNNING,
      durationSeconds: timeline.durationSeconds,
      startedAtEpochMs: timeline.startedAtEpochMs,
      endsAtEpochMs: timeline.endsAtEpochMs,
    },
    player: {
      settledPosition: cloneOr(playerPosition, null),
      simulationSpeedMetersPerSecond,
    },
    movement: cloneOr(movement, null),
    targets: cloneOr(targets, []),
    caughtTargets: cloneOr(caughtTargets, []),
    score,
    xp,
    spawning: cloneOr(spawning, {
      paused: false,
      nextSpawnAtEpochMs: null,
    }),
    backendSync: cloneOr(backendSync, { pendingCatches: [] }),
    createdAtEpochMs,
    updatedAtEpochMs,
    expiresAtEpochMs: calculateSoloCheckpointExpiresAt({
      phase: SOLO_RECOVERY_ROUND_PHASES.RUNNING,
      createdAtEpochMs,
      endsAtEpochMs: timeline.endsAtEpochMs,
    }),
  }, { expectedIdentityKey: identityKey })
}

export function createSoloReconcilingCheckpoint(checkpoint, nowEpochMs) {
  const updatedAtEpochMs = Math.max(
    checkpoint.round.endsAtEpochMs,
    Math.min(nowEpochMs, checkpoint.expiresAtEpochMs - 1),
  )

  return validateSoloRecoveryCheckpoint({
    ...structuredClone(checkpoint),
    round: {
      ...checkpoint.round,
      phase: SOLO_RECOVERY_ROUND_PHASES.RECONCILING,
    },
    movement: null,
    targets: [],
    spawning: {
      paused: true,
      nextSpawnAtEpochMs: null,
    },
    updatedAtEpochMs,
  }, { expectedIdentityKey: checkpoint.identityKey })
}

export function resolveRecoveredSoloMovement(checkpoint, nowEpochMs) {
  const movement = checkpoint.movement
  const settledPosition = checkpoint.player.settledPosition

  if (!movement) {
    return { kind: 'SETTLED', position: settledPosition, movement: null }
  }

  if (movement.phase === SOLO_RECOVERY_MOVEMENT_PHASES.ROUTING) {
    return {
      kind: 'ROUTING',
      position: settledPosition,
      movement,
    }
  }

  const plan = createRouteAnimationPlan(movement.routeCoordinates)
  const storedAnchor = createRouteMovementAnchor({
    anchorDistanceMeters: movement.anchorDistanceMeters,
    anchorTimeEpochMs: movement.anchorTimeEpochMs,
    speedMetersPerSecond:
      checkpoint.player.simulationSpeedMetersPerSecond,
  })
  const reconstructed = reconstructAnchoredRouteMovement(
    plan,
    storedAnchor,
    nowEpochMs,
  )

  if (reconstructed.isComplete) {
    return {
      kind: 'COMPLETED',
      position: reconstructed.position,
      movement: null,
      routeCoordinates: movement.routeCoordinates,
    }
  }

  return {
    kind: 'MOVING',
    position: reconstructed.position,
    movement,
    routeCoordinates: movement.routeCoordinates,
    movementAnchor: createRouteMovementAnchor({
      anchorDistanceMeters: reconstructed.distanceTraveledMeters,
      anchorTimeEpochMs: Math.max(
        nowEpochMs,
        movement.anchorTimeEpochMs,
      ),
      speedMetersPerSecond:
        checkpoint.player.simulationSpeedMetersPerSecond,
    }),
  }
}

function result(kind, overrides = {}) {
  return {
    kind,
    checkpoint: null,
    timeline: null,
    backendSession: null,
    warning: '',
    persistenceAvailable: true,
    ...overrides,
  }
}

function bootstrapScopeIsCurrent(isCurrent) {
  return isCurrent?.() !== false
}

function staleBootstrapResult() {
  return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.STALE, {
    persistenceAvailable: false,
  })
}

async function deleteCheckpoint(
  store,
  identityKey,
  { writer, isCurrent } = {},
) {
  if (!store) {
    throw new TypeError('A recovery store is required')
  }
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return { ok: false, operation: 'delete', stale: true }
  }
  const deletion = writer.delete()
  const persistence = await deletion
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return { ...persistence, stale: true }
  }
  return persistence
}

async function replaceCheckpoint(
  store,
  identityKey,
  checkpoint,
  { writer, isCurrent } = {},
) {
  if (!store) {
    throw new TypeError('A recovery store is required')
  }
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return { ok: false, operation: 'replace', stale: true }
  }
  const replacement = writer.replace(checkpoint)
  const persistence = await replacement
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return { ...persistence, stale: true }
  }
  return persistence
}

async function retainReconcilingCheckpoint(
  store,
  checkpoint,
  nowEpochMs,
  persistenceScope,
) {
  if (nowEpochMs >= checkpoint.expiresAtEpochMs) {
    const deletion = await deleteCheckpoint(
      store,
      checkpoint.identityKey,
      persistenceScope,
    )
    if (deletion.stale) {
      return { stale: true }
    }
    return {
      checkpoint: null,
      persistenceAvailable: deletion.ok,
    }
  }

  const reconciling = checkpoint.round.phase ===
      SOLO_RECOVERY_ROUND_PHASES.RECONCILING
    ? checkpoint
    : createSoloReconcilingCheckpoint(checkpoint, nowEpochMs)
  const replacement = await replaceCheckpoint(
    store,
    checkpoint.identityKey,
    reconciling,
    persistenceScope,
  )
  if (replacement.stale) {
    return { stale: true }
  }
  return {
    checkpoint: replacement.ok ? reconciling : null,
    persistenceAvailable: replacement.ok,
  }
}

export const SOLO_RECOVERY_BACKEND_ERROR_KINDS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  AUTHORIZATION: 'AUTHORIZATION',
  NONTRANSIENT_CLIENT: 'NONTRANSIENT_CLIENT',
  TRANSIENT: 'TRANSIENT',
})

export function classifySoloRecoveryBackendError(error) {
  const status = Number(error?.status)
  if (status === 404) {
    return SOLO_RECOVERY_BACKEND_ERROR_KINDS.NOT_FOUND
  }
  if (status === 401 || status === 403) {
    return SOLO_RECOVERY_BACKEND_ERROR_KINDS.AUTHORIZATION
  }
  if (Number.isFinite(status) && status >= 400 && status < 500) {
    return SOLO_RECOVERY_BACKEND_ERROR_KINDS.NONTRANSIENT_CLIENT
  }

  // Fetch/network failures have no HTTP status. Server failures are treated as
  // transient so a still-valid local SOLO round can remain usable offline.
  return SOLO_RECOVERY_BACKEND_ERROR_KINDS.TRANSIENT
}

function cleanupResult(kind, persistenceResult, overrides = {}) {
  return result(kind, {
    ...overrides,
    warning: persistenceResult.ok
      ? overrides.warning ?? ''
      : SOLO_RECOVERY_UNAVAILABLE_WARNING,
    persistenceAvailable: persistenceResult.ok,
  })
}

function reconcilingResult(retained, overrides = {}) {
  return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.RECONCILING, {
    ...overrides,
    checkpoint: retained.checkpoint,
    warning: retained.persistenceAvailable
      ? overrides.warning ?? ''
      : SOLO_RECOVERY_UNAVAILABLE_WARNING,
    persistenceAvailable: retained.persistenceAvailable,
  })
}

async function reconcileNonRunningCheckpoint({
  checkpoint,
  backendSession,
  backendError,
  store,
  endBackendSession,
  nowEpochMs,
  persistenceScope,
}) {
  if (!bootstrapScopeIsCurrent(persistenceScope?.isCurrent)) {
    return staleBootstrapResult()
  }
  checkpoint = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs,
    roundEndsAtEpochMs:
      createBackendSoloRoundTimeline(backendSession)?.endsAtEpochMs ??
      checkpoint.round.endsAtEpochMs,
  }).checkpoint
  const hasPendingCatchIntent =
    checkpoint.backendSync.pendingCatches.length > 0

  if (backendError) {
    const errorKind = classifySoloRecoveryBackendError(backendError)
    if (errorKind !== SOLO_RECOVERY_BACKEND_ERROR_KINDS.TRANSIENT) {
      if (hasPendingCatchIntent) {
        const retained = await retainReconcilingCheckpoint(
          store,
          checkpoint,
          nowEpochMs,
          persistenceScope,
        )
        if (retained.stale) {
          return staleBootstrapResult()
        }
        return reconcilingResult(retained, {
          warning: SOLO_BACKEND_SYNC_WARNING,
        })
      }
      const deletion = await deleteCheckpoint(
        store,
        checkpoint.identityKey,
        persistenceScope,
      )
      if (deletion.stale) {
        return staleBootstrapResult()
      }
      return cleanupResult(
        SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
        deletion,
      )
    }

    const retained = await retainReconcilingCheckpoint(
      store,
      checkpoint,
      nowEpochMs,
      persistenceScope,
    )
    if (retained.stale) {
      return staleBootstrapResult()
    }
    return reconcilingResult(retained, {
      warning: SOLO_BACKEND_SYNC_WARNING,
    })
  }

  if (!isBackendSessionCompatibleWithIdentity(
    backendSession,
    checkpoint.identityKey,
  )) {
    const deletion = await deleteCheckpoint(
      store,
      checkpoint.identityKey,
      persistenceScope,
    )
    if (deletion.stale) {
      return staleBootstrapResult()
    }
    return cleanupResult(
      SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
      deletion,
    )
  }

  if (backendSession.status === 'RUNNING') {
    if (!bootstrapScopeIsCurrent(persistenceScope?.isCurrent)) {
      return staleBootstrapResult()
    }
    try {
      backendSession = await endBackendSession(backendSession.sessionId)
    } catch (error) {
      if (!bootstrapScopeIsCurrent(persistenceScope?.isCurrent)) {
        return staleBootstrapResult()
      }
      if (
        classifySoloRecoveryBackendError(error) !==
          SOLO_RECOVERY_BACKEND_ERROR_KINDS.TRANSIENT
      ) {
        const deletion = await deleteCheckpoint(
          store,
          checkpoint.identityKey,
          persistenceScope,
        )
        if (deletion.stale) {
          return staleBootstrapResult()
        }
        return cleanupResult(
          SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
          deletion,
          { backendSession },
        )
      }
      const retained = await retainReconcilingCheckpoint(
        store,
        checkpoint,
        nowEpochMs,
        persistenceScope,
      )
      if (retained.stale) {
        return staleBootstrapResult()
      }
      return reconcilingResult(retained, {
        backendSession,
        warning: SOLO_BACKEND_SYNC_WARNING,
      })
    }
    if (!bootstrapScopeIsCurrent(persistenceScope?.isCurrent)) {
      return staleBootstrapResult()
    }
  }

  if (hasPendingCatchIntent) {
    const retained = await retainReconcilingCheckpoint(
      store,
      checkpoint,
      nowEpochMs,
      persistenceScope,
    )
    if (retained.stale) {
      return staleBootstrapResult()
    }
    return reconcilingResult(retained, {
      backendSession,
    })
  }

  const deletion = await deleteCheckpoint(
    store,
    checkpoint.identityKey,
    persistenceScope,
  )
  if (deletion.stale) {
    return staleBootstrapResult()
  }
  return cleanupResult(SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED, deletion, {
    backendSession,
  })
}

export async function bootstrapSoloRecovery({
  identityKey,
  store,
  writer,
  isCurrent,
  getBackendSession,
  endBackendSession,
  nowEpochMs = Date.now(),
}) {
  if (
    !writer ||
    typeof writer.replace !== 'function' ||
    typeof writer.delete !== 'function' ||
    typeof isCurrent !== 'function'
  ) {
    throw new TypeError(
      'Bootstrap persistence requires a scoped writer and freshness guard',
    )
  }
  const persistenceScope = { writer, isCurrent }
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return staleBootstrapResult()
  }

  // Bootstrap reads must never delete implicitly. Invalid and expired records
  // are removed below through the scoped writer after a freshness check.
  const read = await store.read(identityKey, { deleteInvalid: false })
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return staleBootstrapResult()
  }
  if (!read.ok) {
    return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.UNAVAILABLE, {
      warning: SOLO_RECOVERY_UNAVAILABLE_WARNING,
    })
  }

  const storedCheckpoint = read.checkpoint
  if (
    read.cleanupRequired === true ||
    (
      storedCheckpoint &&
      isSoloCheckpointStorageExpired(storedCheckpoint, nowEpochMs)
    )
  ) {
    const deletion = await deleteCheckpoint(
      store,
      identityKey,
      persistenceScope,
    )
    if (deletion.stale) {
      return staleBootstrapResult()
    }
    return deletion.ok
      ? result(SOLO_RECOVERY_BOOTSTRAP_KINDS.NONE)
      : result(SOLO_RECOVERY_BOOTSTRAP_KINDS.UNAVAILABLE, {
          warning: SOLO_RECOVERY_UNAVAILABLE_WARNING,
          persistenceAvailable: false,
        })
  }

  const checkpoint = storedCheckpoint
  if (!checkpoint) {
    return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.NONE)
  }

  let backendSession = null
  let backendError = null
  try {
    backendSession = await getBackendSession(
      checkpoint.round.backendSessionId,
    )
  } catch (error) {
    backendError = error
  }
  if (!bootstrapScopeIsCurrent(isCurrent)) {
    return staleBootstrapResult()
  }

  if (
    checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING ||
    (
      checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RUNNING &&
      !isSoloCheckpointResumable(checkpoint, nowEpochMs)
    )
  ) {
    return reconcileNonRunningCheckpoint({
      checkpoint,
      backendSession,
      backendError,
      store,
      endBackendSession,
      nowEpochMs,
      persistenceScope,
    })
  }

  if (checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.STARTING) {
    if (backendError) {
      const errorKind = classifySoloRecoveryBackendError(backendError)
      if (errorKind !== SOLO_RECOVERY_BACKEND_ERROR_KINDS.TRANSIENT) {
        const deletion = await deleteCheckpoint(
          store,
          identityKey,
          persistenceScope,
        )
        if (deletion.stale) {
          return staleBootstrapResult()
        }
        return cleanupResult(
          SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
          deletion,
        )
      }
      return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.RECONCILING, {
        checkpoint,
        warning: SOLO_BACKEND_SYNC_WARNING,
      })
    }

    if (!isBackendSessionCompatibleWithIdentity(backendSession, identityKey)) {
      const deletion = await deleteCheckpoint(
        store,
        identityKey,
        persistenceScope,
      )
      if (deletion.stale) {
        return staleBootstrapResult()
      }
      return cleanupResult(
        SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
        deletion,
      )
    }

    if (backendSession.status !== 'RUNNING') {
      if (backendSession.status === 'ENDED') {
        const deletion = await deleteCheckpoint(
          store,
          identityKey,
          persistenceScope,
        )
        if (deletion.stale) {
          return staleBootstrapResult()
        }
        return cleanupResult(
          SOLO_RECOVERY_BOOTSTRAP_KINDS.RECONCILING,
          deletion,
          { backendSession },
        )
      }
      return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.RECONCILING, {
        checkpoint,
        backendSession,
      })
    }
  }

  if (backendError) {
    const errorKind = classifySoloRecoveryBackendError(backendError)
    if (errorKind !== SOLO_RECOVERY_BACKEND_ERROR_KINDS.TRANSIENT) {
      if (checkpoint.backendSync.pendingCatches.length > 0) {
        const retained = await retainReconcilingCheckpoint(
          store,
          checkpoint,
          nowEpochMs,
          persistenceScope,
        )
        if (retained.stale) {
          return staleBootstrapResult()
        }
        return reconcilingResult(retained, {
          warning: SOLO_BACKEND_SYNC_WARNING,
        })
      }
      const deletion = await deleteCheckpoint(
        store,
        identityKey,
        persistenceScope,
      )
      if (deletion.stale) {
        return staleBootstrapResult()
      }
      return cleanupResult(
        SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
        deletion,
      )
    }
    const targetReconciliation = reconcileSoloTargetRecoveryTimeline(
      checkpoint,
      { nowEpochMs },
    )
    const recoveredCheckpoint = targetReconciliation.checkpoint
    if (targetReconciliation.changed) {
      const replacement = await replaceCheckpoint(
        store,
        identityKey,
        recoveredCheckpoint,
        persistenceScope,
      )
      if (replacement.stale) {
        return staleBootstrapResult()
      }
      if (!replacement.ok) {
        return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME, {
          checkpoint: recoveredCheckpoint,
          timeline: {
            durationSeconds: recoveredCheckpoint.round.durationSeconds,
            startedAtEpochMs: recoveredCheckpoint.round.startedAtEpochMs,
            endsAtEpochMs: recoveredCheckpoint.round.endsAtEpochMs,
          },
          warning: SOLO_RECOVERY_UNAVAILABLE_WARNING,
          persistenceAvailable: false,
        })
      }
    }
    return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME, {
      checkpoint: recoveredCheckpoint,
      timeline: {
        durationSeconds: recoveredCheckpoint.round.durationSeconds,
        startedAtEpochMs: recoveredCheckpoint.round.startedAtEpochMs,
        endsAtEpochMs: recoveredCheckpoint.round.endsAtEpochMs,
      },
      warning: SOLO_BACKEND_SYNC_WARNING,
    })
  }

  if (!isBackendSessionCompatibleWithIdentity(backendSession, identityKey)) {
    const deletion = await deleteCheckpoint(
      store,
      identityKey,
      persistenceScope,
    )
    if (deletion.stale) {
      return staleBootstrapResult()
    }
    return cleanupResult(
      SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED,
      deletion,
    )
  }

  if (backendSession.status !== 'RUNNING') {
    return reconcileNonRunningCheckpoint({
      checkpoint,
      backendSession,
      backendError: null,
      store,
      endBackendSession,
      nowEpochMs,
      persistenceScope,
    })
  }

  const backendTimeline = createBackendSoloRoundTimeline(backendSession)
  if (!backendTimeline || nowEpochMs >= backendTimeline.endsAtEpochMs) {
    return reconcileNonRunningCheckpoint({
      checkpoint,
      backendSession,
      backendError: null,
      store,
      endBackendSession,
      nowEpochMs,
      persistenceScope,
    })
  }

  const targetReconciliation = reconcileSoloTargetRecoveryTimeline(
    checkpoint,
    {
      nowEpochMs,
      roundEndsAtEpochMs: backendTimeline.endsAtEpochMs,
    },
  )
  const targetCheckpoint = targetReconciliation.checkpoint

  const reconciledCheckpoint = buildSoloRunningCheckpoint({
    identityKey,
    backendSessionId: backendSession.sessionId,
    timeline: backendTimeline,
    playerPosition: targetCheckpoint.player.settledPosition,
    simulationSpeedMetersPerSecond:
      targetCheckpoint.player.simulationSpeedMetersPerSecond,
    movement: targetCheckpoint.movement,
    gameplayState: {
      targets: targetCheckpoint.targets,
      caughtTargets: targetCheckpoint.caughtTargets,
      score: targetCheckpoint.score,
      xp: targetCheckpoint.xp,
      spawning: targetCheckpoint.spawning,
      backendSync: targetCheckpoint.backendSync,
    },
    previousCheckpoint: targetCheckpoint,
    nowEpochMs,
  })
  const replacement = await replaceCheckpoint(
    store,
    identityKey,
    reconciledCheckpoint,
    persistenceScope,
  )
  if (replacement.stale) {
    return staleBootstrapResult()
  }

  return result(SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME, {
    checkpoint: reconciledCheckpoint,
    timeline: backendTimeline,
    backendSession,
    warning: replacement.ok ? '' : SOLO_RECOVERY_UNAVAILABLE_WARNING,
    persistenceAvailable: replacement.ok,
  })
}
