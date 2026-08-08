import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SIMULATION_SPEED } from '../config/gameConfig.js'

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
    timestampMs,
  }
}

export function useRouteAnimation({
  speedMetersPerSecond = DEFAULT_SIMULATION_SPEED,
  startDelayMs = 0,
  onPositionChange,
  onNavigationFrame,
}) {
  const [isMoving, setIsMoving] = useState(false)
  const frameIdRef = useRef(null)
  const startTimerIdRef = useRef(null)
  const animationRef = useRef(null)
  const routeRevisionRef = useRef(0)
  const mountedRef = useRef(true)
  const onPositionChangeRef = useRef(onPositionChange)
  const onNavigationFrameRef = useRef(onNavigationFrame)
  const speedMetersPerSecondRef = useRef(speedMetersPerSecond)
  const startDelayMsRef = useRef(startDelayMs)

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  useEffect(() => {
    onNavigationFrameRef.current = onNavigationFrame
  }, [onNavigationFrame])

  useEffect(() => {
    speedMetersPerSecondRef.current = speedMetersPerSecond
  }, [speedMetersPerSecond])

  useEffect(() => {
    startDelayMsRef.current = startDelayMs
  }, [startDelayMs])

  const emitFrame = useCallback((animation, moving, timestampMs) => {
    const frame = createRouteNavigationFrame(
      animation.plan,
      animation.distanceTraveledMeters,
      {
        isMoving: moving,
        speedMetersPerSecond: speedMetersPerSecondRef.current,
        timestampMs,
      },
    )

    animation.lastFrame = frame
    onNavigationFrameRef.current?.(frame)
    return frame
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

  const cancelAnimation = useCallback(() => {
    const animation = animationRef.current

    clearScheduledWork()
    animationRef.current = null
    routeRevisionRef.current += 1

    if (animation) {
      emitFrame(animation, false, performance.now())
    }

    if (mountedRef.current) {
      setIsMoving(false)
    }
  }, [clearScheduledWork, emitFrame])

  const startAnimation = useCallback(
    (routeCoordinates, onComplete) => {
      cancelAnimation()

      const routeRevision = routeRevisionRef.current + 1
      routeRevisionRef.current = routeRevision
      const plan = createRouteAnimationPlan(routeCoordinates, routeRevision)

      if (!plan) {
        return false
      }

      const now = performance.now()
      const animation = {
        plan,
        distanceTraveledMeters: 0,
        lastTimestampMs: null,
        lastFrame: null,
        onComplete,
      }

      if (plan.totalDistanceMeters <= 0) {
        onPositionChangeRef.current?.(plan.finalPosition)
        emitFrame(animation, false, now)
        onComplete?.()
        return true
      }

      animationRef.current = animation
      emitFrame(animation, false, now)

      function finishAnimation(timestampMs) {
        const currentAnimation = animationRef.current

        if (
          !currentAnimation ||
          currentAnimation.plan.routeRevision !== routeRevision
        ) {
          return
        }

        currentAnimation.distanceTraveledMeters =
          currentAnimation.plan.totalDistanceMeters
        const frame = emitFrame(currentAnimation, false, timestampMs)
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

        const elapsedSeconds = Math.max(
          0,
          (timestampMs - currentAnimation.lastTimestampMs) / 1000,
        )
        currentAnimation.lastTimestampMs = timestampMs
        const speed = Number.isFinite(speedMetersPerSecondRef.current)
          ? Math.max(0, speedMetersPerSecondRef.current)
          : 0
        currentAnimation.distanceTraveledMeters += elapsedSeconds * speed

        if (
          currentAnimation.distanceTraveledMeters >=
          currentAnimation.plan.totalDistanceMeters
        ) {
          finishAnimation(timestampMs)
          return
        }

        const frame = emitFrame(currentAnimation, true, timestampMs)
        onPositionChangeRef.current?.(frame.position)
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

        currentAnimation.lastTimestampMs = performance.now()
        if (mountedRef.current) {
          setIsMoving(true)
        }
        emitFrame(currentAnimation, true, currentAnimation.lastTimestampMs)
        frameIdRef.current = requestAnimationFrame(step)
      }

      const delayMs = Math.max(0, Number(startDelayMsRef.current) || 0)

      if (delayMs > 0) {
        startTimerIdRef.current = window.setTimeout(beginAnimation, delayMs)
      } else {
        beginAnimation()
      }

      return true
    },
    [cancelAnimation, emitFrame],
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
  }
}
