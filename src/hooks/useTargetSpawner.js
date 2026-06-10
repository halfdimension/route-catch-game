import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNearestRoadPoint } from '../api/osrmClient'

const SPAWN_INTERVAL_MS = 5000
const EARTH_RADIUS_METERS = 6371000

const TARGET_RULES = {
  common: {
    lifetimeMs: 12000,
    score: 10,
    minDistanceMeters: 100,
    maxDistanceMeters: 250,
    color: '#f97316',
  },
  rare: {
    lifetimeMs: 8000,
    score: 30,
    minDistanceMeters: 250,
    maxDistanceMeters: 500,
    color: '#ef4444',
  },
  legendary: {
    lifetimeMs: 5000,
    score: 100,
    minDistanceMeters: 500,
    maxDistanceMeters: 800,
    color: '#9333ea',
  },
}

const TARGET_NAMES = {
  common: ['Street Spark', 'Metro Token', 'Route Dot'],
  rare: ['Signal Flare', 'Hidden Turn', 'Fast Lane'],
  legendary: ['Purple Beacon', 'Delhi Crown', 'Night Pulse'],
}

function getRandomRarity() {
  const roll = Math.random()

  if (roll < 0.05) {
    return 'legendary'
  }

  if (roll < 0.3) {
    return 'rare'
  }

  return 'common'
}

function getRandomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function getRandomName(rarity) {
  const names = TARGET_NAMES[rarity]
  return names[Math.floor(Math.random() * names.length)]
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

async function createTarget(playerPosition) {
  const rarity = getRandomRarity()
  const rules = TARGET_RULES[rarity]
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

  console.debug('Raw target point generated:', {
    rarity,
    rawPosition,
    distanceMeters,
  })

  try {
    spawnPosition = await fetchNearestRoadPoint(rawPosition)
    snappedToRoad = true
  } catch (error) {
    console.debug('Nearest road lookup failed; using raw target point:', error)
  }

  const now = Date.now()
  const target = {
    id: crypto.randomUUID(),
    lat: spawnPosition.lat,
    lon: spawnPosition.lon,
    rawLat: rawPosition.lat,
    rawLon: rawPosition.lon,
    snappedToRoad,
    name: getRandomName(rarity),
    rarity,
    score: rules.score,
    expiresAt: now + rules.lifetimeMs,
    lifetimeMs: rules.lifetimeMs,
  }

  console.debug('Final target object:', target)

  return target
}

export function useTargetSpawner(playerPosition) {
  const [targets, setTargets] = useState([])
  const [isSpawningPaused, setIsSpawningPaused] = useState(false)
  const playerPositionRef = useRef(playerPosition)
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
    isSpawningPausedRef.current = isSpawningPaused
  }, [isSpawningPaused])

  useEffect(() => {
    isMountedRef.current = true

    const spawnTimerId = setInterval(() => {
      console.debug('Target spawn tick:', {
        isSpawningPaused: isSpawningPausedRef.current,
      })

      if (isSpawningPausedRef.current) {
        return
      }

      createTarget(playerPositionRef.current)
        .then((target) => {
          if (!isMountedRef.current || isSpawningPausedRef.current) {
            return
          }

          setTargets((currentTargets) => {
            const nextTargets = [...currentTargets, target]
            console.debug('Target added to state:', {
              target,
              activeTargetCount: nextTargets.length,
            })
            return nextTargets
          })
        })
        .catch((error) => {
          console.debug('Target spawn failed before state update:', error)
        })
    }, SPAWN_INTERVAL_MS)

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
