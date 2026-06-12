export const INITIAL_PLAYER_POSITION = {
  lat: 28.550584664849566,
  lon: 77.26885829983426,
}

export const DEFAULT_ROUND_SECONDS = 60
export const TARGET_SPAWN_INTERVAL_MS = 5000
export const CATCH_RADIUS_METERS = 25
export const DEFAULT_SIMULATION_SPEED = 80
export const MAX_SIMULATION_SPEED = 700

export const TARGET_RARITY_RULES = {
  common: {
    lifetimeMs: 12000,
    minDistanceMeters: 100,
    maxDistanceMeters: 250,
  },
  rare: {
    lifetimeMs: 8000,
    minDistanceMeters: 250,
    maxDistanceMeters: 500,
  },
  legendary: {
    lifetimeMs: 5000,
    minDistanceMeters: 500,
    maxDistanceMeters: 800,
  },
}
