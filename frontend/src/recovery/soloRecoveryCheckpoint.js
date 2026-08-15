import { createRouteAnimationPlan } from '../hooks/useRouteAnimation.js'
import {
  isUuid,
  isValidSoloIdentityKey,
} from './soloRecoveryIdentity.js'

export const SOLO_RECOVERY_SCHEMA_VERSION = 1
export const SOLO_RECOVERY_STARTING_TTL_MS = 2 * 60 * 1000
export const SOLO_RECOVERY_RUNNING_GRACE_MS = 15 * 60 * 1000
export const SOLO_RECOVERY_ROUTE_DISTANCE_EPSILON_METERS = 0.001
// Slice 3A made the stored catch UUID an idempotency key. Slice 3B replays
// validated pending entries only through the scoped, single-flight worker.
export const SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED = true

export const SOLO_RECOVERY_ROUND_PHASES = Object.freeze({
  // Recovery begins only after this record, including backendSessionId, is
  // durable. A crash after the backend responds but before this first write is
  // outside the guarantee until backend session creation becomes idempotent.
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  RECONCILING: 'RECONCILING',
})

export const SOLO_RECOVERY_MOVEMENT_PHASES = Object.freeze({
  ROUTING: 'ROUTING',
  MOVING: 'MOVING',
})

export const SOLO_RECOVERY_MOVEMENT_PURPOSES = Object.freeze({
  MAP: 'MAP',
  CHASE: 'CHASE',
})

const TARGET_RARITIES = new Set(['common', 'rare', 'legendary'])
const ROUND_PHASES = new Set(Object.values(SOLO_RECOVERY_ROUND_PHASES))
const MOVEMENT_PHASES = new Set(Object.values(SOLO_RECOVERY_MOVEMENT_PHASES))
const MOVEMENT_PURPOSES = new Set(
  Object.values(SOLO_RECOVERY_MOVEMENT_PURPOSES),
)

export class SoloRecoveryValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SoloRecoveryValidationError'
  }
}

function reject(message) {
  throw new SoloRecoveryValidationError(message)
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  )
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) {
    reject(`${path} must be an object`)
  }
}

function assertFiniteNumber(value, path, { minimum = -Infinity } = {}) {
  if (!Number.isFinite(value) || value < minimum) {
    reject(`${path} must be a finite number${
      Number.isFinite(minimum) ? ` greater than or equal to ${minimum}` : ''
    }`)
  }
}

function assertEpochMs(value, path, { nullable = false } = {}) {
  if (nullable && value === null) {
    return
  }

  assertFiniteNumber(value, path, { minimum: 0 })
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    reject(`${path} must be a non-negative integer`)
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    reject(`${path} must be a non-empty string`)
  }
}

function assertUuid(value, path) {
  if (!isUuid(value)) {
    reject(`${path} must be a UUID`)
  }
}

function createRecoveryUuid(name, randomUuid) {
  const value = randomUuid()

  if (!isUuid(value)) {
    throw new TypeError(`${name} generator returned invalid data`)
  }

  return value.toLowerCase()
}

export function createSoloClientRoundId(
  randomUuid = () => globalThis.crypto.randomUUID(),
) {
  return createRecoveryUuid('Client round ID', randomUuid)
}

export function createSoloMovementRecoveryId(
  randomUuid = () => globalThis.crypto.randomUUID(),
) {
  return createRecoveryUuid('Movement recovery ID', randomUuid)
}

export function createSoloPendingCatchId(
  randomUuid = () => globalThis.crypto.randomUUID(),
) {
  return createRecoveryUuid('Pending catch ID', randomUuid)
}

function assertPosition(position, path) {
  assertPlainObject(position, path)
  assertFiniteNumber(position.lat, `${path}.lat`)
  assertFiniteNumber(position.lon, `${path}.lon`)

  if (position.lat < -90 || position.lat > 90) {
    reject(`${path}.lat is outside the valid latitude range`)
  }

  if (position.lon < -180 || position.lon > 180) {
    reject(`${path}.lon is outside the valid longitude range`)
  }
}

function assertTarget(target, path, { caught = false } = {}) {
  // Gameplay-critical fields are validated here. Presentation metadata remains
  // pass-through and must be rebuilt from creatureId rather than trusted by a
  // future hydration layer.
  assertPlainObject(target, path)
  assertUuid(target.id, `${path}.id`)
  assertNonEmptyString(target.creatureId, `${path}.creatureId`)
  assertPosition(target, path)
  assertEpochMs(target.expiresAt, `${path}.expiresAt`)

  if (target.spawnedAt !== undefined) {
    assertEpochMs(target.spawnedAt, `${path}.spawnedAt`)

    if (target.spawnedAt > target.expiresAt) {
      reject(`${path}.spawnedAt cannot be after expiresAt`)
    }
  }

  if (target.rarity !== undefined && !TARGET_RARITIES.has(target.rarity)) {
    reject(`${path}.rarity is invalid`)
  }

  if (target.score !== undefined) {
    assertNonNegativeInteger(target.score, `${path}.score`)
  }

  if (caught) {
    assertEpochMs(target.caughtAt, `${path}.caughtAt`)

    if (target.spawnedAt !== undefined && target.caughtAt < target.spawnedAt) {
      reject(`${path}.caughtAt cannot be before spawnedAt`)
    }
  }
}

function assertMovement(movement, checkpoint) {
  if (movement === null) {
    return
  }

  if (checkpoint.round.phase !== SOLO_RECOVERY_ROUND_PHASES.RUNNING) {
    reject('Only a RUNNING round can contain movement')
  }

  assertPlainObject(movement, 'movement')
  assertUuid(
    movement.movementRecoveryId,
    'movement.movementRecoveryId',
  )

  if (!MOVEMENT_PHASES.has(movement.phase)) {
    reject('movement.phase is invalid')
  }

  if (!MOVEMENT_PURPOSES.has(movement.purpose)) {
    reject('movement.purpose is invalid')
  }

  assertPosition(movement.destination, 'movement.destination')

  if (movement.purpose === SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE) {
    assertUuid(movement.chasedTargetId, 'movement.chasedTargetId')

    if (!checkpoint.targets.some((target) => target.id === movement.chasedTargetId)) {
      reject('movement.chasedTargetId must identify an active target')
    }
  } else if (movement.chasedTargetId !== null) {
    reject('MAP movement cannot contain a chased target ID')
  }

  if (movement.phase === SOLO_RECOVERY_MOVEMENT_PHASES.ROUTING) {
    if (
      movement.routeCoordinates !== null ||
      movement.anchorDistanceMeters !== null ||
      movement.anchorTimeEpochMs !== null
    ) {
      reject('ROUTING movement cannot contain a route anchor')
    }
    return
  }

  const plan = createRouteAnimationPlan(movement.routeCoordinates)

  if (!plan) {
    reject('movement.routeCoordinates is invalid')
  }

  assertFiniteNumber(
    movement.anchorDistanceMeters,
    'movement.anchorDistanceMeters',
    { minimum: 0 },
  )
  assertEpochMs(movement.anchorTimeEpochMs, 'movement.anchorTimeEpochMs')

  if (
    movement.anchorDistanceMeters >
      plan.totalDistanceMeters +
        SOLO_RECOVERY_ROUTE_DISTANCE_EPSILON_METERS
  ) {
    reject('movement.anchorDistanceMeters exceeds the route distance')
  }

  if (movement.anchorTimeEpochMs >= checkpoint.round.endsAtEpochMs) {
    reject('movement.anchorTimeEpochMs must be inside the active round')
  }

  return {
    anchorDistanceMeters: Math.min(
      movement.anchorDistanceMeters,
      plan.totalDistanceMeters,
    ),
  }
}

function assertPendingCatch(pendingCatch, path) {
  assertPlainObject(pendingCatch, path)
  assertUuid(pendingCatch.catchId, `${path}.catchId`)
  assertUuid(pendingCatch.targetId, `${path}.targetId`)
  assertNonEmptyString(pendingCatch.creatureId, `${path}.creatureId`)
  assertEpochMs(pendingCatch.caughtAtEpochMs, `${path}.caughtAtEpochMs`)
}

export function calculateSoloCheckpointExpiresAt({
  phase,
  createdAtEpochMs,
  endsAtEpochMs = null,
}) {
  assertEpochMs(createdAtEpochMs, 'createdAtEpochMs')

  if (phase === SOLO_RECOVERY_ROUND_PHASES.STARTING) {
    return createdAtEpochMs + SOLO_RECOVERY_STARTING_TTL_MS
  }

  if (
    phase === SOLO_RECOVERY_ROUND_PHASES.RUNNING ||
    phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING
  ) {
    assertEpochMs(endsAtEpochMs, 'endsAtEpochMs')
    return endsAtEpochMs + SOLO_RECOVERY_RUNNING_GRACE_MS
  }

  reject('round phase is invalid')
}

export function isSoloCheckpointStorageExpired(checkpoint, nowEpochMs) {
  assertEpochMs(nowEpochMs, 'nowEpochMs')
  return nowEpochMs >= checkpoint.expiresAtEpochMs
}

export function isSoloCheckpointResumable(checkpoint, nowEpochMs) {
  assertEpochMs(nowEpochMs, 'nowEpochMs')

  return (
    checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RUNNING &&
    nowEpochMs < checkpoint.round.endsAtEpochMs &&
    !isSoloCheckpointStorageExpired(checkpoint, nowEpochMs)
  )
}

export function validateSoloRecoveryCheckpoint(
  checkpoint,
  { expectedIdentityKey } = {},
) {
  assertPlainObject(checkpoint, 'checkpoint')

  if (checkpoint.schemaVersion !== SOLO_RECOVERY_SCHEMA_VERSION) {
    reject(`Unsupported SOLO recovery schema version: ${checkpoint.schemaVersion}`)
  }

  if (!isValidSoloIdentityKey(checkpoint.identityKey)) {
    reject('identityKey is invalid')
  }

  if (
    expectedIdentityKey !== undefined &&
    checkpoint.identityKey !== expectedIdentityKey
  ) {
    reject('Checkpoint identity does not match the requested identity')
  }

  assertEpochMs(checkpoint.createdAtEpochMs, 'createdAtEpochMs')
  assertEpochMs(checkpoint.updatedAtEpochMs, 'updatedAtEpochMs')
  assertEpochMs(checkpoint.expiresAtEpochMs, 'expiresAtEpochMs')

  if (checkpoint.updatedAtEpochMs < checkpoint.createdAtEpochMs) {
    reject('updatedAtEpochMs cannot be before createdAtEpochMs')
  }

  assertPlainObject(checkpoint.round, 'round')
  assertUuid(checkpoint.round.clientRoundId, 'round.clientRoundId')
  assertUuid(checkpoint.round.backendSessionId, 'round.backendSessionId')

  if (!ROUND_PHASES.has(checkpoint.round.phase)) {
    reject('round.phase is invalid')
  }

  if (!Number.isSafeInteger(checkpoint.round.durationSeconds) ||
      checkpoint.round.durationSeconds <= 0) {
    reject('round.durationSeconds must be a positive integer')
  }

  assertEpochMs(
    checkpoint.round.startedAtEpochMs,
    'round.startedAtEpochMs',
    { nullable: true },
  )
  assertEpochMs(
    checkpoint.round.endsAtEpochMs,
    'round.endsAtEpochMs',
    { nullable: true },
  )

  if (checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.STARTING) {
    if (
      checkpoint.round.startedAtEpochMs !== null ||
      checkpoint.round.endsAtEpochMs !== null
    ) {
      reject('STARTING round cannot contain start/end timestamps')
    }
  } else {
    const expectedEnd =
      checkpoint.round.startedAtEpochMs +
      checkpoint.round.durationSeconds * 1000

    if (
      checkpoint.round.startedAtEpochMs === null ||
      checkpoint.round.endsAtEpochMs === null ||
      checkpoint.round.endsAtEpochMs !== expectedEnd
    ) {
      reject('RUNNING round timing is impossible')
    }

    if (
      checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RUNNING &&
      (
        checkpoint.updatedAtEpochMs < checkpoint.round.startedAtEpochMs ||
        checkpoint.updatedAtEpochMs >= checkpoint.round.endsAtEpochMs
      )
    ) {
      reject('RUNNING checkpoint update time is outside the active round')
    }

    if (
      checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING &&
      checkpoint.updatedAtEpochMs < checkpoint.round.endsAtEpochMs
    ) {
      reject('RECONCILING checkpoint cannot be updated before round end')
    }
  }

  assertPlainObject(checkpoint.player, 'player')
  assertPosition(checkpoint.player.settledPosition, 'player.settledPosition')
  assertFiniteNumber(
    checkpoint.player.simulationSpeedMetersPerSecond,
    'player.simulationSpeedMetersPerSecond',
    { minimum: Number.MIN_VALUE },
  )

  if (!Array.isArray(checkpoint.targets)) {
    reject('targets must be an array')
  }
  checkpoint.targets.forEach((target, index) =>
    assertTarget(target, `targets[${index}]`),
  )

  if (new Set(checkpoint.targets.map((target) => target.id)).size !==
      checkpoint.targets.length) {
    reject('targets contains duplicate target IDs')
  }

  if (!Array.isArray(checkpoint.caughtTargets)) {
    reject('caughtTargets must be an array')
  }
  checkpoint.caughtTargets.forEach((target, index) =>
    assertTarget(target, `caughtTargets[${index}]`, { caught: true }),
  )

  const caughtIds = new Set(checkpoint.caughtTargets.map((target) => target.id))
  if (caughtIds.size !== checkpoint.caughtTargets.length) {
    reject('caughtTargets contains duplicate target IDs')
  }

  if (checkpoint.targets.some((target) => caughtIds.has(target.id))) {
    reject('A target cannot be both active and caught')
  }

  assertNonNegativeInteger(checkpoint.score, 'score')
  assertNonNegativeInteger(checkpoint.xp, 'xp')

  assertPlainObject(checkpoint.spawning, 'spawning')
  if (typeof checkpoint.spawning.paused !== 'boolean') {
    reject('spawning.paused must be a boolean')
  }
  assertEpochMs(
    checkpoint.spawning.nextSpawnAtEpochMs,
    'spawning.nextSpawnAtEpochMs',
    { nullable: true },
  )

  assertPlainObject(checkpoint.backendSync, 'backendSync')
  if (!Array.isArray(checkpoint.backendSync.pendingCatches)) {
    reject('backendSync.pendingCatches must be an array')
  }
  checkpoint.backendSync.pendingCatches.forEach((pendingCatch, index) =>
    assertPendingCatch(pendingCatch, `backendSync.pendingCatches[${index}]`),
  )

  if (
    new Set(
      checkpoint.backendSync.pendingCatches.map(
        (pendingCatch) => pendingCatch.catchId,
      ),
    ).size !== checkpoint.backendSync.pendingCatches.length
  ) {
    reject('backendSync.pendingCatches contains duplicate catch IDs')
  }

  if (
    checkpoint.backendSync.pendingCatches.some(
      (pendingCatch) => !caughtIds.has(pendingCatch.targetId),
    )
  ) {
    reject('A pending backend catch must identify a caught target')
  }

  const expectedExpiry = calculateSoloCheckpointExpiresAt({
    phase: checkpoint.round.phase,
    createdAtEpochMs: checkpoint.createdAtEpochMs,
    endsAtEpochMs: checkpoint.round.endsAtEpochMs,
  })

  if (checkpoint.expiresAtEpochMs !== expectedExpiry) {
    reject('expiresAtEpochMs does not match the checkpoint TTL policy')
  }

  if (checkpoint.updatedAtEpochMs >= checkpoint.expiresAtEpochMs) {
    reject('Checkpoint cannot be updated at or after storage expiry')
  }

  const movementValidation = assertMovement(checkpoint.movement, checkpoint)

  if (checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.STARTING) {
    if (
      checkpoint.movement !== null ||
      checkpoint.targets.length > 0 ||
      checkpoint.caughtTargets.length > 0 ||
      checkpoint.score !== 0 ||
      checkpoint.xp !== 0 ||
      !checkpoint.spawning.paused ||
      checkpoint.spawning.nextSpawnAtEpochMs !== null ||
      checkpoint.backendSync.pendingCatches.length > 0
    ) {
      reject('STARTING checkpoint cannot contain active-round gameplay state')
    }
  }

  if (
    checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING &&
    (
      checkpoint.movement !== null ||
      checkpoint.targets.length > 0 ||
      !checkpoint.spawning.paused ||
      checkpoint.spawning.nextSpawnAtEpochMs !== null
    )
  ) {
    reject('RECONCILING checkpoint cannot contain active gameplay state')
  }

  const validated = structuredClone(checkpoint)

  if (movementValidation) {
    validated.movement.anchorDistanceMeters =
      movementValidation.anchorDistanceMeters
  }

  return validated
}

export function parseSoloRecoveryCheckpoint(checkpoint, options) {
  try {
    return {
      ok: true,
      checkpoint: validateSoloRecoveryCheckpoint(checkpoint, options),
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      checkpoint: null,
      error,
    }
  }
}
