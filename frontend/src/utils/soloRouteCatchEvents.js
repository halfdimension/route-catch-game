import { findEarliestSoloRouteCatchDistance } from './soloCatchGeometry.js'

const DISTANCE_EPSILON_METERS = 0.000001
export const SOLO_ROUTE_EVENT_TIME_EPSILON_MS = 0.0001

export const SOLO_ROUTE_EVENT_TYPES = Object.freeze({
  ROUND_END: 'ROUND_END',
  TARGET_EXPIRY: 'TARGET_EXPIRY',
  ROUTE_COMPLETION: 'ROUTE_COMPLETION',
  TARGET_CATCH: 'TARGET_CATCH',
})

export const SOLO_ROUTE_EVENT_PRIORITY = Object.freeze({
  [SOLO_ROUTE_EVENT_TYPES.ROUND_END]: 0,
  [SOLO_ROUTE_EVENT_TYPES.TARGET_EXPIRY]: 1,
  [SOLO_ROUTE_EVENT_TYPES.ROUTE_COMPLETION]: 2,
  [SOLO_ROUTE_EVENT_TYPES.TARGET_CATCH]: 3,
})

export function compareSoloRouteEvents(first, second) {
  const timeDifference = first.atEpochMs - second.atEpochMs
  return (
    (
      Math.abs(timeDifference) >= SOLO_ROUTE_EVENT_TIME_EPSILON_MS
        ? timeDifference
        : 0
    ) ||
    SOLO_ROUTE_EVENT_PRIORITY[first.type] -
      SOLO_ROUTE_EVENT_PRIORITY[second.type] ||
    (first.targetIndex ?? Number.MAX_SAFE_INTEGER) -
      (second.targetIndex ?? Number.MAX_SAFE_INTEGER) ||
    String(first.targetId ?? '').localeCompare(String(second.targetId ?? ''))
  )
}

export function getSoloRouteTimeAtDistance(movementAnchor, distanceMeters) {
  const speedMetersPerSecond = movementAnchor?.speedMetersPerSecond
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) {
    return Number.POSITIVE_INFINITY
  }

  return movementAnchor.anchorTimeEpochMs +
    (
      distanceMeters - movementAnchor.anchorDistanceMeters
    ) / speedMetersPerSecond * 1000
}

export function getSoloRouteDistanceAtTime(
  movementAnchor,
  atEpochMs,
  totalDistanceMeters,
) {
  const elapsedSeconds = Math.max(
    0,
    (atEpochMs - movementAnchor.anchorTimeEpochMs) / 1000,
  )
  return Math.min(
    totalDistanceMeters,
    movementAnchor.anchorDistanceMeters +
      elapsedSeconds * movementAnchor.speedMetersPerSecond,
  )
}

export function findSoloRouteCatchEntries({
  plan,
  targets,
  startDistanceMeters,
  endDistanceMeters,
  windowStartEpochMs,
  windowEndEpochMs,
  movementAnchor,
  roundEndsAtEpochMs,
}) {
  if (
    !plan ||
    !Array.isArray(targets) ||
    targets.length === 0 ||
    !movementAnchor ||
    !Number.isFinite(movementAnchor.speedMetersPerSecond) ||
    movementAnchor.speedMetersPerSecond <= 0 ||
    endDistanceMeters < startDistanceMeters ||
    windowEndEpochMs < windowStartEpochMs
  ) {
    return []
  }

  const effectiveWindowStartEpochMs = Math.max(
    windowStartEpochMs,
    movementAnchor.anchorTimeEpochMs,
  )
  const routeCompletionEpochMs = getSoloRouteTimeAtDistance(
    movementAnchor,
    plan.totalDistanceMeters,
  )

  return targets.flatMap((target, targetIndex) => {
    const targetWindowStartEpochMs = Math.max(
      effectiveWindowStartEpochMs,
      target.spawnedAt,
    )
    if (
      targetWindowStartEpochMs >= target.expiresAt ||
      targetWindowStartEpochMs >= roundEndsAtEpochMs ||
      targetWindowStartEpochMs > windowEndEpochMs
    ) {
      return []
    }

    const targetStartDistanceMeters = Math.max(
      startDistanceMeters,
      getSoloRouteDistanceAtTime(
        movementAnchor,
        targetWindowStartEpochMs,
        plan.totalDistanceMeters,
      ),
    )
    const catchDistanceMeters = findEarliestSoloRouteCatchDistance(
      plan,
      target,
      {
        startDistanceMeters: targetStartDistanceMeters,
        endDistanceMeters,
      },
    )
    if (catchDistanceMeters === null) {
      return []
    }

    const caughtAtEpochMs = Math.max(
      targetWindowStartEpochMs,
      getSoloRouteTimeAtDistance(movementAnchor, catchDistanceMeters),
    )
    const catchesAtRouteCompletion =
      catchDistanceMeters >=
        plan.totalDistanceMeters - DISTANCE_EPSILON_METERS &&
      caughtAtEpochMs >= routeCompletionEpochMs

    if (
      caughtAtEpochMs >= target.expiresAt ||
      caughtAtEpochMs >= roundEndsAtEpochMs ||
      caughtAtEpochMs > windowEndEpochMs ||
      catchesAtRouteCompletion
    ) {
      return []
    }

    return [{
      target: structuredClone(target),
      targetId: target.id,
      targetIndex,
      catchDistanceMeters,
      caughtAtEpochMs,
    }]
  }).sort((first, second) => (
    first.caughtAtEpochMs - second.caughtAtEpochMs ||
    first.catchDistanceMeters - second.catchDistanceMeters ||
    first.targetIndex - second.targetIndex ||
    String(first.targetId).localeCompare(String(second.targetId))
  ))
}

export function resolveSoloLiveCatchInterval({
  chasedTargetId = null,
  ...options
}) {
  const entries = findSoloRouteCatchEntries(options)
  const {
    plan,
    targets,
    startDistanceMeters,
    endDistanceMeters,
    windowEndEpochMs,
    movementAnchor,
    roundEndsAtEpochMs,
  } = options
  const chasedTarget = chasedTargetId
    ? targets.find((target) => target.id === chasedTargetId)
    : null
  const routeCompletionEpochMs = getSoloRouteTimeAtDistance(
    movementAnchor,
    plan.totalDistanceMeters,
  )
  const terminalCandidates = entries
    .filter((entry) => entry.targetId === chasedTargetId)
    .map((entry) => ({
      type: SOLO_ROUTE_EVENT_TYPES.TARGET_CATCH,
      atEpochMs: entry.caughtAtEpochMs,
      distanceMeters: entry.catchDistanceMeters,
      targetId: entry.targetId,
      targetIndex: entry.targetIndex,
    }))

  if (roundEndsAtEpochMs <= windowEndEpochMs) {
    terminalCandidates.push({
      type: SOLO_ROUTE_EVENT_TYPES.ROUND_END,
      atEpochMs: roundEndsAtEpochMs,
      distanceMeters: getSoloRouteDistanceAtTime(
        movementAnchor,
        roundEndsAtEpochMs,
        plan.totalDistanceMeters,
      ),
    })
  }
  if (chasedTarget?.expiresAt <= windowEndEpochMs) {
    terminalCandidates.push({
      type: SOLO_ROUTE_EVENT_TYPES.TARGET_EXPIRY,
      atEpochMs: chasedTarget.expiresAt,
      distanceMeters: getSoloRouteDistanceAtTime(
        movementAnchor,
        chasedTarget.expiresAt,
        plan.totalDistanceMeters,
      ),
      targetId: chasedTarget.id,
      targetIndex: targets.indexOf(chasedTarget),
    })
  }
  if (routeCompletionEpochMs <= windowEndEpochMs) {
    terminalCandidates.push({
      type: SOLO_ROUTE_EVENT_TYPES.ROUTE_COMPLETION,
      atEpochMs: routeCompletionEpochMs,
      distanceMeters: plan.totalDistanceMeters,
    })
  }

  const terminalEvent = terminalCandidates.sort(compareSoloRouteEvents)[0] ?? null
  if (!terminalEvent) {
    return { entries, terminal: null, terminalEvent: null }
  }

  const entriesBeforeTerminal = entries.filter((entry) => {
    const timeDifference = entry.caughtAtEpochMs - terminalEvent.atEpochMs
    if (timeDifference < -SOLO_ROUTE_EVENT_TIME_EPSILON_MS) {
      return true
    }
    return (
      Math.abs(timeDifference) < SOLO_ROUTE_EVENT_TIME_EPSILON_MS &&
      terminalEvent.type === SOLO_ROUTE_EVENT_TYPES.TARGET_CATCH
    )
  })
  const boundedTerminalEvent = {
    ...terminalEvent,
    distanceMeters: Math.max(
      startDistanceMeters,
      Math.min(endDistanceMeters, terminalEvent.distanceMeters),
    ),
  }

  // Route completion is already the measured route's natural endpoint. It
  // participates in chronology/tie filtering here, while useRouteAnimation
  // retains its existing completion callback path when progress reaches 1.
  if (terminalEvent.type === SOLO_ROUTE_EVENT_TYPES.ROUTE_COMPLETION) {
    return {
      entries: entriesBeforeTerminal,
      terminal: null,
      terminalEvent: boundedTerminalEvent,
    }
  }

  return {
    entries: entriesBeforeTerminal,
    terminal: {
      ...boundedTerminalEvent,
    },
    terminalEvent: boundedTerminalEvent,
  }
}
