import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRouteAnimationPlan,
  reconstructAnchoredRouteMovement,
} from '../src/hooks/useRouteAnimation.js'
import {
  SOLO_RECOVERY_BOOTSTRAP_KINDS,
  SOLO_BACKEND_SYNC_WARNING,
  SOLO_RECOVERY_UNAVAILABLE_WARNING,
  bootstrapSoloRecovery,
  buildSoloRunningCheckpoint,
  resolveRecoveredSoloMovement,
} from '../src/recovery/soloRecoveryRuntime.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

const ROUTE = [[28.55, 77.26], [28.65, 77.26]]
const MOVEMENT_ID = '55555555-5555-4555-8555-555555555555'

function createBackendSession(checkpoint, overrides = {}) {
  return {
    sessionId: checkpoint.round.backendSessionId,
    status: 'RUNNING',
    durationSeconds: checkpoint.round.durationSeconds,
    startedAt: new Date(checkpoint.round.startedAtEpochMs).toISOString(),
    endedAt: null,
    score: 0,
    caughtCount: 0,
    userId: SOLO_RECOVERY_TEST_USER_ID,
    ...overrides,
  }
}

function createMemoryStore(initialCheckpoint) {
  let checkpoint = initialCheckpoint
  const calls = []

  return {
    calls,
    get checkpoint() {
      return checkpoint
    },
    async sweep(identityKey, nowEpochMs) {
      calls.push(['sweep', identityKey, nowEpochMs])
      return { ok: true, deletedIdentityKeys: [] }
    },
    async read(identityKey) {
      calls.push(['read', identityKey])
      return { ok: true, checkpoint: structuredClone(checkpoint) }
    },
    async replace(identityKey, replacement) {
      calls.push(['replace', identityKey])
      checkpoint = structuredClone(replacement)
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push(['delete', identityKey])
      checkpoint = null
      return { ok: true, operation: 'delete' }
    },
  }
}

function runScopedBootstrap(options) {
  return bootstrapSoloRecovery({
    ...options,
    writer: {
      replace: (checkpoint) =>
        options.store.replace(options.identityKey, checkpoint),
      delete: () => options.store.delete(options.identityKey),
    },
    isCurrent: () => true,
  })
}

function withMovingCheckpoint({ speed, anchorDistance = 100 } = {}) {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.player.simulationSpeedMetersPerSecond = speed
  checkpoint.movement = {
    movementRecoveryId: MOVEMENT_ID,
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: ROUTE.at(-1)[0], lon: ROUTE.at(-1)[1] },
    chasedTargetId: null,
    routeCoordinates: ROUTE,
    anchorDistanceMeters: anchorDistance,
    anchorTimeEpochMs: STARTED_AT + 1_000,
  }
  return checkpoint
}

test('checkpoint builder retains stable round identity and real movement state', () => {
  const previous = withMovingCheckpoint({ speed: 80 })
  const timeline = {
    durationSeconds: previous.round.durationSeconds,
    startedAtEpochMs: previous.round.startedAtEpochMs,
    endsAtEpochMs: previous.round.endsAtEpochMs,
  }
  const checkpoint = buildSoloRunningCheckpoint({
    identityKey: previous.identityKey,
    backendSessionId: previous.round.backendSessionId,
    timeline,
    playerPosition: { lat: 28.56, lon: 77.26 },
    simulationSpeedMetersPerSecond: 120,
    movement: previous.movement,
    previousCheckpoint: previous,
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(
    checkpoint.round.clientRoundId,
    previous.round.clientRoundId,
  )
  assert.equal(checkpoint.createdAtEpochMs, previous.createdAtEpochMs)
  assert.deepEqual(checkpoint.movement, previous.movement)
  assert.equal(checkpoint.player.simulationSpeedMetersPerSecond, 120)
})

test('checkpoint builder preserves durable gameplay fields only for the same round', () => {
  const previous = createValidSoloCheckpoint({ score: 25 })
  const timeline = {
    durationSeconds: previous.round.durationSeconds,
    startedAtEpochMs: previous.round.startedAtEpochMs,
    endsAtEpochMs: previous.round.endsAtEpochMs,
  }
  const common = {
    identityKey: previous.identityKey,
    backendSessionId: previous.round.backendSessionId,
    timeline,
    playerPosition: previous.player.settledPosition,
    simulationSpeedMetersPerSecond: 80,
    previousCheckpoint: previous,
    nowEpochMs: STARTED_AT + 10_000,
  }

  const sameRound = buildSoloRunningCheckpoint(common)
  assert.equal(sameRound.score, 25)
  assert.equal(sameRound.xp, 25)
  assert.equal(sameRound.createdAtEpochMs, previous.createdAtEpochMs)

  for (const incompatible of [
    {
      ...common,
      clientRoundId: '66666666-6666-4666-8666-666666666666',
    },
    {
      ...common,
      identityKey: 'user:22222222-2222-4222-8222-222222222222',
    },
    {
      ...common,
      backendSessionId: '77777777-7777-4777-8777-777777777777',
    },
  ]) {
    const fresh = buildSoloRunningCheckpoint(incompatible)
    assert.equal(fresh.score, 0)
    assert.equal(fresh.xp, 0)
    assert.deepEqual(fresh.targets, [])
    assert.deepEqual(fresh.caughtTargets, [])
    assert.deepEqual(fresh.backendSync.pendingCatches, [])
    assert.equal(fresh.createdAtEpochMs, STARTED_AT + 10_000)
  }
})

for (const speed of [5, 700]) {
  test(`${speed} m/s movement reconstructs its current downtime position`, () => {
    const checkpoint = withMovingCheckpoint({ speed })
    const nowEpochMs = STARTED_AT + 6_000
    const result = resolveRecoveredSoloMovement(checkpoint, nowEpochMs)
    const expected = reconstructAnchoredRouteMovement(
      createRouteAnimationPlan(ROUTE),
      {
        anchorDistanceMeters: 100,
        anchorTimeEpochMs: STARTED_AT + 1_000,
        speedMetersPerSecond: speed,
      },
      nowEpochMs,
    )

    assert.equal(result.kind, 'MOVING')
    assert.deepEqual(result.position, expected.position)
    assert.equal(
      result.movementAnchor.anchorDistanceMeters,
      expected.distanceTraveledMeters,
    )
    assert.equal(result.movementAnchor.anchorTimeEpochMs, nowEpochMs)
  })
}

test('movement completed during downtime settles at the route destination', () => {
  const checkpoint = withMovingCheckpoint({ speed: 700 })
  const result = resolveRecoveredSoloMovement(
    checkpoint,
    STARTED_AT + 59_000,
  )

  assert.equal(result.kind, 'COMPLETED')
  assert.deepEqual(result.position, { lat: 28.65, lon: 77.26 })
  assert.equal(result.movement, null)
})

test('MAP and catalog-valid CHASE routing are reissuable after target hydration', () => {
  const mapCheckpoint = createValidSoloCheckpoint()
  mapCheckpoint.movement = {
    movementRecoveryId: MOVEMENT_ID,
    phase: 'ROUTING',
    purpose: 'MAP',
    destination: { lat: 28.56, lon: 77.27 },
    chasedTargetId: null,
    routeCoordinates: null,
    anchorDistanceMeters: null,
    anchorTimeEpochMs: null,
  }
  assert.equal(
    resolveRecoveredSoloMovement(mapCheckpoint, STARTED_AT + 10_000).kind,
    'ROUTING',
  )

  const chaseCheckpoint = structuredClone(mapCheckpoint)
  const targetId = '99999999-9999-4999-8999-999999999999'
  chaseCheckpoint.targets = [{
    id: targetId,
    creatureId: 'sparkbit',
    lat: 28.56,
    lon: 77.27,
    expiresAt: STARTED_AT + 30_000,
  }]
  chaseCheckpoint.movement.purpose = 'CHASE'
  chaseCheckpoint.movement.chasedTargetId = targetId
  assert.equal(
    resolveRecoveredSoloMovement(chaseCheckpoint, STARTED_AT + 10_000).kind,
    'ROUTING',
  )
})

test('backend RUNNING timing wins and the reconciled checkpoint resumes', async () => {
  const checkpoint = createValidSoloCheckpoint({ score: 25 })
  const store = createMemoryStore(checkpoint)
  const backendStartedAt = STARTED_AT + 2_000
  const backend = createBackendSession(checkpoint, {
    durationSeconds: 90,
    startedAt: new Date(backendStartedAt).toISOString(),
  })
  const recovery = await runScopedBootstrap({
    identityKey: checkpoint.identityKey,
    store,
    getBackendSession: async () => backend,
    endBackendSession: async () => assert.fail('must not end'),
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME)
  assert.equal(recovery.timeline.startedAtEpochMs, backendStartedAt)
  assert.equal(recovery.timeline.durationSeconds, 90)
  assert.equal(store.checkpoint.round.endsAtEpochMs, backendStartedAt + 90_000)
  assert.equal(
    store.checkpoint.round.clientRoundId,
    checkpoint.round.clientRoundId,
  )
  assert.equal(store.checkpoint.score, 25)
  assert.equal(store.checkpoint.xp, 25)
  assert.ok(store.calls.some(([operation]) => operation === 'replace'))
})

test('failed authoritative reconciliation write still resumes but disables persistence', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(checkpoint)
  store.replace = async () => ({
    ok: false,
    operation: 'replace',
    error: new Error('disk unavailable'),
  })
  const recovery = await runScopedBootstrap({
    identityKey: checkpoint.identityKey,
    store,
    getBackendSession: async () => createBackendSession(checkpoint),
    endBackendSession: async () => assert.fail('must not end'),
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME)
  assert.equal(recovery.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
  assert.equal(recovery.persistenceAvailable, false)
})

test('backend ENDED and NOT FOUND both prevent gameplay resume and delete local state', async () => {
  for (const backendResult of ['ENDED', 'NOT_FOUND']) {
    const checkpoint = createValidSoloCheckpoint()
    const store = createMemoryStore(checkpoint)
    const recovery = await runScopedBootstrap({
      identityKey: checkpoint.identityKey,
      store,
      getBackendSession: async () => {
        if (backendResult === 'NOT_FOUND') {
          throw Object.assign(new Error('missing'), { status: 404 })
        }
        return createBackendSession(checkpoint, { status: 'ENDED' })
      },
      endBackendSession: async () => assert.fail('must not end'),
      nowEpochMs: STARTED_AT + 10_000,
    })

    assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED)
    assert.equal(store.checkpoint, null)
  }
})

test('temporary backend outage permits valid frontend-driven recovery with warning', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(checkpoint)
  const recovery = await runScopedBootstrap({
    identityKey: checkpoint.identityKey,
    store,
    getBackendSession: async () => {
      throw new TypeError('network down')
    },
    endBackendSession: async () => assert.fail('must not end'),
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME)
  assert.equal(recovery.warning, SOLO_BACKEND_SYNC_WARNING)
  assert.equal(recovery.timeline.endsAtEpochMs, checkpoint.round.endsAtEpochMs)
})

for (const status of [401, 403, 400]) {
  test(`backend ${status} rejects local offline recovery`, async () => {
    const checkpoint = createValidSoloCheckpoint()
    const store = createMemoryStore(checkpoint)
    const recovery = await runScopedBootstrap({
      identityKey: checkpoint.identityKey,
      store,
      getBackendSession: async () => {
        throw Object.assign(new Error('request rejected'), { status })
      },
      endBackendSession: async () => assert.fail('must not end'),
      nowEpochMs: STARTED_AT + 10_000,
    })

    assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED)
    assert.equal(store.checkpoint, null)
  })
}

for (const status of [500, 503]) {
  test(`backend ${status} permits a still-valid local recovery`, async () => {
    const checkpoint = createValidSoloCheckpoint()
    const store = createMemoryStore(checkpoint)
    const recovery = await runScopedBootstrap({
      identityKey: checkpoint.identityKey,
      store,
      getBackendSession: async () => {
        throw Object.assign(new Error('server unavailable'), { status })
      },
      endBackendSession: async () => assert.fail('must not end'),
      nowEpochMs: STARTED_AT + 10_000,
    })

    assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME)
    assert.equal(recovery.warning, SOLO_BACKEND_SYNC_WARNING)
  })
}

test('authorization failure while ending an expired backend round is not transient', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(checkpoint)
  const recovery = await runScopedBootstrap({
    identityKey: checkpoint.identityKey,
    store,
    getBackendSession: async () => createBackendSession(checkpoint),
    endBackendSession: async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 })
    },
    nowEpochMs: checkpoint.round.endsAtEpochMs + 1,
  })

  assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED)
  assert.equal(store.checkpoint, null)
})

test('failed cleanup reports persistence unavailable for stale checkpoints', async () => {
  const cases = [
    {
      name: '404',
      nowEpochMs: STARTED_AT + 10_000,
      getBackendSession: async () => {
        throw Object.assign(new Error('missing'), { status: 404 })
      },
    },
    {
      name: 'ended',
      nowEpochMs: STARTED_AT + 10_000,
      getBackendSession: async (sessionId) => ({
        sessionId,
        status: 'ENDED',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId: SOLO_RECOVERY_TEST_USER_ID,
      }),
    },
    {
      name: 'identity mismatch',
      nowEpochMs: STARTED_AT + 10_000,
      getBackendSession: async (sessionId) => ({
        sessionId,
        status: 'RUNNING',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId: '22222222-2222-4222-8222-222222222222',
      }),
    },
    {
      name: 'expired',
      nowEpochMs: STARTED_AT + 60_001,
      getBackendSession: async (sessionId) => ({
        sessionId,
        status: 'ENDED',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId: SOLO_RECOVERY_TEST_USER_ID,
      }),
    },
  ]

  for (const cleanupCase of cases) {
    const checkpoint = createValidSoloCheckpoint()
    const store = createMemoryStore(checkpoint)
    store.delete = async (identityKey) => {
      store.calls.push(['delete-failed', identityKey, cleanupCase.name])
      return {
        ok: false,
        operation: 'delete',
        error: new Error('IndexedDB delete failed'),
      }
    }
    const recovery = await runScopedBootstrap({
      identityKey: checkpoint.identityKey,
      store,
      getBackendSession: cleanupCase.getBackendSession,
      endBackendSession: async () => assert.fail('must not end'),
      nowEpochMs: cleanupCase.nowEpochMs,
    })

    assert.equal(recovery.persistenceAvailable, false, cleanupCase.name)
    assert.equal(
      recovery.warning,
      SOLO_RECOVERY_UNAVAILABLE_WARNING,
      cleanupCase.name,
    )
    assert.equal(store.checkpoint.identityKey, checkpoint.identityKey)
  }
})

test('expired local round never resumes and ends a still-running backend', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(checkpoint)
  let endCount = 0
  const recovery = await runScopedBootstrap({
    identityKey: checkpoint.identityKey,
    store,
    getBackendSession: async () => createBackendSession(checkpoint),
    endBackendSession: async () => {
      endCount += 1
      return createBackendSession(checkpoint, { status: 'ENDED' })
    },
    nowEpochMs: checkpoint.round.endsAtEpochMs + 1,
  })

  assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED)
  assert.equal(endCount, 1)
  assert.equal(store.checkpoint, null)
})

test('backend identity mismatch rejects and deletes the checkpoint', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(checkpoint)
  const recovery = await runScopedBootstrap({
    identityKey: checkpoint.identityKey,
    store,
    getBackendSession: async () => createBackendSession(checkpoint, {
      userId: '22222222-2222-4222-8222-222222222222',
    }),
    endBackendSession: async () => assert.fail('must not end'),
    nowEpochMs: STARTED_AT + 10_000,
  })

  assert.equal(recovery.kind, SOLO_RECOVERY_BOOTSTRAP_KINDS.REJECTED)
  assert.equal(store.checkpoint, null)
})
