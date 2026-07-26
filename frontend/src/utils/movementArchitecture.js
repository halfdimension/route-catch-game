export const MOVEMENT_ARCHITECTURE = Object.freeze({
  MULTIPLAYER: 'BACKEND_AUTHORITATIVE_PLAN',
  SOLO: 'LOCAL_ROUTE_ANIMATION',
})

export function startMovementForArchitecture({
  architecture,
  startAuthoritativePlan,
  startLocalRoute,
}) {
  if (architecture === MOVEMENT_ARCHITECTURE.MULTIPLAYER) {
    return startAuthoritativePlan()
  }

  if (architecture === MOVEMENT_ARCHITECTURE.SOLO) {
    return startLocalRoute()
  }

  throw new RangeError(`Unsupported movement architecture: ${architecture}`)
}

export function createSharedCreatureMovementIntent(
  creatureInstanceId,
  requestedSpeedMps,
) {
  if (!creatureInstanceId) {
    throw new TypeError('Shared creature instance id is required')
  }

  return {
    requestedSpeedMps: Number(requestedSpeedMps),
    destinationType: 'CREATURE',
    targetCreatureInstanceId: creatureInstanceId,
  }
}
