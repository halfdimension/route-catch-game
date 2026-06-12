import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNearestRoadPoint, fetchRoute } from '../api/osrmClient'
import {
  TARGET_RARITY_RULES,
  TARGET_SPAWN_INTERVAL_MS,
} from '../config/gameConfig'
import { getCreaturesByRarity } from '../data/creatureCatalog'
import { getSpawnRarityWeights } from './usePlayerProgression'

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

function getRandomBetween(min, max) {
  return min + Math.random() * (max - min)
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
  const targetLonRadians =
    lonRadians +
    Math.atan2(
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

async function createTarget(
  playerPosition,
  simulationSpeedMetersPerSecond,
  playerLevel,
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

  const now = Date.now()
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
    expiresAt: now + rules.lifetimeMs,
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
) {
  const [targets, setTargets] = useState([])
  const [isSpawningPaused, setIsSpawningPaused] = useState(false)
  const playerPositionRef = useRef(playerPosition)
  const simulationSpeedRef = useRef(simulationSpeedMetersPerSecond)
  const playerLevelRef = useRef(playerLevel)
  const canSpawnTargetsRef = useRef(canSpawnTargets)
  const isSpawningPausedRef = useRef(isSpawningPaused)
  const isMountedRef = useRef(true)

  const removeTarget = useCallback((targetId) => {
    setTargets((currentTargets) =>
      currentTargets.filter((target) => target.id !== targetId),
    )
  }, [])

  const clearTargets = useCallback(() => {
    setTargets([])
  }, [])

  const toggleSpawning = useCallback(() => {
    setIsSpawningPaused((currentValue) => !currentValue)
  }, [])

  useEffect(() => {
    playerPositionRef.current = playerPosition
  }, [playerPosition])

  useEffect(() => {
    simulationSpeedRef.current = simulationSpeedMetersPerSecond
  }, [simulationSpeedMetersPerSecond])

  useEffect(() => {
    playerLevelRef.current = playerLevel
  }, [playerLevel])

  useEffect(() => {
    canSpawnTargetsRef.current = canSpawnTargets
  }, [canSpawnTargets])

  useEffect(() => {
    isSpawningPausedRef.current = isSpawningPaused
  }, [isSpawningPaused])

  useEffect(() => {
    isMountedRef.current = true

    const spawnTimerId = setInterval(() => {
      if (!canSpawnTargetsRef.current || isSpawningPausedRef.current) {
        return
      }

      createTarget(
        playerPositionRef.current,
        simulationSpeedRef.current,
        playerLevelRef.current,
      )
        .then((target) => {
          if (
            !isMountedRef.current ||
            !canSpawnTargetsRef.current ||
            isSpawningPausedRef.current
          ) {
            return
          }

          setTargets((currentTargets) => {
            const nextTargets = [...currentTargets, target]
            return nextTargets
          })
        })
        .catch((error) => {
          console.warn('Target spawn failed before state update:', error)
        })
    }, TARGET_SPAWN_INTERVAL_MS)

    const expiryTimerId = setInterval(() => {
      const now = Date.now()
      setTargets((currentTargets) =>
        currentTargets.filter((target) => target.expiresAt > now),
      )
    }, 1000)

    return () => {
      isMountedRef.current = false
      clearInterval(spawnTimerId)
      clearInterval(expiryTimerId)
    }
  }, [])

  return {
    targets,
    isSpawningPaused,
    removeTarget,
    clearTargets,
    toggleSpawning,
  }
}
