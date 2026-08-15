import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRouteAnimationPlan,
  sampleRoutePosition,
} from '../src/hooks/useRouteAnimation.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import { reconcileSoloTargetRecoveryTimeline } from '../src/recovery/soloTargetRecoveryTimeline.js'
import {
  SOLO_ROUTE_EVENT_TYPES,
  getSoloRouteTimeAtDistance,
  resolveSoloLiveCatchInterval,
} from '../src/utils/soloRouteCatchEvents.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
} from './helpers/soloRecoveryFixtures.js'

const ROUTE = [[0, 0], [0, 0.001]]
const PLAN = createRouteAnimationPlan(ROUTE)
const ANCHOR_TIME = STARTED_AT + 5_000
const SPEED_METERS_PER_SECOND = 50
const MOVEMENT_ID = '55555555-5555-4555-8555-555555555555'
const TARGET_IDS = [
  '66666666-6666-4666-8666-666666666661',
  '66666666-6666-4666-8666-666666666662',
  '66666666-6666-4666-8666-666666666663',
]

function longitudeAtDistance(distanceMeters) {
  return distanceMeters / 111_195
}

function targetAtDistance(distanceMeters, {
  id = TARGET_IDS[0],
  latitudeMeters = 0,
  expiresAt = STARTED_AT + 50_000,
} = {}) {
  return {
    id,
    creatureId: 'sparkbit',
    lat: latitudeMeters / 111_195,
    lon: longitudeAtDistance(distanceMeters),
    rarity: 'common',
    score: 10,
    spawnedAt: STARTED_AT,
    expiresAt,
    lifetimeMs: expiresAt - STARTED_AT,
  }
}

function movementAnchor() {
  return {
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: ANCHOR_TIME,
    speedMetersPerSecond: SPEED_METERS_PER_SECOND,
  }
}

function liveAcrossRoute(targets, overrides = {}) {
  return resolveSoloLiveCatchInterval({
    plan: PLAN,
    targets,
    startDistanceMeters: 0,
    endDistanceMeters: PLAN.totalDistanceMeters,
    windowStartEpochMs: ANCHOR_TIME,
    windowEndEpochMs: ANCHOR_TIME + 3_000,
    movementAnchor: movementAnchor(),
    roundEndsAtEpochMs: STARTED_AT + 60_000,
    ...overrides,
  })
}

function recoveredAcrossRoute(targets, {
  roundEndsAtEpochMs = STARTED_AT + 60_000,
} = {}) {
  const checkpoint = createValidSoloCheckpoint({
    updatedAtEpochMs: ANCHOR_TIME,
  })
  checkpoint.round.endsAtEpochMs = roundEndsAtEpochMs
  checkpoint.targets = structuredClone(targets)
  checkpoint.player.settledPosition = { lat: 0, lon: 0 }
  checkpoint.player.simulationSpeedMetersPerSecond =
    SPEED_METERS_PER_SECOND
  checkpoint.movement = {
    movementRecoveryId: MOVEMENT_ID,
    phase: SOLO_RECOVERY_MOVEMENT_PHASES.MOVING,
    purpose: SOLO_RECOVERY_MOVEMENT_PURPOSES.MAP,
    destination: { lat: 0, lon: 0.001 },
    chasedTargetId: null,
    routeCoordinates: ROUTE,
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: ANCHOR_TIME,
  }
  return reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: ANCHOR_TIME + 3_000,
    roundEndsAtEpochMs,
  })
}

test('large live interval catches a middle crossing missed by both endpoints', () => {
  const target = targetAtDistance(50)
  const result = liveAcrossRoute([target], {
    endDistanceMeters: 100,
    windowEndEpochMs: ANCHOR_TIME + 2_000,
  })

  assert.deepEqual(result.entries.map((entry) => entry.targetId), [target.id])
  assert.ok(result.entries[0].catchDistanceMeters > 24)
  assert.ok(result.entries[0].catchDistanceMeters < 26)
})

test('live and recovery catch the same route crossing at the same logical time', () => {
  const target = targetAtDistance(50)
  const live = liveAcrossRoute([target])
  const recovered = recoveredAcrossRoute([target])

  assert.deepEqual(
    recovered.checkpoint.backendSync.pendingCatches.map(
      (entry) => entry.targetId,
    ),
    live.entries.map((entry) => entry.targetId),
  )
  assert.ok(Math.abs(
    recovered.checkpoint.caughtTargets[0].caughtAt -
      live.entries[0].caughtAtEpochMs,
  ) < 0.001)
})

test('high-speed multiple crossings have identical chronological order', () => {
  const targets = [
    targetAtDistance(80, { id: TARGET_IDS[2] }),
    targetAtDistance(40, { id: TARGET_IDS[0] }),
    targetAtDistance(60, { id: TARGET_IDS[1] }),
  ]
  const live = liveAcrossRoute(targets)
  const recovered = recoveredAcrossRoute(targets)
  const recoveredOrder = recovered.checkpoint.backendSync.pendingCatches.map(
    (entry) => entry.targetId,
  )

  assert.deepEqual(live.entries.map((entry) => entry.targetId), TARGET_IDS)
  assert.deepEqual(recoveredOrder, TARGET_IDS)
})

test('CHASE interval includes earlier catches and truncates all later entries', () => {
  const longPlan = createRouteAnimationPlan([[0, 0], [0, 0.006]])
  const targets = [
    targetAtDistance(200, { id: TARGET_IDS[0] }),
    targetAtDistance(275, { id: TARGET_IDS[1] }),
    targetAtDistance(475, { id: TARGET_IDS[2] }),
  ]
  const anchor = {
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: ANCHOR_TIME,
    speedMetersPerSecond: 100,
  }
  const result = resolveSoloLiveCatchInterval({
    plan: longPlan,
    targets,
    startDistanceMeters: 100,
    endDistanceMeters: 500,
    windowStartEpochMs: ANCHOR_TIME + 1_000,
    windowEndEpochMs: ANCHOR_TIME + 5_000,
    movementAnchor: anchor,
    roundEndsAtEpochMs: STARTED_AT + 60_000,
    chasedTargetId: TARGET_IDS[1],
  })

  assert.deepEqual(
    result.entries.map((entry) => entry.targetId),
    [TARGET_IDS[0], TARGET_IDS[1]],
  )
  assert.equal(result.terminal.targetId, TARGET_IDS[1])
  assert.ok(result.terminal.distanceMeters > 249)
  assert.ok(result.terminal.distanceMeters < 251)
})

test('a segment miss is a miss in both live and recovery processing', () => {
  const target = targetAtDistance(50, { latitudeMeters: 30 })
  const live = liveAcrossRoute([target])
  const recovered = recoveredAcrossRoute([target])

  assert.deepEqual(live.entries, [])
  assert.deepEqual(recovered.checkpoint.caughtTargets, [])
})

test('expiry before crossing and exact expiry tie both defeat catch', () => {
  const baseline = targetAtDistance(50)
  const catchDistance = liveAcrossRoute([baseline]).entries[0]
    .catchDistanceMeters
  const catchTime = getSoloRouteTimeAtDistance(
    movementAnchor(),
    catchDistance,
  )

  for (const expiresAt of [catchTime - 1, catchTime]) {
    const target = targetAtDistance(50, { expiresAt })
    const live = liveAcrossRoute([target])
    const recovered = recoveredAcrossRoute([target])

    assert.deepEqual(live.entries, [])
    assert.deepEqual(recovered.checkpoint.caughtTargets, [])
  }
})

test('catch exactly at round end is rejected by live and recovery', () => {
  const target = targetAtDistance(50)
  const catchDistance = liveAcrossRoute([target]).entries[0]
    .catchDistanceMeters
  const roundEndsAtEpochMs = getSoloRouteTimeAtDistance(
    movementAnchor(),
    catchDistance,
  )
  const live = liveAcrossRoute([target], { roundEndsAtEpochMs })
  const recovered = recoveredAcrossRoute([target], { roundEndsAtEpochMs })

  assert.deepEqual(live.entries, [])
  assert.deepEqual(recovered.checkpoint.caughtTargets, [])
})

function recoverDelayedTerminal({
  route,
  targets,
  roundEndsAtEpochMs,
  chasedTargetId = null,
  nowEpochMs,
}) {
  const checkpoint = createValidSoloCheckpoint({
    updatedAtEpochMs: ANCHOR_TIME,
  })
  checkpoint.round.durationSeconds =
    (roundEndsAtEpochMs - STARTED_AT) / 1000
  checkpoint.round.endsAtEpochMs = roundEndsAtEpochMs
  checkpoint.targets = structuredClone(targets)
  checkpoint.player.settledPosition = { lat: 0, lon: 0 }
  checkpoint.player.simulationSpeedMetersPerSecond = 100
  checkpoint.movement = {
    movementRecoveryId: MOVEMENT_ID,
    phase: SOLO_RECOVERY_MOVEMENT_PHASES.MOVING,
    purpose: chasedTargetId
      ? SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE
      : SOLO_RECOVERY_MOVEMENT_PURPOSES.MAP,
    destination: {
      lat: route.at(-1)[0],
      lon: route.at(-1)[1],
    },
    chasedTargetId,
    routeCoordinates: route,
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: ANCHOR_TIME,
  }
  return reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs,
    roundEndsAtEpochMs,
  })
}

test('delayed CHASE expiry has the same exact terminal in live and recovery', () => {
  const route = [[0, 0], [0, 0.006]]
  const plan = createRouteAnimationPlan(route)
  const expiresAt = ANCHOR_TIME + 2_000
  const targets = [
    targetAtDistance(100, { id: TARGET_IDS[0] }),
    targetAtDistance(500, { id: TARGET_IDS[1], expiresAt }),
    targetAtDistance(250, { id: TARGET_IDS[2] }),
  ]
  const nowEpochMs = ANCHOR_TIME + 5_000
  const roundEndsAtEpochMs = STARTED_AT + 60_000
  const anchor = {
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: ANCHOR_TIME,
    speedMetersPerSecond: 100,
  }
  const live = resolveSoloLiveCatchInterval({
    plan,
    targets,
    startDistanceMeters: 0,
    endDistanceMeters: 500,
    windowStartEpochMs: ANCHOR_TIME,
    windowEndEpochMs: nowEpochMs,
    movementAnchor: anchor,
    roundEndsAtEpochMs,
    chasedTargetId: TARGET_IDS[1],
  })
  const recovered = recoverDelayedTerminal({
    route,
    targets,
    roundEndsAtEpochMs,
    chasedTargetId: TARGET_IDS[1],
    nowEpochMs,
  })
  const expectedPosition = sampleRoutePosition(plan, 200)

  assert.equal(live.terminal.type, SOLO_ROUTE_EVENT_TYPES.TARGET_EXPIRY)
  assert.equal(live.terminal.atEpochMs, expiresAt)
  assert.equal(live.terminal.distanceMeters, 200)
  assert.deepEqual(live.entries.map((entry) => entry.targetId), [TARGET_IDS[0]])
  assert.deepEqual(
    recovered.checkpoint.caughtTargets.map((target) => target.id),
    [TARGET_IDS[0]],
  )
  assert.equal(recovered.checkpoint.score, 10)
  assert.equal(recovered.checkpoint.xp, 10)
  assert.equal(
    live.entries.reduce((score, entry) => score + entry.target.score, 0),
    recovered.checkpoint.score,
  )
  assert.deepEqual(
    recovered.checkpoint.targets.map((target) => target.id),
    [TARGET_IDS[2]],
  )
  assert.equal(recovered.checkpoint.movement, null)
  assert.ok(Math.abs(
    recovered.checkpoint.player.settledPosition.lon - expectedPosition.lon,
  ) < 1e-12)
})

test('delayed round end has the same exact terminal in live and recovery', () => {
  const route = [[0, 0], [0, 0.006]]
  const plan = createRouteAnimationPlan(route)
  const roundEndsAtEpochMs = ANCHOR_TIME + 2_000
  const targets = [
    targetAtDistance(100, { id: TARGET_IDS[0] }),
    targetAtDistance(250, { id: TARGET_IDS[2] }),
  ]
  const nowEpochMs = ANCHOR_TIME + 5_000
  const anchor = {
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: ANCHOR_TIME,
    speedMetersPerSecond: 100,
  }
  const live = resolveSoloLiveCatchInterval({
    plan,
    targets,
    startDistanceMeters: 0,
    endDistanceMeters: 500,
    windowStartEpochMs: ANCHOR_TIME,
    windowEndEpochMs: nowEpochMs,
    movementAnchor: anchor,
    roundEndsAtEpochMs,
  })
  const recovered = recoverDelayedTerminal({
    route,
    targets,
    roundEndsAtEpochMs,
    nowEpochMs,
  })
  const expectedPosition = sampleRoutePosition(plan, 200)

  assert.equal(live.terminal.type, SOLO_ROUTE_EVENT_TYPES.ROUND_END)
  assert.equal(live.terminal.atEpochMs, roundEndsAtEpochMs)
  assert.equal(live.terminal.distanceMeters, 200)
  assert.deepEqual(live.entries.map((entry) => entry.targetId), [TARGET_IDS[0]])
  assert.deepEqual(
    recovered.checkpoint.caughtTargets.map((target) => target.id),
    [TARGET_IDS[0]],
  )
  assert.equal(recovered.checkpoint.score, 10)
  assert.equal(recovered.checkpoint.xp, 10)
  assert.equal(
    live.entries.reduce((score, entry) => score + entry.target.score, 0),
    recovered.checkpoint.score,
  )
  assert.deepEqual(
    recovered.checkpoint.targets.map((target) => target.id),
    [TARGET_IDS[2]],
  )
  assert.equal(recovered.checkpoint.movement, null)
  assert.ok(Math.abs(
    recovered.checkpoint.player.settledPosition.lon - expectedPosition.lon,
  ) < 1e-12)
})
