import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRouteAnimationPlan,
} from '../src/hooks/useRouteAnimation.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import { reconcileSoloTargetRecoveryTimeline } from '../src/recovery/soloTargetRecoveryTimeline.js'
import {
  applySoloTargetCatchTransition,
  normalizeSoloTargetCollections,
} from '../src/recovery/soloTargetState.js'
import { findEarliestSoloRouteCatchDistance } from '../src/utils/soloCatchGeometry.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
} from './helpers/soloRecoveryFixtures.js'

const START = [28.5505, 77.2688]
const ROUTE = [START, [START[0], START[1] + 0.003]]
const MOVEMENT_ID = '55555555-5555-4555-8555-555555555555'
const TARGET_IDS = [
  '66666666-6666-4666-8666-666666666661',
  '66666666-6666-4666-8666-666666666662',
  '66666666-6666-4666-8666-666666666663',
]

function target({
  id = TARGET_IDS[0],
  longitudeOffset = 0.001,
  expiresAt = STARTED_AT + 50_000,
  creatureId = 'sparkbit',
  score = 10,
} = {}) {
  return {
    id,
    creatureId,
    lat: START[0],
    lon: START[1] + longitudeOffset,
    rawLat: START[0],
    rawLon: START[1] + longitudeOffset,
    snappedToRoad: true,
    rarity: 'common',
    score,
    spawnedAt: STARTED_AT,
    expiresAt,
    lifetimeMs: 50_000,
  }
}

function movingCheckpoint({
  targets = [target()],
  purpose = SOLO_RECOVERY_MOVEMENT_PURPOSES.MAP,
  nowAnchor = STARTED_AT + 5_000,
  durationSeconds = 60,
} = {}) {
  const checkpoint = createValidSoloCheckpoint({
    durationSeconds,
    updatedAtEpochMs: nowAnchor,
  })
  checkpoint.player.settledPosition = { lat: START[0], lon: START[1] }
  checkpoint.player.simulationSpeedMetersPerSecond = 10
  checkpoint.targets = targets
  checkpoint.movement = {
    movementRecoveryId: MOVEMENT_ID,
    phase: SOLO_RECOVERY_MOVEMENT_PHASES.MOVING,
    purpose,
    destination: { lat: ROUTE.at(-1)[0], lon: ROUTE.at(-1)[1] },
    chasedTargetId:
      purpose === SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE
        ? targets[0].id
        : null,
    routeCoordinates: ROUTE,
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: nowAnchor,
  }
  return checkpoint
}

function catchIdFactory() {
  let index = 0
  return () => {
    index += 1
    return `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
  }
}

test('known targets normalize from catalog, retain instance data, and unknown entries are discarded', () => {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.targets = [
    {
      ...target(),
      name: 'Persisted spoof',
      symbol: 'X',
      spawnedAt: undefined,
    },
    target({ id: TARGET_IDS[1], creatureId: 'missing-creature' }),
  ]
  const normalized = normalizeSoloTargetCollections(checkpoint)

  assert.equal(normalized.targets.length, 1)
  assert.equal(normalized.targets[0].id, TARGET_IDS[0])
  assert.equal(normalized.targets[0].name, 'Sparkbit')
  assert.equal(normalized.targets[0].symbol, '✦')
  assert.equal(Number.isFinite(normalized.targets[0].spawnedAt), true)
  assert.equal(normalized.targets[0].lon, target().lon)
})

test('active target and score/xp hydrate without awarding an existing catch again', () => {
  const checkpoint = createValidSoloCheckpoint({ score: 10 })
  const caught = { ...target(), caughtAt: STARTED_AT + 2_000 }
  checkpoint.caughtTargets = [caught]
  checkpoint.targets = []
  checkpoint.backendSync.pendingCatches = [{
    catchId: '77777777-7777-4777-8777-777777777777',
    targetId: caught.id,
    creatureId: caught.creatureId,
    caughtAtEpochMs: caught.caughtAt,
  }]
  const replay = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(replay.checkpoint.score, 10)
  assert.equal(replay.checkpoint.xp, 10)
  assert.equal(replay.checkpoint.caughtTargets.length, 1)
  assert.equal(replay.checkpoint.backendSync.pendingCatches.length, 1)
})

test('MAP downtime catches a crossed target and movement continues to recovery time', () => {
  const checkpoint = movingCheckpoint()
  const replay = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 20_000,
    createCatchId: catchIdFactory(),
  })

  assert.equal(replay.checkpoint.targets.length, 0)
  assert.equal(replay.checkpoint.caughtTargets.length, 1)
  assert.equal(replay.checkpoint.score, 10)
  assert.equal(replay.checkpoint.xp, 10)
  assert.equal(replay.checkpoint.backendSync.pendingCatches.length, 1)
  assert.equal(replay.checkpoint.movement.phase, 'MOVING')
  assert.equal(replay.checkpoint.movement.anchorTimeEpochMs, STARTED_AT + 20_000)
  assert.ok(replay.checkpoint.movement.anchorDistanceMeters > 140)
})

test('multiple MAP targets are caught chronologically and exactly once', () => {
  const checkpoint = movingCheckpoint({
    targets: [
      target({ id: TARGET_IDS[0], longitudeOffset: 0.0008 }),
      target({ id: TARGET_IDS[1], longitudeOffset: 0.0014 }),
    ],
  })
  const replay = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 25_000,
    createCatchId: catchIdFactory(),
  })
  const repeated = reconcileSoloTargetRecoveryTimeline(replay.checkpoint, {
    nowEpochMs: STARTED_AT + 25_000,
    createCatchId: catchIdFactory(),
  })

  assert.equal(replay.checkpoint.score, 20)
  assert.equal(replay.checkpoint.xp, 20)
  assert.deepEqual(
    replay.checkpoint.backendSync.pendingCatches.map((entry) => entry.targetId),
    [TARGET_IDS[0], TARGET_IDS[1]],
  )
  assert.ok(
    replay.checkpoint.backendSync.pendingCatches[0].caughtAtEpochMs <
      replay.checkpoint.backendSync.pendingCatches[1].caughtAtEpochMs,
  )
  assert.equal(repeated.checkpoint.score, 20)
  assert.equal(repeated.checkpoint.backendSync.pendingCatches.length, 2)
})

test('CHASE catch freezes the player at logical catch position', () => {
  const checkpoint = movingCheckpoint({
    purpose: SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE,
  })
  const replay = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 30_000,
    createCatchId: catchIdFactory(),
  })
  const caught = replay.checkpoint.caughtTargets[0]

  assert.equal(replay.checkpoint.movement, null)
  assert.equal(replay.checkpoint.score, 10)
  assert.ok(replay.checkpoint.player.settledPosition.lon < caught.lon)
  assert.ok(
    replay.checkpoint.player.settledPosition.lon <
      ROUTE.at(-1)[1] - 0.001,
  )
})

test('CHASE expiry before catch removes target and freezes movement at expiry', () => {
  const expiring = target({ expiresAt: STARTED_AT + 8_000 })
  const checkpoint = movingCheckpoint({
    targets: [expiring],
    purpose: SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE,
  })
  const replay = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 20_000,
    createCatchId: catchIdFactory(),
  })

  assert.equal(replay.checkpoint.targets.length, 0)
  assert.equal(replay.checkpoint.caughtTargets.length, 0)
  assert.equal(replay.checkpoint.movement, null)
  assert.ok(replay.checkpoint.player.settledPosition.lon > START[1])
  assert.ok(replay.checkpoint.player.settledPosition.lon < expiring.lon)
})

test('route completion and round end prevent later catches', () => {
  const beyondRoute = target({ longitudeOffset: 0.004 })
  const completedRoute = reconcileSoloTargetRecoveryTimeline(
    movingCheckpoint({ targets: [beyondRoute] }),
    {
      nowEpochMs: STARTED_AT + 50_000,
      createCatchId: catchIdFactory(),
    },
  )
  const roundEnded = reconcileSoloTargetRecoveryTimeline(
    movingCheckpoint({
      targets: [target({ longitudeOffset: 0.0025 })],
      durationSeconds: 10,
    }),
    {
      nowEpochMs: STARTED_AT + 20_000,
      createCatchId: catchIdFactory(),
    },
  )

  assert.equal(completedRoute.checkpoint.caughtTargets.length, 0)
  assert.equal(completedRoute.checkpoint.movement, null)
  assert.equal(roundEnded.checkpoint.caughtTargets.length, 0)
  assert.equal(roundEnded.checkpoint.movement, null)
})

test('expiry wins an exact catch-time tie', () => {
  const checkpoint = movingCheckpoint()
  const plan = createRouteAnimationPlan(ROUTE)
  const catchDistance = findEarliestSoloRouteCatchDistance(
    plan,
    checkpoint.targets[0],
  )
  const catchTime = checkpoint.movement.anchorTimeEpochMs +
    catchDistance / checkpoint.player.simulationSpeedMetersPerSecond * 1000
  checkpoint.targets[0].expiresAt = catchTime
  const replay = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 20_000,
    createCatchId: catchIdFactory(),
  })

  assert.equal(replay.checkpoint.caughtTargets.length, 0)
  assert.equal(replay.checkpoint.targets.length, 0)
})

test('spawn cadence preserves future deadlines, skips missed bursts, and keeps pause', () => {
  const future = createValidSoloCheckpoint()
  future.spawning.nextSpawnAtEpochMs = STARTED_AT + 20_000
  const futureReplay = reconcileSoloTargetRecoveryTimeline(future, {
    nowEpochMs: STARTED_AT + 10_000,
  })
  const missed = createValidSoloCheckpoint()
  missed.spawning.nextSpawnAtEpochMs = STARTED_AT + 6_000
  const missedReplay = reconcileSoloTargetRecoveryTimeline(missed, {
    nowEpochMs: STARTED_AT + 10_000,
  })
  const paused = createValidSoloCheckpoint()
  paused.spawning = { paused: true, nextSpawnAtEpochMs: null }
  const pausedReplay = reconcileSoloTargetRecoveryTimeline(paused, {
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(
    futureReplay.checkpoint.spawning.nextSpawnAtEpochMs,
    STARTED_AT + 20_000,
  )
  assert.equal(
    missedReplay.checkpoint.spawning.nextSpawnAtEpochMs,
    STARTED_AT + 15_000,
  )
  assert.deepEqual(pausedReplay.checkpoint.spawning, {
    paused: true,
    nextSpawnAtEpochMs: null,
  })
})

test('catch transition is idempotent for score, XP, and pending intent', () => {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.targets = [target()]
  const first = applySoloTargetCatchTransition(checkpoint, {
    targetId: TARGET_IDS[0],
    caughtAtEpochMs: STARTED_AT + 2_000,
    createCatchId: catchIdFactory(),
  })
  const second = applySoloTargetCatchTransition(first.state, {
    targetId: TARGET_IDS[0],
    caughtAtEpochMs: STARTED_AT + 3_000,
    createCatchId: catchIdFactory(),
  })

  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  assert.equal(second.duplicate, true)
  assert.equal(second.caughtTarget, null)
  assert.equal(second.state.score, 10)
  assert.equal(second.state.xp, 10)
  assert.equal(second.state.caughtTargets.length, 1)
  assert.equal(second.state.backendSync.pendingCatches.length, 1)
})
