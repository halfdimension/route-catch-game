import { TARGET_SPAWN_INTERVAL_MS } from '../config/gameConfig.js'
import {
  calculateAnchoredRouteDistanceMeters,
  createRouteAnimationPlan,
  sampleRoutePosition,
} from '../hooks/useRouteAnimation.js'
import {
  SOLO_ROUTE_EVENT_TIME_EPSILON_MS,
  SOLO_ROUTE_EVENT_TYPES as EVENT_TYPES,
  compareSoloRouteEvents,
  findSoloRouteCatchEntries,
  getSoloRouteTimeAtDistance,
} from '../utils/soloRouteCatchEvents.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
  createSoloPendingCatchId,
} from './soloRecoveryCheckpoint.js'
import {
  applySoloTargetCatchTransition,
  applySoloTargetExpiryTransition,
  normalizeSoloTargetCollections,
} from './soloTargetState.js'

function cloneCheckpointState(checkpoint, normalizedTargets) {
  const caughtIds = new Set(
    normalizedTargets.caughtTargets.map((target) => target.id),
  )
  return {
    ...structuredClone(checkpoint),
    targets: normalizedTargets.targets,
    caughtTargets: normalizedTargets.caughtTargets,
    backendSync: {
      ...structuredClone(checkpoint.backendSync),
      pendingCatches: checkpoint.backendSync.pendingCatches.filter(
        (pendingCatch) => caughtIds.has(pendingCatch.targetId),
      ),
    },
  }
}

function movementDistanceAt(plan, checkpoint, atEpochMs) {
  return calculateAnchoredRouteDistanceMeters(
    {
      anchorDistanceMeters: checkpoint.movement.anchorDistanceMeters,
      anchorTimeEpochMs: checkpoint.movement.anchorTimeEpochMs,
      speedMetersPerSecond:
        checkpoint.player.simulationSpeedMetersPerSecond,
    },
    atEpochMs,
    plan.totalDistanceMeters,
  )
}

function movementTimeAtDistance(checkpoint, distanceMeters) {
  return getSoloRouteTimeAtDistance({
    anchorDistanceMeters: checkpoint.movement.anchorDistanceMeters,
    anchorTimeEpochMs: checkpoint.movement.anchorTimeEpochMs,
    speedMetersPerSecond:
      checkpoint.player.simulationSpeedMetersPerSecond,
  }, distanceMeters)
}

function positionAt(plan, checkpoint, atEpochMs) {
  return sampleRoutePosition(
    plan,
    movementDistanceAt(plan, checkpoint, atEpochMs),
  )
}

function reconcileSpawnSchedule(spawning, nowEpochMs, roundEndsAtEpochMs) {
  if (spawning.paused || nowEpochMs >= roundEndsAtEpochMs) {
    return { paused: spawning.paused, nextSpawnAtEpochMs: null }
  }
  if (
    Number.isFinite(spawning.nextSpawnAtEpochMs) &&
    spawning.nextSpawnAtEpochMs > nowEpochMs
  ) {
    return structuredClone(spawning)
  }
  return {
    paused: false,
    // Missed random/asynchronous spawn opportunities are deliberately not
    // replayed. Continue one ordinary future cadence from recovery time.
    nextSpawnAtEpochMs: nowEpochMs + TARGET_SPAWN_INTERVAL_MS,
  }
}

function addExpiryEvents(events, targets, replayStartEpochMs, replayEndEpochMs) {
  targets.forEach((target, targetIndex) => {
    if (target.expiresAt <= replayEndEpochMs) {
      events.push({
        type: EVENT_TYPES.TARGET_EXPIRY,
        atEpochMs: Math.max(replayStartEpochMs, target.expiresAt),
        targetId: target.id,
        targetIndex,
      })
    }
  })
}

function addCatchEvents({
  events,
  checkpoint,
  plan,
  targets,
  replayStartEpochMs,
  replayEndEpochMs,
  roundEndsAtEpochMs,
}) {
  const movement = checkpoint.movement
  const movementStartsAtEpochMs = movement.anchorTimeEpochMs
  const catchWindowStartEpochMs = Math.max(
    replayStartEpochMs,
    movementStartsAtEpochMs,
  )
  if (catchWindowStartEpochMs > replayEndEpochMs) {
    return
  }

  const startDistanceMeters = movementDistanceAt(
    plan,
    checkpoint,
    catchWindowStartEpochMs,
  )
  const endDistanceMeters = movementDistanceAt(
    plan,
    checkpoint,
    replayEndEpochMs,
  )
  const catchEntries = findSoloRouteCatchEntries({
    plan,
    targets,
    startDistanceMeters,
    endDistanceMeters,
    windowStartEpochMs: catchWindowStartEpochMs,
    windowEndEpochMs: replayEndEpochMs,
    movementAnchor: {
      anchorDistanceMeters: movement.anchorDistanceMeters,
      anchorTimeEpochMs: movement.anchorTimeEpochMs,
      speedMetersPerSecond:
        checkpoint.player.simulationSpeedMetersPerSecond,
    },
    roundEndsAtEpochMs,
  })

  catchEntries.forEach((entry) => {
    events.push({
      type: EVENT_TYPES.TARGET_CATCH,
      atEpochMs: entry.caughtAtEpochMs,
      catchDistanceMeters: entry.catchDistanceMeters,
      targetId: entry.targetId,
      targetIndex: entry.targetIndex,
    })
  })
}

function createTimelineEvents({
  checkpoint,
  plan,
  replayStartEpochMs,
  replayEndEpochMs,
  roundEndsAtEpochMs,
}) {
  const events = []
  addExpiryEvents(
    events,
    checkpoint.targets,
    replayStartEpochMs,
    replayEndEpochMs,
  )

  if (plan && checkpoint.movement?.phase === SOLO_RECOVERY_MOVEMENT_PHASES.MOVING) {
    addCatchEvents({
      events,
      checkpoint,
      plan,
      targets: checkpoint.targets,
      replayStartEpochMs,
      replayEndEpochMs,
      roundEndsAtEpochMs,
    })
    const routeCompletionTime = movementTimeAtDistance(
      checkpoint,
      plan.totalDistanceMeters,
    )
    if (routeCompletionTime <= replayEndEpochMs) {
      events.push({
        type: EVENT_TYPES.ROUTE_COMPLETION,
        atEpochMs: Math.max(replayStartEpochMs, routeCompletionTime),
        targetIndex: Number.MAX_SAFE_INTEGER,
      })
    }
  }

  if (roundEndsAtEpochMs <= replayEndEpochMs) {
    events.push({
      type: EVENT_TYPES.ROUND_END,
      atEpochMs: roundEndsAtEpochMs,
      targetIndex: Number.MAX_SAFE_INTEGER,
    })
  }
  return events.sort(compareSoloRouteEvents)
}

function stopMovement(state, plan, sourceCheckpoint, atEpochMs) {
  if (!state.movement) {
    return state
  }
  return {
    ...state,
    movement: null,
    player: {
      ...state.player,
      settledPosition: positionAt(plan, sourceCheckpoint, atEpochMs),
    },
  }
}

function applyTimelineEvents({
  checkpoint,
  plan,
  events,
  replayEndEpochMs,
  createCatchId,
}) {
  let state = checkpoint
  let movementActive = Boolean(plan && checkpoint.movement)
  let eventIndex = 0

  while (eventIndex < events.length) {
    const groupTime = events[eventIndex].atEpochMs
    const group = []
    while (
      eventIndex < events.length &&
      Math.abs(events[eventIndex].atEpochMs - groupTime) <
        SOLO_ROUTE_EVENT_TIME_EPSILON_MS
    ) {
      group.push(events[eventIndex])
      eventIndex += 1
    }

    if (group.some((event) => event.type === EVENT_TYPES.ROUND_END)) {
      if (movementActive) {
        state = stopMovement(state, plan, checkpoint, groupTime)
        movementActive = false
      }
      continue
    }

    for (const event of group.filter(
      (candidate) => candidate.type === EVENT_TYPES.TARGET_EXPIRY,
    )) {
      const chasedTargetId = state.movement?.purpose ===
          SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE
        ? state.movement.chasedTargetId
        : null
      const transition = applySoloTargetExpiryTransition(state, {
        targetId: event.targetId,
        settledPosition: movementActive
          ? positionAt(plan, checkpoint, groupTime)
          : state.player.settledPosition,
      })
      state = transition.state
      if (movementActive && chasedTargetId === event.targetId) {
        movementActive = false
      }
    }

    if (
      movementActive &&
      group.some((event) => event.type === EVENT_TYPES.ROUTE_COMPLETION)
    ) {
      state = stopMovement(state, plan, checkpoint, groupTime)
      movementActive = false
    }

    if (movementActive) {
      const chasedTargetId = state.movement?.purpose ===
          SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE
        ? state.movement.chasedTargetId
        : null
      let chasedCaught = false
      for (const event of group.filter(
        (candidate) => candidate.type === EVENT_TYPES.TARGET_CATCH,
      )) {
        const transition = applySoloTargetCatchTransition(state, {
          targetId: event.targetId,
          caughtAtEpochMs: groupTime,
          settledPosition: sampleRoutePosition(
            plan,
            event.catchDistanceMeters,
          ),
          createCatchId,
        })
        state = transition.state
        if (transition.changed && chasedTargetId === event.targetId) {
          chasedCaught = true
        }
      }
      if (chasedCaught) {
        movementActive = false
      }
    }
  }

  if (movementActive && state.movement) {
    const distanceAtRecovery = movementDistanceAt(
      plan,
      checkpoint,
      replayEndEpochMs,
    )
    state = {
      ...state,
      player: {
        ...state.player,
        settledPosition: sampleRoutePosition(plan, distanceAtRecovery),
      },
      movement: {
        ...state.movement,
        anchorDistanceMeters: distanceAtRecovery,
        anchorTimeEpochMs: replayEndEpochMs,
      },
    }
  }

  return state
}

export function reconcileSoloTargetRecoveryTimeline(
  checkpoint,
  {
    nowEpochMs,
    roundEndsAtEpochMs = checkpoint.round.endsAtEpochMs,
    createCatchId = createSoloPendingCatchId,
  },
) {
  const normalizedTargets = normalizeSoloTargetCollections(checkpoint)
  let state = cloneCheckpointState(checkpoint, normalizedTargets)
  const effectiveRoundEnd = Math.min(
    checkpoint.round.endsAtEpochMs,
    roundEndsAtEpochMs,
  )
  const replayEndEpochMs = Math.min(nowEpochMs, effectiveRoundEnd)
  const replayStartEpochMs = Math.min(
    replayEndEpochMs,
    Math.max(checkpoint.round.startedAtEpochMs, checkpoint.updatedAtEpochMs),
  )
  let plan = null

  if (state.movement?.purpose === SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE) {
    const chasedTarget = state.targets.find(
      (target) => target.id === state.movement.chasedTargetId,
    )
    if (!chasedTarget) {
      state.movement = null
    } else {
      state.movement.destination = {
        lat: chasedTarget.lat,
        lon: chasedTarget.lon,
      }
    }
  }

  if (state.movement?.phase === SOLO_RECOVERY_MOVEMENT_PHASES.MOVING) {
    plan = createRouteAnimationPlan(state.movement.routeCoordinates)
  }
  const events = createTimelineEvents({
    checkpoint: state,
    plan,
    replayStartEpochMs,
    replayEndEpochMs,
    roundEndsAtEpochMs: effectiveRoundEnd,
  })
  state = applyTimelineEvents({
    checkpoint: state,
    plan,
    events,
    replayEndEpochMs,
    createCatchId,
  })
  state.spawning = reconcileSpawnSchedule(
    state.spawning,
    nowEpochMs,
    effectiveRoundEnd,
  )

  if (
    state.movement?.purpose === SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE &&
    !state.targets.some((target) => target.id === state.movement.chasedTargetId)
  ) {
    state.movement = null
  }
  const comparableBefore = JSON.stringify(checkpoint)
  if (JSON.stringify(state) !== comparableBefore) {
    state.updatedAtEpochMs = Math.max(
      checkpoint.createdAtEpochMs,
      checkpoint.round.startedAtEpochMs,
      Math.min(
        replayEndEpochMs,
        checkpoint.round.endsAtEpochMs - 1,
      ),
    )
  }

  return {
    checkpoint: state,
    changed: JSON.stringify(state) !== comparableBefore,
    replayStartEpochMs,
    replayEndEpochMs,
    events,
  }
}
