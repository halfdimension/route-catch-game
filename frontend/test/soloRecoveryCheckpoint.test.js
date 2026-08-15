import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouteAnimationPlan } from '../src/hooks/useRouteAnimation.js'
import {
  SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED,
  SOLO_RECOVERY_ROUTE_DISTANCE_EPSILON_METERS,
  createSoloClientRoundId,
  createSoloMovementRecoveryId,
  createSoloPendingCatchId,
  isSoloCheckpointResumable,
  isSoloCheckpointStorageExpired,
  parseSoloRecoveryCheckpoint,
  validateSoloRecoveryCheckpoint,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import {
  SOLO_RECOVERY_IDENTITY_STATUS,
  createAuthenticatedSoloIdentityKey,
  createGuestSoloIdentityKey,
  getOrCreateGuestSoloIdentityKey,
  parseSoloIdentityKey,
  resolveSoloRecoveryIdentity,
} from '../src/recovery/soloRecoveryIdentity.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID as USER_ID,
} from './helpers/soloRecoveryFixtures.js'

const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'

test('valid v1 checkpoint is accepted without merging defaults', () => {
  const checkpoint = createValidSoloCheckpoint()
  const validated = validateSoloRecoveryCheckpoint(checkpoint, {
    expectedIdentityKey: checkpoint.identityKey,
  })

  assert.deepEqual(validated, checkpoint)
  assert.notEqual(validated, checkpoint)
})

test('valid v1 checkpoint accepts measured movement with duplicate coordinates', () => {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: 28.56, lon: 77.27 },
    chasedTargetId: null,
    routeCoordinates: [
      [28.55, 77.26],
      [28.55, 77.26],
      [28.56, 77.27],
    ],
    anchorDistanceMeters: 10,
    anchorTimeEpochMs: STARTED_AT + 4_000,
  }

  assert.equal(parseSoloRecoveryCheckpoint(checkpoint).ok, true)
})

test('unsupported schema versions and corrupted values are rejected', () => {
  const unsupported = createValidSoloCheckpoint()
  unsupported.schemaVersion = 2

  assert.equal(parseSoloRecoveryCheckpoint(unsupported).ok, false)
  assert.equal(parseSoloRecoveryCheckpoint('corrupted').ok, false)
  assert.throws(
    () => validateSoloRecoveryCheckpoint(unsupported),
    /Unsupported SOLO recovery schema version/,
  )
})

test('unknown round and movement enums are rejected', () => {
  const badRound = createValidSoloCheckpoint()
  badRound.round.phase = 'PAUSED'
  assert.equal(parseSoloRecoveryCheckpoint(badRound).ok, false)

  const badMovement = createValidSoloCheckpoint()
  badMovement.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: 'TELEPORTING',
    purpose: 'MAP',
    destination: { lat: 28.56, lon: 77.27 },
    chasedTargetId: null,
    routeCoordinates: null,
    anchorDistanceMeters: null,
    anchorTimeEpochMs: null,
  }
  assert.equal(parseSoloRecoveryCheckpoint(badMovement).ok, false)
})

test('malformed player and movement coordinates are rejected', () => {
  const badPlayer = createValidSoloCheckpoint()
  badPlayer.player.settledPosition.lat = 91
  assert.equal(parseSoloRecoveryCheckpoint(badPlayer).ok, false)

  const badMovement = createValidSoloCheckpoint()
  badMovement.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: 28.56, lon: 77.27 },
    chasedTargetId: null,
    routeCoordinates: [[28.55, 77.26], [Number.NaN, 77.27]],
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: STARTED_AT,
  }
  assert.equal(parseSoloRecoveryCheckpoint(badMovement).ok, false)
})

test('malformed target IDs and negative score or XP are rejected', () => {
  const badTarget = createValidSoloCheckpoint()
  badTarget.targets = [{
    id: 'not-a-uuid',
    creatureId: 'sparkbit',
    lat: 28.55,
    lon: 77.26,
    expiresAt: STARTED_AT + 20_000,
    rarity: 'common',
    score: 10,
  }]
  assert.equal(parseSoloRecoveryCheckpoint(badTarget).ok, false)

  const badScore = createValidSoloCheckpoint()
  badScore.score = -1
  assert.equal(parseSoloRecoveryCheckpoint(badScore).ok, false)

  const badXp = createValidSoloCheckpoint()
  badXp.xp = -1
  assert.equal(parseSoloRecoveryCheckpoint(badXp).ok, false)
})

test('current target gameplay fields validate while presentation metadata passes through', () => {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.targets = [{
    id: '99999999-9999-4999-8999-999999999999',
    creatureId: 'sparkbit',
    lat: 28.55,
    lon: 77.26,
    rawLat: 28.5501,
    rawLon: 77.2601,
    snappedToRoad: true,
    name: 'Sparkbit',
    rarity: 'common',
    score: 10,
    imageUrl: '/creatures/sparkbit.png',
    expiresAt: STARTED_AT + 20_000,
    routeDistanceMeters: 120.5,
    routeDurationSeconds: 90,
  }]

  const validated = validateSoloRecoveryCheckpoint(checkpoint)
  assert.deepEqual(validated.targets, checkpoint.targets)
})

test('impossible round timestamps are rejected', () => {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.round.endsAtEpochMs += 1
  checkpoint.expiresAtEpochMs += 1

  assert.throws(
    () => validateSoloRecoveryCheckpoint(checkpoint),
    /RUNNING round timing is impossible/,
  )
})

test('checkpoint validation rejects a different authenticated identity', () => {
  const checkpoint = createValidSoloCheckpoint()
  const otherIdentity = createAuthenticatedSoloIdentityKey(OTHER_USER_ID)

  assert.throws(
    () => validateSoloRecoveryCheckpoint(checkpoint, {
      expectedIdentityKey: otherIdentity,
    }),
    /does not match/,
  )
})

test('RUNNING checkpoint is not resumable after endsAt during TTL grace', () => {
  const checkpoint = createValidSoloCheckpoint()

  assert.equal(
    isSoloCheckpointResumable(
      checkpoint,
      checkpoint.round.endsAtEpochMs - 1,
    ),
    true,
  )
  assert.equal(
    isSoloCheckpointResumable(
      checkpoint,
      checkpoint.round.endsAtEpochMs,
    ),
    false,
  )
  assert.ok(checkpoint.expiresAtEpochMs > checkpoint.round.endsAtEpochMs)
})

test('checkpoint expiry applies the approved STARTING and RUNNING TTLs', () => {
  const starting = createValidSoloCheckpoint({
    phase: 'STARTING',
  })
  const running = createValidSoloCheckpoint()

  assert.equal(
    starting.expiresAtEpochMs - starting.createdAtEpochMs,
    2 * 60 * 1000,
  )
  assert.equal(
    running.expiresAtEpochMs - running.round.endsAtEpochMs,
    15 * 60 * 1000,
  )
})

test('STARTING retries cannot extend the stable creation-based TTL', () => {
  const starting = createValidSoloCheckpoint({ phase: 'STARTING' })
  const retried = {
    ...starting,
    updatedAtEpochMs: starting.updatedAtEpochMs + 30_000,
  }

  const validated = validateSoloRecoveryCheckpoint(retried)
  assert.equal(validated.expiresAtEpochMs, starting.expiresAtEpochMs)
})

test('STARTING requires spawning to remain explicitly paused', () => {
  const starting = createValidSoloCheckpoint({ phase: 'STARTING' })

  assert.equal(starting.spawning.paused, true)
  assert.equal(starting.spawning.nextSpawnAtEpochMs, null)
  assert.equal(parseSoloRecoveryCheckpoint(starting).ok, true)

  const activeSpawning = structuredClone(starting)
  activeSpawning.spawning.paused = false

  assert.throws(
    () => validateSoloRecoveryCheckpoint(activeSpawning),
    /STARTING checkpoint cannot contain active-round gameplay state/,
  )
})

test('post-end reconciliation is valid during grace but never resumable', () => {
  const running = createValidSoloCheckpoint()
  const reconciling = createValidSoloCheckpoint({
    phase: 'RECONCILING',
  })

  assert.equal(
    isSoloCheckpointResumable(running, running.round.endsAtEpochMs - 1),
    true,
  )
  assert.equal(
    isSoloCheckpointResumable(running, running.round.endsAtEpochMs),
    false,
  )
  assert.equal(
    parseSoloRecoveryCheckpoint(reconciling).ok,
    true,
  )
  assert.equal(
    isSoloCheckpointResumable(
      reconciling,
      reconciling.round.endsAtEpochMs + 1,
    ),
    false,
  )
  assert.equal(
    isSoloCheckpointStorageExpired(
      reconciling,
      reconciling.expiresAtEpochMs,
    ),
    true,
  )
})

test('near-end movement tolerance clamps floating-point excess only', () => {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.movement = {
    movementRecoveryId: createSoloMovementRecoveryId(
      () => '55555555-5555-4555-8555-555555555555',
    ),
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: 28.56, lon: 77.27 },
    chasedTargetId: null,
    routeCoordinates: [[28.55, 77.26], [28.56, 77.27]],
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: STARTED_AT + 4_000,
  }
  const baseline = validateSoloRecoveryCheckpoint(checkpoint)
  const totalDistanceMeters = createRouteAnimationPlan(
    baseline.movement.routeCoordinates,
  ).totalDistanceMeters

  checkpoint.movement.anchorDistanceMeters = totalDistanceMeters
  const exact = validateSoloRecoveryCheckpoint(checkpoint)
  assert.equal(exact.movement.anchorDistanceMeters, totalDistanceMeters)

  checkpoint.movement.anchorDistanceMeters =
    totalDistanceMeters + SOLO_RECOVERY_ROUTE_DISTANCE_EPSILON_METERS / 2
  const tolerated = validateSoloRecoveryCheckpoint(checkpoint)
  assert.equal(tolerated.movement.anchorDistanceMeters, totalDistanceMeters)

  checkpoint.movement.anchorDistanceMeters =
    totalDistanceMeters + SOLO_RECOVERY_ROUTE_DISTANCE_EPSILON_METERS * 2
  assert.throws(
    () => validateSoloRecoveryCheckpoint(checkpoint),
    /exceeds the route distance/,
  )
})

test('recovery-owned identifiers have explicit UUID generation boundaries', () => {
  const values = [
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '88888888-8888-4888-8888-888888888888',
  ]

  assert.equal(createSoloClientRoundId(() => values[0]), values[0])
  assert.equal(createSoloMovementRecoveryId(() => values[1]), values[1])
  assert.equal(createSoloPendingCatchId(() => values[2]), values[2])
  assert.equal(SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED, true)

  const checkpoint = createValidSoloCheckpoint()
  const target = {
    id: '99999999-9999-4999-8999-999999999999',
    creatureId: 'sparkbit',
    lat: 28.55,
    lon: 77.26,
    expiresAt: STARTED_AT + 20_000,
    caughtAt: STARTED_AT + 10_000,
    rarity: 'common',
    score: 10,
  }
  checkpoint.caughtTargets = [target]
  checkpoint.backendSync.pendingCatches = [{
    catchId: values[2],
    targetId: target.id,
    creatureId: target.creatureId,
    caughtAtEpochMs: target.caughtAt,
  }]
  checkpoint.movement = {
    movementRecoveryId: values[1],
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: 28.56, lon: 77.27 },
    chasedTargetId: null,
    routeCoordinates: [[28.55, 77.26], [28.56, 77.27]],
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: STARTED_AT + 4_000,
  }

  const runtimePlan = createRouteAnimationPlan(
    checkpoint.movement.routeCoordinates,
    42,
  )
  assert.equal(runtimePlan.routeRevision, 42)
  assert.equal(validateSoloRecoveryCheckpoint(checkpoint).movement.movementRecoveryId, values[1])
})

test('auth recovery identity remains unresolved until restoration completes', () => {
  let storageReads = 0
  const storage = {
    getItem() {
      storageReads += 1
      return null
    },
    setItem() {},
  }
  const unresolved = resolveSoloRecoveryIdentity({
    loadingAuth: true,
    isAuthenticated: false,
    currentUser: null,
    storage,
  })
  assert.deepEqual(unresolved, {
    status: SOLO_RECOVERY_IDENTITY_STATUS.UNRESOLVED,
    identityKey: null,
  })
  assert.equal(storageReads, 0)
  assert.equal(
    resolveSoloRecoveryIdentity({
      isAuthenticated: false,
      currentUser: null,
      storage,
    }).status,
    SOLO_RECOVERY_IDENTITY_STATUS.UNRESOLVED,
  )
  assert.equal(storageReads, 0)

  const authenticated = resolveSoloRecoveryIdentity({
    loadingAuth: false,
    isAuthenticated: true,
    currentUser: { userId: USER_ID },
    storage,
  })
  assert.deepEqual(authenticated, {
    status: SOLO_RECOVERY_IDENTITY_STATUS.AUTHENTICATED,
    identityKey: `user:${USER_ID}`,
  })

  const guestUuid = '66666666-6666-4666-8666-666666666666'
  const guest = resolveSoloRecoveryIdentity({
    loadingAuth: false,
    isAuthenticated: false,
    currentUser: null,
    storage,
    randomUuid: () => guestUuid,
  })
  assert.deepEqual(guest, {
    status: SOLO_RECOVERY_IDENTITY_STATUS.GUEST,
    identityKey: `guest:${guestUuid}`,
  })
})

test('identity helpers use immutable UUID namespaces and persist guest identity', () => {
  const values = new Map()
  const storage = {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
  const guestUuid = '66666666-6666-4666-8666-666666666666'
  const first = getOrCreateGuestSoloIdentityKey({
    storage,
    randomUuid: () => guestUuid,
  })
  const second = getOrCreateGuestSoloIdentityKey({
    storage,
    randomUuid: () => {
      throw new Error('stored UUID should be reused')
    },
  })

  assert.equal(first, createGuestSoloIdentityKey(guestUuid))
  assert.equal(second, first)
  assert.deepEqual(parseSoloIdentityKey(first), {
    kind: 'guest',
    subjectId: guestUuid,
    identityKey: first,
  })
  assert.equal(
    createAuthenticatedSoloIdentityKey(USER_ID),
    `user:${USER_ID}`,
  )
})
