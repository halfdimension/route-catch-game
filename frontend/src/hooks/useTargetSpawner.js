import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { fetchNearestRoadPoint, fetchRoute } from '../api/routingClient.js'
import {
  TARGET_RARITY_RULES,
  TARGET_SPAWN_INTERVAL_MS,
} from '../config/gameConfig.js'
import { getCreaturesByRarity } from '../data/creatureCatalog.js'
import {
  DEFAULT_TRAVEL_MODE,
  requireTravelMode,
} from '../config/travelMode.js'
import { getSpawnRarityWeights } from './usePlayerProgression.js'
import { getRouteDistanceMeters } from './useRouteAnimation.js'

const EARTH_RADIUS_METERS = 6371000
export const SOLO_TARGET_SPAWN_MAX_ATTEMPTS = 3
export const SOLO_TARGET_ROUTE_MIN_GEOMETRY_METERS = 0.01
// Allow normal routing correlation precision while requiring the route to
// terminate near the mode-aware snapped candidate.
export const SOLO_TARGET_ROUTE_ENDPOINT_TOLERANCE_METERS = 25

export class SoloTargetSpawnStaleError extends Error {
  constructor() {
    super('The SOLO target spawn operation is no longer current')
    this.name = 'SoloTargetSpawnStaleError'
  }
}

export class SoloTargetSpawnError extends Error {
  constructor(attempts, cause) {
    super(`Could not create a compatible SOLO target after ${attempts} attempts`)
    this.name = 'SoloTargetSpawnError'
    this.attempts = attempts
    this.cause = cause
  }
}

function getRandomRarity(playerLevel) {
  const weights = getSpawnRarityWeights(playerLevel)
  const totalWeight = weights.common + weights.rare + weights.legendary
  const roll = Math.random() * totalWeight

  if (roll < weights.common) {
    return 'common'
  }
  if (roll < weights.common + weights.rare) {
    return 'rare'
  }
  return 'legendary'
}

function getRandomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum)
}

function getRandomCreature(rarity) {
  const creatures = getCreaturesByRarity(rarity)
  return creatures[Math.floor(Math.random() * creatures.length)]
}

function getPointAtDistance(origin, distanceMeters, bearingRadians) {
  const latRadians = (origin.lat * Math.PI) / 180
  const lonRadians = (origin.lon * Math.PI) / 180
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS
  const targetLatRadians = Math.asin(
    Math.sin(latRadians) * Math.cos(angularDistance) +
      Math.cos(latRadians) *
        Math.sin(angularDistance) *
        Math.cos(bearingRadians),
  )
  const targetLonRadians = lonRadians + Math.atan2(
    Math.sin(bearingRadians) *
      Math.sin(angularDistance) *
      Math.cos(latRadians),
    Math.cos(angularDistance) -
      Math.sin(latRadians) * Math.sin(targetLatRadians),
  )

  return {
    lat: (targetLatRadians * 180) / Math.PI,
    lon: (targetLonRadians * 180) / Math.PI,
  }
}

function getDifficulty(estimatedGameTravelSeconds, lifetimeSeconds) {
  if (estimatedGameTravelSeconds <= lifetimeSeconds * 0.5) {
    return 'Easy'
  }
  if (estimatedGameTravelSeconds <= lifetimeSeconds * 0.8) {
    return 'Medium'
  }
  if (estimatedGameTravelSeconds <= lifetimeSeconds) {
    return 'Hard'
  }
  return 'Almost Impossible'
}

function isUsableGeoPoint(point) {
  return (
    Number.isFinite(point?.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    Number.isFinite(point?.lon) &&
    point.lon >= -180 &&
    point.lon <= 180
  )
}

function isUsableRouteCoordinate(coordinate) {
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

function getMeasuredRouteGeometryMeters(coordinates) {
  return coordinates.slice(1).reduce(
    (distanceMeters, coordinate, index) => (
      distanceMeters + getRouteDistanceMeters(
        coordinates[index],
        coordinate,
      )
    ),
    0,
  )
}

export function isUsableSoloTargetRoute(route, snappedTarget) {
  if (
    !Array.isArray(route?.coordinates) ||
    route.coordinates.length < 2 ||
    !route.coordinates.every(isUsableRouteCoordinate) ||
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters <= 0 ||
    !isUsableGeoPoint(snappedTarget)
  ) {
    return false
  }

  const measuredGeometryMeters = getMeasuredRouteGeometryMeters(
    route.coordinates,
  )
  if (
    !Number.isFinite(measuredGeometryMeters) ||
    measuredGeometryMeters <= SOLO_TARGET_ROUTE_MIN_GEOMETRY_METERS
  ) {
    return false
  }

  const endpoint = route.coordinates.at(-1)
  const endpointDistanceMeters = getRouteDistanceMeters(endpoint, [
    snappedTarget.lat,
    snappedTarget.lon,
  ])
  return (
    Number.isFinite(endpointDistanceMeters) &&
    endpointDistanceMeters <= SOLO_TARGET_ROUTE_ENDPOINT_TOLERANCE_METERS
  )
}

function assertSpawnIsCurrent(isCurrent) {
  if (isCurrent() === false) {
    throw new SoloTargetSpawnStaleError()
  }
}

export function getNextSoloSpawnDeadline(
  scheduledAtEpochMs,
  nowEpochMs,
  intervalMs = TARGET_SPAWN_INTERVAL_MS,
) {
  if (
    !Number.isFinite(scheduledAtEpochMs) ||
    !Number.isFinite(nowEpochMs) ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new TypeError(
      'A valid spawn deadline, current time, and interval are required',
    )
  }

  const elapsedIntervals = Math.max(
    1,
    Math.floor((nowEpochMs - scheduledAtEpochMs) / intervalMs) + 1,
  )
  return scheduledAtEpochMs + elapsedIntervals * intervalMs
}

export async function createSoloTarget(
  playerPosition,
  simulationSpeedMetersPerSecond,
  playerLevel,
  getEpochTimeMs = Date.now,
  {
    travelMode = DEFAULT_TRAVEL_MODE,
    isCurrent = () => true,
    nearestRoadPoint = fetchNearestRoadPoint,
    routeBetween = fetchRoute,
    maxAttempts = SOLO_TARGET_SPAWN_MAX_ATTEMPTS,
  } = {},
) {
  const capturedTravelMode = requireTravelMode(
    travelMode,
    'SOLO target spawn travel mode',
  )
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new TypeError('SOLO target spawn maxAttempts must be a positive integer')
  }

  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertSpawnIsCurrent(isCurrent)
    const rarity = getRandomRarity(playerLevel)
    const rules = TARGET_RARITY_RULES[rarity]
    const creature = getRandomCreature(rarity)
    const distanceMeters = getRandomBetween(
      rules.minDistanceMeters,
      rules.maxDistanceMeters,
    )
    const bearingRadians = getRandomBetween(0, Math.PI * 2)
    const rawPosition = getPointAtDistance(
      playerPosition,
      distanceMeters,
      bearingRadians,
    )

    try {
      const spawnPosition = await nearestRoadPoint(rawPosition, {
        travelMode: capturedTravelMode,
      })
      assertSpawnIsCurrent(isCurrent)
      if (!isUsableGeoPoint(spawnPosition)) {
        throw new Error('Nearest response returned an unusable snapped point')
      }

      const route = await routeBetween(playerPosition, spawnPosition, {
        travelMode: capturedTravelMode,
      })
      assertSpawnIsCurrent(isCurrent)
      if (!isUsableSoloTargetRoute(route, spawnPosition)) {
        throw new Error('Route response returned an unusable target route')
      }

      const estimatedGameTravelSeconds =
        simulationSpeedMetersPerSecond > 0
          ? route.distanceMeters / simulationSpeedMetersPerSecond
          : null
      const difficulty = estimatedGameTravelSeconds === null
        ? 'Unknown'
        : getDifficulty(
            estimatedGameTravelSeconds,
            rules.lifetimeMs / 1000,
          )
      const spawnedAt = getEpochTimeMs()

      return {
        id: crypto.randomUUID(),
        lat: spawnPosition.lat,
        lon: spawnPosition.lon,
        rawLat: rawPosition.lat,
        rawLon: rawPosition.lon,
        snappedToRoad: true,
        creatureId: creature.id,
        name: creature.name,
        type: creature.type,
        rarity,
        score: creature.score,
        color: creature.color,
        symbol: creature.symbol,
        shortDescription: creature.shortDescription,
        imageUrl: creature.imageUrl,
        soundUrl: creature.soundUrl,
        spawnedAt,
        expiresAt: spawnedAt + rules.lifetimeMs,
        lifetimeMs: rules.lifetimeMs,
        routeDistanceMeters: route.distanceMeters,
        routeDurationSeconds: route.durationSeconds,
        estimatedGameTravelSeconds,
        difficulty,
      }
    } catch (error) {
      if (error instanceof SoloTargetSpawnStaleError) {
        throw error
      }
      lastError = error
    }
  }

  throw new SoloTargetSpawnError(maxAttempts, lastError)
}

export function useTargetSpawner(
  playerPosition,
  simulationSpeedMetersPerSecond,
  canSpawnTargets,
  playerLevel,
  onTargetExpired,
  {
    getEpochTimeMs = Date.now,
    onTargetTransition,
    spawnTarget = createSoloTarget,
    captureSpawnOperation,
  } = {},
) {
  const [targets, setTargets] = useState([])
  const [isSpawningPaused, setIsSpawningPaused] = useState(false)
  const [nextSpawnAtEpochMs, setNextSpawnAtEpochMs] = useState(null)
  const playerPositionRef = useRef(playerPosition)
  const simulationSpeedRef = useRef(simulationSpeedMetersPerSecond)
  const playerLevelRef = useRef(playerLevel)
  const canSpawnTargetsRef = useRef(canSpawnTargets)
  const isSpawningPausedRef = useRef(isSpawningPaused)
  const nextSpawnAtEpochMsRef = useRef(nextSpawnAtEpochMs)
  const targetsRef = useRef([])
  const mountedRef = useRef(false)
  const spawnGenerationRef = useRef(0)
  const spawnInFlightRef = useRef(null)
  const nextSpawnOperationIdRef = useRef(0)
  const targetLifecycleGenerationRef = useRef(0)
  const previousCanSpawnTargetsRef = useRef(canSpawnTargets)
  const onTargetExpiredRef = useRef(onTargetExpired)
  const onTargetTransitionRef = useRef(onTargetTransition)
  const getEpochTimeMsRef = useRef(getEpochTimeMs)
  const captureSpawnOperationRef = useRef(captureSpawnOperation)

  const spawningSnapshot = useCallback(() => ({
    paused: isSpawningPausedRef.current,
    nextSpawnAtEpochMs: nextSpawnAtEpochMsRef.current,
  }), [])

  const publishTransition = useCallback((type, overrides = {}) => {
    onTargetTransitionRef.current?.({
      type,
      targets: structuredClone(targetsRef.current),
      spawning: spawningSnapshot(),
      ...overrides,
    })
  }, [spawningSnapshot])

  const setSpawnSchedule = useCallback((nextEpochMs, transitionType) => {
    nextSpawnAtEpochMsRef.current = nextEpochMs
    setNextSpawnAtEpochMs(nextEpochMs)
    if (transitionType) {
      publishTransition(transitionType)
    }
  }, [publishTransition])

  const replaceTargets = useCallback((nextTargets, {
    notify = false,
    transitionType = 'TARGETS_REPLACED',
  } = {}) => {
    const clonedTargets = structuredClone(nextTargets)
    targetsRef.current = clonedTargets
    setTargets(clonedTargets)
    if (notify) {
      publishTransition(transitionType)
    }
  }, [publishTransition])

  const removeTarget = useCallback((targetId) => {
    replaceTargets(
      targetsRef.current.filter((target) => target.id !== targetId),
    )
  }, [replaceTargets])

  const clearTargets = useCallback(() => {
    spawnGenerationRef.current += 1
    spawnInFlightRef.current = null
    targetLifecycleGenerationRef.current += 1
    replaceTargets([])
  }, [replaceTargets])

  const hydrateTargetState = useCallback(({ targets: recoveredTargets, spawning }) => {
    spawnGenerationRef.current += 1
    spawnInFlightRef.current = null
    targetLifecycleGenerationRef.current += 1
    const paused = Boolean(spawning?.paused)
    const nextSpawnAt = paused
      ? null
      : Number.isFinite(spawning?.nextSpawnAtEpochMs)
        ? spawning.nextSpawnAtEpochMs
        : null
    isSpawningPausedRef.current = paused
    nextSpawnAtEpochMsRef.current = nextSpawnAt
    setIsSpawningPaused(paused)
    setNextSpawnAtEpochMs(nextSpawnAt)
    replaceTargets(recoveredTargets ?? [])
  }, [replaceTargets])

  const toggleSpawning = useCallback(() => {
    const paused = !isSpawningPausedRef.current
    if (paused) {
      // A paused-then-resumed state is an ABA from the perspective of a
      // pending async spawn, so invalidate it independently of the boolean.
      spawnGenerationRef.current += 1
      spawnInFlightRef.current = null
    }
    isSpawningPausedRef.current = paused
    setIsSpawningPaused(paused)
    setSpawnSchedule(
      paused ? null : getEpochTimeMsRef.current() + TARGET_SPAWN_INTERVAL_MS,
      paused ? 'SPAWNING_PAUSED' : 'SPAWNING_RESUMED',
    )
  }, [setSpawnSchedule])

  const getTargetStateSnapshot = useCallback(() => ({
    targets: structuredClone(targetsRef.current),
    spawning: spawningSnapshot(),
  }), [spawningSnapshot])

  const hasActiveTarget = useCallback((targetId, atEpochMs = getEpochTimeMsRef.current()) => (
    targetsRef.current.some(
      (target) => target.id === targetId && target.expiresAt > atEpochMs,
    )
  ), [])

  useLayoutEffect(() => {
    if (previousCanSpawnTargetsRef.current && !canSpawnTargets) {
      spawnGenerationRef.current += 1
      spawnInFlightRef.current = null
    }
    previousCanSpawnTargetsRef.current = canSpawnTargets
    playerPositionRef.current = playerPosition
    simulationSpeedRef.current = simulationSpeedMetersPerSecond
    playerLevelRef.current = playerLevel
    canSpawnTargetsRef.current = canSpawnTargets
    onTargetExpiredRef.current = onTargetExpired
    onTargetTransitionRef.current = onTargetTransition
    getEpochTimeMsRef.current = getEpochTimeMs
    captureSpawnOperationRef.current = captureSpawnOperation
  }, [
    canSpawnTargets,
    captureSpawnOperation,
    getEpochTimeMs,
    onTargetExpired,
    onTargetTransition,
    playerLevel,
    playerPosition,
    simulationSpeedMetersPerSecond,
  ])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      spawnGenerationRef.current += 1
      spawnInFlightRef.current = null
      targetLifecycleGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!canSpawnTargets || isSpawningPaused) {
      return undefined
    }

    const nowEpochMs = getEpochTimeMsRef.current()
    let scheduledAt = nextSpawnAtEpochMsRef.current
    if (!Number.isFinite(scheduledAt) || scheduledAt <= nowEpochMs) {
      scheduledAt = nowEpochMs + TARGET_SPAWN_INTERVAL_MS
      setSpawnSchedule(scheduledAt, 'SPAWN_SCHEDULED')
    }
    const generation = spawnGenerationRef.current
    const timerId = window.setTimeout(() => {
      if (
        !mountedRef.current ||
        !canSpawnTargetsRef.current ||
        isSpawningPausedRef.current ||
        generation !== spawnGenerationRef.current
      ) {
        return
      }
      const opportunityEpochMs = getEpochTimeMsRef.current()
      setSpawnSchedule(
        getNextSoloSpawnDeadline(scheduledAt, opportunityEpochMs),
        'SPAWN_SCHEDULED',
      )
      if (spawnInFlightRef.current?.generation === generation) {
        return
      }
      const lifecycleOperation = captureSpawnOperationRef.current
        ? captureSpawnOperationRef.current()
        : {
            travelMode: DEFAULT_TRAVEL_MODE,
            isCurrent: () => true,
          }
      if (
        !lifecycleOperation ||
        lifecycleOperation.isCurrent?.() === false
      ) {
        return
      }
      const operation = {
        generation,
        operationId: nextSpawnOperationIdRef.current + 1,
        lifecycleOperation,
        travelMode: requireTravelMode(
          lifecycleOperation.travelMode,
          'Captured SOLO spawn travel mode',
        ),
      }
      nextSpawnOperationIdRef.current = operation.operationId
      spawnInFlightRef.current = operation
      const operationIsCurrent = () => (
        mountedRef.current &&
        canSpawnTargetsRef.current &&
        !isSpawningPausedRef.current &&
        generation === spawnGenerationRef.current &&
        spawnInFlightRef.current === operation &&
        lifecycleOperation.isCurrent?.() !== false
      )
      void Promise.resolve().then(() => {
        if (!operationIsCurrent()) {
          throw new SoloTargetSpawnStaleError()
        }
        return spawnTarget(
          playerPositionRef.current,
          simulationSpeedRef.current,
          playerLevelRef.current,
          getEpochTimeMsRef.current,
          {
            travelMode: operation.travelMode,
            isCurrent: operationIsCurrent,
          },
        )
      }).then((target) => {
        if (!operationIsCurrent()) {
          return
        }
        if (
          !mountedRef.current ||
          !canSpawnTargetsRef.current ||
          isSpawningPausedRef.current ||
          generation !== spawnGenerationRef.current ||
          spawnInFlightRef.current !== operation
        ) {
          return
        }
        const nextTargets = [...targetsRef.current, target]
        targetsRef.current = nextTargets
        setTargets(nextTargets)
        publishTransition('TARGET_SPAWNED', { target: structuredClone(target) })
      }).catch((error) => {
        if (
          operationIsCurrent() &&
          !(error instanceof SoloTargetSpawnStaleError)
        ) {
          console.warn('Target spawn failed before state update:', error)
        }
      }).finally(() => {
        if (spawnInFlightRef.current === operation) {
          spawnInFlightRef.current = null
        }
      })
    }, Math.max(0, scheduledAt - nowEpochMs))

    return () => window.clearTimeout(timerId)
  }, [
    canSpawnTargets,
    isSpawningPaused,
    nextSpawnAtEpochMs,
    publishTransition,
    setSpawnSchedule,
    spawnTarget,
  ])

  useEffect(() => {
    if (targets.length === 0) {
      return undefined
    }
    const nowEpochMs = getEpochTimeMsRef.current()
    const earliestExpiry = Math.min(
      ...targets.map((target) => target.expiresAt),
    )
    const generation = targetLifecycleGenerationRef.current
    const timerId = window.setTimeout(() => {
      if (
        !mountedRef.current ||
        generation !== targetLifecycleGenerationRef.current
      ) {
        return
      }
      const expiredAtEpochMs = getEpochTimeMsRef.current()
      const expiredTargets = targetsRef.current.filter(
        (target) => target.expiresAt <= expiredAtEpochMs,
      )
      if (expiredTargets.length === 0) {
        return
      }
      const activeTargets = targetsRef.current.filter(
        (target) => target.expiresAt > expiredAtEpochMs,
      )
      targetsRef.current = activeTargets
      setTargets(activeTargets)
      onTargetExpiredRef.current?.(expiredTargets, {
        expiredAtEpochMs,
        targets: structuredClone(activeTargets),
        spawning: spawningSnapshot(),
      })
    }, Math.max(0, earliestExpiry - nowEpochMs))

    return () => window.clearTimeout(timerId)
  }, [spawningSnapshot, targets])

  return {
    targets,
    isSpawningPaused,
    nextSpawnAtEpochMs,
    removeTarget,
    replaceTargets,
    clearTargets,
    hydrateTargetState,
    getTargetStateSnapshot,
    hasActiveTarget,
    toggleSpawning,
  }
}
