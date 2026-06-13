import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SIMULATION_SPEED } from '../config/gameConfig'

const EARTH_RADIUS_METERS = 6371000

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function getDistanceMeters(start, end) {
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

function toPlayerPosition([lat, lon]) {
  return { lat, lon }
}

function interpolatePoint(start, end, progress) {
  return {
    lat: start[0] + (end[0] - start[0]) * progress,
    lon: start[1] + (end[1] - start[1]) * progress,
  }
}

function buildSegments(routeCoordinates) {
  return routeCoordinates.slice(0, -1).map((start, index) => {
    const end = routeCoordinates[index + 1]

    return {
      start,
      end,
      distance: getDistanceMeters(start, end),
    }
  })
}

export function useRouteAnimation({
  speedMetersPerSecond = DEFAULT_SIMULATION_SPEED,
  onPositionChange,
}) {
  const [isMoving, setIsMoving] = useState(false)
  const frameIdRef = useRef(null)
  const animationRef = useRef(null)
  const onPositionChangeRef = useRef(onPositionChange)
  const speedMetersPerSecondRef = useRef(speedMetersPerSecond)

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange
  }, [onPositionChange])

  useEffect(() => {
    speedMetersPerSecondRef.current = speedMetersPerSecond
  }, [speedMetersPerSecond])

  const cancelAnimation = useCallback(() => {
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current)
      frameIdRef.current = null
    }

    animationRef.current = null
    setIsMoving(false)
  }, [])

  const startAnimation = useCallback(
    (routeCoordinates, onComplete) => {
      cancelAnimation()

      if (routeCoordinates.length === 0) {
        return
      }

      if (routeCoordinates.length === 1) {
        onPositionChangeRef.current(toPlayerPosition(routeCoordinates[0]))
        onComplete?.()
        return
      }

      const segments = buildSegments(routeCoordinates)
      const totalDistance = segments.reduce(
        (sum, segment) => sum + segment.distance,
        0,
      )
      const finalPosition = toPlayerPosition(
        routeCoordinates[routeCoordinates.length - 1],
      )

      if (totalDistance === 0) {
        onPositionChangeRef.current(finalPosition)
        onComplete?.()
        return
      }

      animationRef.current = {
        lastTimestamp: performance.now(),
        distanceTraveled: 0,
        segments,
        totalDistance,
        finalPosition,
        onComplete,
      }

      setIsMoving(true)

      function step(now) {
        const animation = animationRef.current

        if (!animation) {
          return
        }

        const elapsedSeconds = (now - animation.lastTimestamp) / 1000
        animation.lastTimestamp = now
        animation.distanceTraveled +=
          elapsedSeconds * speedMetersPerSecondRef.current

        let remainingDistance = animation.distanceTraveled

        if (remainingDistance >= animation.totalDistance) {
          onPositionChangeRef.current(animation.finalPosition)
          animationRef.current = null
          frameIdRef.current = null
          setIsMoving(false)
          animation.onComplete?.()
          return
        }

        for (const segment of animation.segments) {
          if (remainingDistance <= segment.distance) {
            const progress =
              segment.distance === 0 ? 1 : remainingDistance / segment.distance

            onPositionChangeRef.current(
              interpolatePoint(segment.start, segment.end, progress),
            )
            break
          }

          remainingDistance -= segment.distance
        }

        frameIdRef.current = requestAnimationFrame(step)
      }

      frameIdRef.current = requestAnimationFrame(step)
    },
    [cancelAnimation],
  )

  useEffect(() => cancelAnimation, [cancelAnimation])

  return {
    isMoving,
    simulationSpeed: speedMetersPerSecond,
    startAnimation,
    cancelAnimation,
  }
}
