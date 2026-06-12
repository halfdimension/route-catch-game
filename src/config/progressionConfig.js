export const LEVEL_THRESHOLDS = [
  { level: 1, xp: 0 },
  { level: 2, xp: 50 },
  { level: 3, xp: 150 },
  { level: 4, xp: 300 },
  { level: 5, xp: 500 },
]

export const LEVEL_SPEED_BONUSES = {
  1: 0,
  2: 50,
  3: 100,
  4: 150,
  5: 250,
}

export const SPAWN_RARITY_WEIGHTS_BY_LEVEL = {
  1: { common: 80, rare: 18, legendary: 2 },
  2: { common: 70, rare: 25, legendary: 5 },
  3: { common: 60, rare: 32, legendary: 8 },
  4: { common: 50, rare: 38, legendary: 12 },
  5: { common: 40, rare: 45, legendary: 15 },
}
