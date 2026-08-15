import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SIMULATION_SPEED } from '../config/gameConfig.js'
import { SOLO_NAVIGATION_START_KINDS } from './navigationFrameChannel.js'

const EARTH_RADIUS_METERS = 6371000
const MIN_HEADING_SAMPLE_METERS = 2
export const DEFAULT_ROUTE_NAVIGATION_FRAME_PROFILE = Object.freeze({
  minLookAheadMeters: 20,
  maxLookAheadMeters: 80,
  lookAheadSeconds: 0.45,
})

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeMovementSpeed(speedMetersPerSecond) {
  return Number.isFinite(speedMetersPerSecond)
    ? Math.max(0, speedMetersPerSecond)
    : 0
}

export function createRouteMovementAnchor({
  anchorDistanceMeters = 0,
  anchorTimeEpochMs,
  speedMetersPerSecond = DEFAULT_SIMULATION_SPEED,
}) {
  if (!Number.isFinite(anchorDistanceMeters) || anchorDistanceMeters < 0) {
    throw new TypeError('anchorDistanceMeters must be non-negative')
  }

  if (!Number.isFinite(anchorTimeEpochMs) || anchorTimeEpochMs < 0) {
    throw new TypeError('anchorTimeEpochMs must be a non-negative timestamp')
  }

  return {
    anchorDistanceMeters,
    anchorTimeEpochMs,
    speedMetersPerSecond: normalizeMovementSpeed(speedMetersPerSecond),
  }
}

export function calculateAnchoredRouteDistanceMeters(
  anchor,
  atEpochMs,
  totalRouteDistanceMeters,
  { minimumDistanceMeters = anchor?.anchorDistanceMeters ?? 0 } = {},
) {
  if (!anchor) {
    throw new TypeError('A movement anchor is required')
  }

  if (!Number.isFinite(atEpochMs) || atEpochMs < 0) {
    throw new TypeError('atEpochMs must be a non-negative timestamp')
  }

  const totalDistance = Number.isFinite(totalRouteDistanceMeters)
    ? Math.max(0, totalRouteDistanceMeters)
    : 0
  const elapsedSeconds = Math.max(
    0,
    (atEpochMs - anchor.anchorTimeEpochMs) / 1000,
  )
  const distanceMeters =
    anchor.anchorDistanceMeters +
    elapsedSeconds * normalizeMovementSpeed(anchor.speedMetersPerSecond)

  return clamp(
    Math.max(minimumDistanceMeters, distanceMeters),
    0,
    totalDistance,
  )
}

export function reconstructAnchoredRouteMovement(
  plan,
  anchor,
  atEpochMs,
  options,
) {
  if (!plan) {
    return null
  }

  const distanceTraveledMeters = calculateAnchoredRouteDistanceMeters(
    anchor,
    atEpochMs,
    plan.totalDistanceMeters,
    options,
  )

  return {
    distanceTraveledMeters,
    position: sampleRoutePosition(plan, distanceTraveledMeters),
    isComplete: distanceTraveledMeters >= plan.totalDistanceMeters,
  }
}

export function reanchorRouteMovement(
  plan,
  anchor,
  nextSpeedMetersPerSecond,
  atEpochMs,
  {
    minimumDistanceMeters = anchor?.anchorDistanceMeters ?? 0,
    minimumEpochMs = anchor?.anchorTimeEpochMs ?? 0,
  } = {},
) {
  if (!plan) {
    throw new TypeError('A measured route plan is required')
  }

  const effectiveEpochMs = Math.max(atEpochMs, minimumEpochMs)
  const anchorDistanceMeters = calculateAnchoredRouteDistanceMeters(
    anchor,
    effectiveEpochMs,
    plan.totalDistanceMeters,
    { minimumDistanceMeters },
  )

  return createRouteMovementAnchor({
    anchorDistanceMeters,
    // A speed change during the MapLibre prelude must not pull a scheduled
    // future movement start forward to the current time.
    anchorTimeEpochMs: Math.max(effectiveEpochMs, anchor.anchorTimeEpochMs),
    speedMetersPerSecond: nextSpeedMetersPerSecond,
  })
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI
}

function isValidRouteCoordinate(coordinate) {
  return (
    Array.isArray(coordinate) &&
    coordinate.length >= 2 &&
    Number.isFinite(coordinate[0]) &&
    coordinate[0] >= -90 &&
    coordinate[0] <= 90 &&
    Number.isFinite(coordinate[1]) &&
    coordinate[1] >= -180 &&
    coordinate[1] <= 180
  )
}

export function getRouteDistanceMeters(start, end) {
  const [startLat, startLon] = start
  const [endLat, endLon] = end
  const latDelta = toRadians(endLat - startLat)
  const lonDelta = toRadians(endLon - startLon)
  const startLatRadians = toRadians(startLat)
  const endLatRadians = toRadians(endLat)

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLatRadians) *
      Math.cos(endLatRadians) *
      Math.sin(lonDelta / 2) ** 2

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  )
}

function getRouteBearingDegrees(start, end) {
  const startLat = toRadians(start[0])
  const endLat = toRadians(end[0])
  const longitudeDelta = toRadians(end[1] - start[1])
  const y = Math.sin(longitudeDelta) * Math.cos(endLat)
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(longitudeDelta)

  if (Math.abs(x) < Number.EPSILON && Math.abs(y) < Number.EPSILON) {
    return null
  }

  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

function toPlayerPosition([lat, lon]) {
  return { lat, lon }
}

function interpolateCoordinate(start, end, progress) {
  return [
    start[0] + (end[0] - start[0]) * progress,
    start[1] + (end[1] - start[1]) * progress,
  ]
}

export function createRouteAnimationPlan(routeCoordinates, routeRevision = 0) {
  if (
    !Array.isArray(routeCoordinates) ||
    routeCoordinates.length === 0 ||
    routeCoordinates.some((coordinate) => !isValidRouteCoordinate(coordinate))
  ) {
    return null
  }

  const coordinates = routeCoordinates.map(([lat, lon]) => [lat, lon])
  const segments = []
  let totalDistanceMeters = 0

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]
    const end = coordinates[index + 1]
    const distanceMeters = getRouteDistanceMeters(start, end)

    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      continue
    }

    const startDistanceMeters = totalDistanceMeters
    totalDistanceMeters += distanceMeters
    segments.push({
      start,
      end,
      distanceMeters,
      startDistanceMeters,
      endDistanceMeters: totalDistanceMeters,
    })
  }

  return {
    routeRevision,
    coordinates,
    segments,
    totalDistanceMeters,
    initialPosition: toPlayerPosition(coordinates[0]),
    finalPosition: toPlayerPosition(coordinates[coordinates.length - 1]),
  }
}

function findRouteSegment(segments, distanceMeters) {
  let low = 0
  let high = segments.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]

    if (distanceMeters < segment.startDistanceMeters) {
      high = middle - 1
    } else if (distanceMeters > segment.endDistanceMeters) {
      low = middle + 1
    } else {
      return segment
    }
  }

  return segments[Math.min(low, segments.length - 1)] || null
}

export function sampleRoutePosition(plan, requestedDistanceMeters) {
  if (!plan) {
    return null
  }

  if (plan.totalDistanceMeters <= 0 || plan.segments.length === 0) {
    return plan.finalPosition
  }

  const distanceMeters = clamp(
    Number(requestedDistanceMeters) || 0,
    0,
    plan.totalDistanceMeters,
  )
  const segment = findRouteSegment(plan.segments, distanceMeters)

  if (!segment) {
    return plan.finalPosition
  }

  const segmentProgress = clamp(
    (distanceMeters - segment.startDistanceMeters) /
      segment.distanceMeters,
    0,
    1,
  )

  return toPlayerPosition(
    interpolateCoordinate(segment.start, segment.end, segmentProgress),
  )
}

function toCoordinate(position) {
  return [position.lat, position.lon]
}

export function getRouteLookAheadDistanceMeters(
  speedMetersPerSecond,
  distanceRemainingMeters = Number.POSITIVE_INFINITY,
  profile = DEFAULT_ROUTE_NAVIGATION_FRAME_PROFILE,
) {
  const speed = Number.isFinite(speedMetersPerSecond)
    ? Math.max(0, speedMetersPerSecond)
    : 0
  const remainingDistance = Number.isFinite(distanceRemainingMeters)
    ? Math.max(0, distanceRemainingMeters)
    : Number.POSITIVE_INFINITY
  const speedLookAheadDistance = clamp(
    speed * profile.lookAheadSeconds,
    profile.minLookAheadMeters,
    profile.maxLookAheadMeters,
  )

  return Math.min(speedLookAheadDistance, remainingDistance)
}

export function createRouteNavigationFrame(
  plan,
  requestedDistanceMeters,
  {
    isMoving = false,
    navigationStartKind = SOLO_NAVIGATION_START_KINDS.FRESH,
    speedMetersPerSecond = DEFAULT_SIMULATION_SPEED,
    timestampMs = 0,
  } = {},
) {
  if (!plan) {
    return null
  }

  const totalDistanceMeters = plan.totalDistanceMeters
  const distanceTraveledMeters = clamp(
    Number(requestedDistanceMeters) || 0,
    0,
    totalDistanceMeters,
  )
  const distanceRemainingMeters = Math.max(
    0,
    totalDistanceMeters - distanceTraveledMeters,
  )
  const progress =
    totalDistanceMeters > 0
      ? distanceTraveledMeters / totalDistanceMeters
      : 1
  const position = sampleRoutePosition(plan, distanceTraveledMeters)
  const navigationSpeedMetersPerSecond = Number.isFinite(
    speedMetersPerSecond,
  )
    ? Math.max(0, speedMetersPerSecond)
    : 0
  const configuredLookAheadDistanceMeters =
    getRouteLookAheadDistanceMeters(navigationSpeedMetersPerSecond)
  const lookAheadDistanceMeters = getRouteLookAheadDistanceMeters(
    navigationSpeedMetersPerSecond,
    distanceRemainingMeters,
  )
  const lookAheadPosition = sampleRoutePosition(
    plan,
    distanceTraveledMeters + lookAheadDistanceMeters,
  )
  let headingStartDistance = Math.max(
    0,
    distanceTraveledMeters -
      Math.min(10, configuredLookAheadDistanceMeters / 3),
  )
  let headingEndDistance = Math.min(
    totalDistanceMeters,
    distanceTraveledMeters + configuredLookAheadDistanceMeters,
  )

  if (
    headingEndDistance - headingStartDistance <
      MIN_HEADING_SAMPLE_METERS &&
    totalDistanceMeters >= MIN_HEADING_SAMPLE_METERS
  ) {
    headingStartDistance = Math.max(
      0,
      totalDistanceMeters - configuredLookAheadDistanceMeters,
    )
    headingEndDistance = totalDistanceMeters
  }

  const headingStart = sampleRoutePosition(plan, headingStartDistance)
  const headingEnd = sampleRoutePosition(plan, headingEndDistance)
  const headingDistanceMeters =
    headingStart && headingEnd
      ? getRouteDistanceMeters(
          toCoordinate(headingStart),
          toCoordinate(headingEnd),
        )
      : 0
  const bearingDegrees =
    headingDistanceMeters >= MIN_HEADING_SAMPLE_METERS
      ? getRouteBearingDegrees(
          toCoordinate(headingStart),
          toCoordinate(headingEnd),
        )
      : null

  return {
    routeRevision: plan.routeRevision,
    position,
    bearingDegrees,
    lookAheadPosition,
    lookAheadDistanceMeters,
    speedMetersPerSecond: navigationSpeedMetersPerSecond,
    progress,
    distanceTraveledMeters,
    distanceRemainingMeters,
    totalDistanceMeters,
    isMoving: Boolean(isMoving && distanceRemainingMeters > 0),
    navigationStartKind,
    timestampMs,
  }
}

export function useRouteAnimation({
  speedMetersPerSecond = DEFAULT_SIMULATION_SPEED,
  startDelayMs = 0,
  onPositionChange,
  onNavigationFrame,
  resolveRouteInterval,
  onRouteIntervalEvents,
  onMovementAnchorChange,
  getEpochTimeMs = Date.now,
}) {
  const [isMoving, setIsMoving] = useState(false)
  const frameIdRef = useRef(null)
  const startTimerIdRef = useRef(null)
  const animationRef = useRef(null)
  const routeRevisionRef = useRef(0)
  const mountedRef = useRef(true)
  const onPositionChangeRef = useRef(onPositionChange)
  const onNavigationFrameRef = useRef(onNavigationFrame)
  const resolveRouteIntervalRef = useRef(resolveRouteInterval)
  const onRouteIntervalEventsRef = useRef(onRouteIntervalEvents)
  const onMovementAnchorChangeRef = useRef(onMovementAnchorChange)
  const speedMetersPerSecondRef = useRef(speedMetersPerSecond)
  const startDelayMsRef = useRef(startDelayMs)
  const getEpochTimeMsRef = useRef(getEpochTimeMs)

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  useEffect(() => {
    onNavigationFrameRef.current = onNavigationFrame
  }, [onNavigationFrame])

  useEffect(() => {
    resolveRouteIntervalRef.current = resolveRouteInterval
    onRouteIntervalEventsRef.current = onRouteIntervalEvents
  }, [onRouteIntervalEvents, resolveRouteInterval])

  useEffect(() => {
    onMovementAnchorChangeRef.current = onMovementAnchorChange
  }, [onMovementAnchorChange])

  useEffect(() => {
    startDelayMsRef.current = startDelayMs
  }, [startDelayMs])

  useEffect(() => {
    getEpochTimeMsRef.current = getEpochTimeMs
  }, [getEpochTimeMs])

  const emitFrame = useCallback((
    animation,
    moving,
    timestampMs,
    epochTimeMs = getEpochTimeMsRef.current(),
    { resolveInterval = false } = {},
  ) => {
    const effectiveEpochTimeMs = Math.max(
      epochTimeMs,
      animation.lastResolvedEpochMs,
    )
    const previousDistanceMeters = animation.distanceTraveledMeters
    const proposedDistanceMeters = calculateAnchoredRouteDistanceMeters(
      animation.anchor,
      effectiveEpochTimeMs,
      animation.plan.totalDistanceMeters,
      { minimumDistanceMeters: previousDistanceMeters },
    )
    let intervalResult = null
    if (
      resolveInterval &&
      proposedDistanceMeters > previousDistanceMeters
    ) {
      try {
        intervalResult = resolveRouteIntervalRef.current?.({
          plan: animation.plan,
          previousDistanceMeters,
          proposedDistanceMeters,
          previousEpochTimeMs: animation.lastResolvedEpochMs,
          proposedEpochTimeMs: effectiveEpochTimeMs,
          movementAnchor: { ...animation.anchor },
        }) ?? null
      } catch (error) {
        console.error('Route interval resolver failed:', error)
      }
    }
    const terminalDistanceMeters = intervalResult?.terminal?.distanceMeters
    const hasValidTerminal =
      Number.isFinite(terminalDistanceMeters) &&
      terminalDistanceMeters >= previousDistanceMeters &&
      terminalDistanceMeters <= proposedDistanceMeters
    if (intervalResult?.terminal && !hasValidTerminal) {
      intervalResult = { ...intervalResult, terminal: null }
    }
    animation.distanceTraveledMeters =
      hasValidTerminal
        ? terminalDistanceMeters
        : proposedDistanceMeters
    const terminalEpochTimeMs = Number.isFinite(
      intervalResult?.terminal?.atEpochMs,
    )
      ? intervalResult.terminal.atEpochMs
      : effectiveEpochTimeMs
    animation.lastResolvedEpochMs = hasValidTerminal
      ? Math.max(
          animation.lastResolvedEpochMs,
          Math.min(effectiveEpochTimeMs, terminalEpochTimeMs),
        )
      : effectiveEpochTimeMs
    const frame = createRouteNavigationFrame(
      animation.plan,
      animation.distanceTraveledMeters,
      {
        isMoving: moving && !hasValidTerminal,
        navigationStartKind: animation.navigationStartKind,
        speedMetersPerSecond: animation.anchor.speedMetersPerSecond,
        timestampMs,
      },
    )

    animation.lastFrame = frame
    onNavigationFrameRef.current?.(frame)
    return {
      frame,
      intervalResult,
      didAdvance: animation.distanceTraveledMeters > previousDistanceMeters,
    }
  }, [])

  const dispatchRouteIntervalEvents = useCallback((intervalResult, frame) => {
    if (!intervalResult?.entries?.length && !intervalResult?.terminal) {
      return
    }

    try {
      onRouteIntervalEventsRef.current?.(intervalResult, frame)
    } catch (error) {
      console.error('Route interval event handler failed:', error)
    }
  }, [])

  const clearScheduledWork = useCallback(() => {
    if (frameIdRef.current !== null) {
      cancelAnimationFrame(frameIdRef.current)
      frameIdRef.current = null
    }

    if (startTimerIdRef.current !== null) {
      window.clearTimeout(startTimerIdRef.current)
      startTimerIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const nextSpeed = normalizeMovementSpeed(speedMetersPerSecond)
    const animation = animationRef.current

    if (
      animation &&
      animation.anchor.speedMetersPerSecond !== nextSpeed
    ) {
      const { frame, intervalResult, didAdvance } = emitFrame(
        animation,
        true,
        performance.now(),
        undefined,
        { resolveInterval: true },
      )
      if (didAdvance) {
        onPositionChangeRef.current?.(frame.position)
      }

      if (intervalResult?.terminal) {
        clearScheduledWork()
        animationRef.current = null
        if (mountedRef.current) {
          setIsMoving(false)
        }
        dispatchRouteIntervalEvents(intervalResult, frame)
      } else {
        dispatchRouteIntervalEvents(intervalResult, frame)
        animation.anchor = createRouteMovementAnchor({
          anchorDistanceMeters: frame.distanceTraveledMeters,
          anchorTimeEpochMs: animation.lastResolvedEpochMs,
          speedMetersPerSecond: nextSpeed,
        })
        onMovementAnchorChangeRef.current?.({ ...animation.anchor })
      }
    }

    speedMetersPerSecondRef.current = nextSpeed
  }, [
    clearScheduledWork,
    dispatchRouteIntervalEvents,
    emitFrame,
    speedMetersPerSecond,
  ])

  const cancelAnimation = useCallback(({
    settleAtEpochMs,
  } = {}) => {
    const animation = animationRef.current

    clearScheduledWork()
    routeRevisionRef.current += 1

    if (animation) {
      const currentEpochTimeMs = getEpochTimeMsRef.current()
      const settlementEpochTimeMs = Number.isFinite(settleAtEpochMs)
        ? Math.max(
            animation.lastResolvedEpochMs,
            Math.min(currentEpochTimeMs, settleAtEpochMs),
          )
        : currentEpochTimeMs
      const { frame, intervalResult } = emitFrame(
        animation,
        false,
        performance.now(),
        settlementEpochTimeMs,
        { resolveInterval: true },
      )
      animationRef.current = null
      onPositionChangeRef.current?.(frame.position)

      if (mountedRef.current) {
        setIsMoving(false)
      }
      dispatchRouteIntervalEvents(intervalResult, frame)

      return {
        position: frame.position,
        movementAnchor: createRouteMovementAnchor({
          anchorDistanceMeters: frame.distanceTraveledMeters,
          anchorTimeEpochMs: animation.lastResolvedEpochMs,
          speedMetersPerSecond: animation.anchor.speedMetersPerSecond,
        }),
      }
    }

    if (mountedRef.current) {
      setIsMoving(false)
    }

    return null
  }, [clearScheduledWork, dispatchRouteIntervalEvents, emitFrame])

  const getMovementAnchorSnapshot = useCallback(({
    resolveInterval = false,
  } = {}) => {
    const animation = animationRef.current

    if (!animation) {
      return null
    }

    let frame = animation.lastFrame
    if (resolveInterval) {
      const resolved = emitFrame(
        animation,
        true,
        performance.now(),
        undefined,
        { resolveInterval: true },
      )
      frame = resolved.frame
      if (resolved.didAdvance) {
        onPositionChangeRef.current?.(frame.position)
      }
      if (resolved.intervalResult?.terminal) {
        clearScheduledWork()
        animationRef.current = null
        if (mountedRef.current) {
          setIsMoving(false)
        }
        dispatchRouteIntervalEvents(resolved.intervalResult, frame)
        return null
      }
      dispatchRouteIntervalEvents(resolved.intervalResult, frame)
    }
    if (!frame) {
      return null
    }
    const movementAnchor = createRouteMovementAnchor({
      anchorDistanceMeters: frame.distanceTraveledMeters,
      anchorTimeEpochMs: animation.lastResolvedEpochMs,
      speedMetersPerSecond: animation.anchor.speedMetersPerSecond,
    })

    animation.anchor = movementAnchor
    return movementAnchor
  }, [clearScheduledWork, dispatchRouteIntervalEvents, emitFrame])

  const startAnimation = useCallback(
    (routeCoordinates, onComplete, {
      movementAnchor = null,
      navigationStartKind = SOLO_NAVIGATION_START_KINDS.FRESH,
    } = {}) => {
      cancelAnimation()

      const routeRevision = routeRevisionRef.current + 1
      routeRevisionRef.current = routeRevision
      const plan = createRouteAnimationPlan(routeCoordinates, routeRevision)

      if (!plan) {
        return false
      }

      const frameNow = performance.now()
      const epochNow = getEpochTimeMsRef.current()
      const delayMs = movementAnchor
        ? Math.max(0, movementAnchor.anchorTimeEpochMs - epochNow)
        : Math.max(0, Number(startDelayMsRef.current) || 0)
      const animation = {
        plan,
        navigationStartKind:
          navigationStartKind ===
            SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE
            ? SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE
            : SOLO_NAVIGATION_START_KINDS.FRESH,
        anchor: movementAnchor
          ? createRouteMovementAnchor(movementAnchor)
          : createRouteMovementAnchor({
              anchorDistanceMeters: 0,
              anchorTimeEpochMs: epochNow + delayMs,
              speedMetersPerSecond: speedMetersPerSecondRef.current,
            }),
        distanceTraveledMeters: 0,
        lastResolvedEpochMs: movementAnchor
          ? movementAnchor.anchorTimeEpochMs
          : epochNow + delayMs,
        lastFrame: null,
        onComplete,
      }

      if (plan.totalDistanceMeters <= 0) {
        onPositionChangeRef.current?.(plan.finalPosition)
        emitFrame(animation, false, frameNow, epochNow)
        onComplete?.()
        return true
      }

      animationRef.current = animation
      const { frame: initialFrame } = emitFrame(
        animation,
        false,
        frameNow,
        epochNow,
      )

      if (initialFrame.progress >= 1) {
        animationRef.current = null
        onPositionChangeRef.current?.(initialFrame.position)
        onComplete?.()
        return true
      }

      function finishAnimation(timestampMs) {
        const currentAnimation = animationRef.current

        if (
          !currentAnimation ||
          currentAnimation.plan.routeRevision !== routeRevision
        ) {
          return
        }

        const completionEpochMs = Math.max(
          getEpochTimeMsRef.current(),
          currentAnimation.lastResolvedEpochMs,
        )
        currentAnimation.anchor = createRouteMovementAnchor({
          anchorDistanceMeters: currentAnimation.plan.totalDistanceMeters,
          anchorTimeEpochMs: completionEpochMs,
          speedMetersPerSecond:
            currentAnimation.anchor.speedMetersPerSecond,
        })
        const { frame } = emitFrame(
          currentAnimation,
          false,
          timestampMs,
        )
        onPositionChangeRef.current?.(frame.position)
        const completion = currentAnimation.onComplete

        animationRef.current = null
        frameIdRef.current = null
        if (mountedRef.current) {
          setIsMoving(false)
        }
        completion?.()
      }

      function step(timestampMs) {
        const currentAnimation = animationRef.current

        if (
          !currentAnimation ||
          currentAnimation.plan.routeRevision !== routeRevision
        ) {
          return
        }

        const { frame, intervalResult } = emitFrame(
          currentAnimation,
          true,
          timestampMs,
          undefined,
          { resolveInterval: true },
        )

        if (intervalResult?.terminal) {
          animationRef.current = null
          frameIdRef.current = null
          if (mountedRef.current) {
            setIsMoving(false)
          }
          onPositionChangeRef.current?.(frame.position)
          dispatchRouteIntervalEvents(intervalResult, frame)
          return
        }

        if (frame.progress >= 1) {
          onPositionChangeRef.current?.(frame.position)
          dispatchRouteIntervalEvents(intervalResult, frame)
          finishAnimation(timestampMs)
          return
        }

        onPositionChangeRef.current?.(frame.position)
        dispatchRouteIntervalEvents(intervalResult, frame)
        frameIdRef.current = requestAnimationFrame(step)
      }

      function beginAnimation() {
        startTimerIdRef.current = null
        const currentAnimation = animationRef.current

        if (
          !currentAnimation ||
          currentAnimation.plan.routeRevision !== routeRevision
        ) {
          return
        }

        const timestampMs = performance.now()
        const { frame } = emitFrame(currentAnimation, true, timestampMs)

        if (frame.progress >= 1) {
          finishAnimation(timestampMs)
          return
        }

        if (mountedRef.current) {
          setIsMoving(true)
        }
        frameIdRef.current = requestAnimationFrame(step)
      }

      if (delayMs > 0) {
        startTimerIdRef.current = window.setTimeout(beginAnimation, delayMs)
      } else {
        beginAnimation()
      }

      return true
    },
    [cancelAnimation, dispatchRouteIntervalEvents, emitFrame],
  )

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      clearScheduledWork()
      animationRef.current = null
      routeRevisionRef.current += 1
    }
  }, [clearScheduledWork])

  return {
    isMoving,
    simulationSpeed: speedMetersPerSecond,
    startAnimation,
    cancelAnimation,
    getMovementAnchorSnapshot,
  }
}
