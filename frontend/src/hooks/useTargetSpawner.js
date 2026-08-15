import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { fetchNearestRoadPoint, fetchRoute } from '../api/osrmClient.js'
import {
  TARGET_RARITY_RULES,
  TARGET_SPAWN_INTERVAL_MS,
} from '../config/gameConfig.js'
import { getCreaturesByRarity } from '../data/creatureCatalog.js'
import { getSpawnRarityWeights } from './usePlayerProgression.js'

const EARTH_RADIUS_METERS = 6371000

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
) {
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
  let spawnPosition = rawPosition
  let snappedToRoad = false
  let routeDistanceMeters = null
  let routeDurationSeconds = null
  let estimatedGameTravelSeconds = null
  let difficulty = 'Unknown'

  try {
    spawnPosition = await fetchNearestRoadPoint(rawPosition)
    snappedToRoad = true
  } catch (error) {
    console.warn('Nearest road lookup failed; using raw target point:', error)
  }

  try {
    const route = await fetchRoute(playerPosition, spawnPosition)
    routeDistanceMeters = route.distanceMeters
    routeDurationSeconds = route.durationSeconds
    if (routeDistanceMeters !== null && simulationSpeedMetersPerSecond > 0) {
      estimatedGameTravelSeconds =
        routeDistanceMeters / simulationSpeedMetersPerSecond
      difficulty = getDifficulty(
        estimatedGameTravelSeconds,
        rules.lifetimeMs / 1000,
      )
    }
  } catch (error) {
    console.warn('Target route lookup failed; difficulty unknown:', error)
  }

  const spawnedAt = getEpochTimeMs()
  return {
    id: crypto.randomUUID(),
    lat: spawnPosition.lat,
    lon: spawnPosition.lon,
    rawLat: rawPosition.lat,
    rawLon: rawPosition.lon,
    snappedToRoad,
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
    routeDistanceMeters,
    routeDurationSeconds,
    estimatedGameTravelSeconds,
    difficulty,
  }
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
  }, [
    canSpawnTargets,
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
      const operation = {
        generation,
        operationId: nextSpawnOperationIdRef.current + 1,
      }
      nextSpawnOperationIdRef.current = operation.operationId
      spawnInFlightRef.current = operation
      void Promise.resolve().then(() => spawnTarget(
        playerPositionRef.current,
        simulationSpeedRef.current,
        playerLevelRef.current,
        getEpochTimeMsRef.current,
      )).then((target) => {
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
          mountedRef.current &&
          generation === spawnGenerationRef.current &&
          spawnInFlightRef.current === operation
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
