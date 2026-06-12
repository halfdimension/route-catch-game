import { useMemo, useState } from 'react'
import {
  LEVEL_SPEED_BONUSES,
  LEVEL_THRESHOLDS,
  SPAWN_RARITY_WEIGHTS_BY_LEVEL,
} from '../config/progressionConfig'

function getLevelForXp(xp) {
  return LEVEL_THRESHOLDS.reduce((currentLevel, threshold) => {
    return xp >= threshold.xp ? threshold.level : currentLevel
  }, LEVEL_THRESHOLDS[0].level)
}

function getNextLevelXp(level) {
  return LEVEL_THRESHOLDS.find((threshold) => threshold.level > level)?.xp ?? null
}

export function getSpawnRarityWeights(level) {
  const configuredLevels = Object.keys(SPAWN_RARITY_WEIGHTS_BY_LEVEL).map(Number)
  const highestConfiguredLevel = Math.max(...configuredLevels)
  const resolvedLevel = Math.min(level, highestConfiguredLevel)

  return SPAWN_RARITY_WEIGHTS_BY_LEVEL[resolvedLevel]
}

export function usePlayerProgression() {
  const [xp, setXp] = useState(0)
  const level = useMemo(() => getLevelForXp(xp), [xp])
  const nextLevelXp = useMemo(() => getNextLevelXp(level), [level])
  const speedBonus = LEVEL_SPEED_BONUSES[level] ?? 0
  const spawnRarityWeights = useMemo(() => getSpawnRarityWeights(level), [level])

  function addXp(amount) {
    setXp((currentXp) => currentXp + amount)
  }

  function resetProgression() {
    setXp(0)
  }

  return {
    xp,
    level,
    nextLevelXp,
    speedBonus,
    spawnRarityWeights,
    addXp,
    resetProgression,
  }
}
