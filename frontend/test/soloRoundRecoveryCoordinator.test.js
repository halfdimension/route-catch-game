import assert from 'node:assert/strict'
import test from 'node:test'
import React, { StrictMode } from 'react'
import { act, create } from 'react-test-renderer'
import { createRouteAnimationPlan } from '../src/hooks/useRouteAnimation.js'
import { useSoloRoundRecovery } from '../src/hooks/useSoloRoundRecovery.js'
import { submitLiveSoloCatchOnce } from '../src/recovery/soloCatchSubmission.js'
import {
  SOLO_RECOVERY_BOOTSTRAP_STATES,
  SOLO_RECOVERY_UNAVAILABLE_WARNING,
} from '../src/recovery/soloRecoveryRuntime.js'
import { createGuestSoloIdentityKey } from '../src/recovery/soloRecoveryIdentity.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
}

const GUEST_INSTALLATION_ID = '77777777-7777-4777-8777-777777777777'

function backendSession(checkpoint, overrides = {}) {
  return {
    sessionId: checkpoint.round.backendSessionId,
    status: 'RUNNING',
    durationSeconds: checkpoint.round.durationSeconds,
    startedAt: new Date(checkpoint.round.startedAtEpochMs).toISOString(),
    endedAt: null,
    score: checkpoint.score,
    caughtCount: checkpoint.caughtTargets.length,
    userId: checkpoint.identityKey.startsWith('user:')
      ? checkpoint.identityKey.slice(5)
      : null,
    ...overrides,
  }
}

function createMemoryStore(records = new Map()) {
  const calls = []
  return {
    calls,
    records,
    async sweep(identityKey) {
      calls.push(['sweep', identityKey])
      return { ok: true, deletedIdentityKeys: [] }
    },
    async read(identityKey) {
      calls.push(['read', identityKey])
      return {
        ok: true,
        checkpoint: records.has(identityKey)
          ? structuredClone(records.get(identityKey))
          : null,
      }
    },
    async replace(identityKey, checkpoint) {
      calls.push(['replace', identityKey])
      records.set(identityKey, structuredClone(checkpoint))
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push(['delete', identityKey])
      records.delete(identityKey)
      return { ok: true, operation: 'delete' }
    },
    close() {
      calls.push(['close'])
    },
  }
}

function RecoveryHarness({ options, capture }) {
  capture(useSoloRoundRecovery(options))
  return null
}

async function flushWork() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

async function mountRecovery(options, { strict = false } = {}) {
  let current
  let root
  const capture = (value) => {
    current = value
  }
  const render = (nextOptions) => {
    const element = React.createElement(RecoveryHarness, {
      options: nextOptions,
      capture,
    })
    return strict ? React.createElement(StrictMode, null, element) : element
  }

  await act(async () => {
    root = create(render(options))
    await flushWork()
  })

  return {
    get current() {
      return current
    },
    async update(nextOptions) {
      await act(async () => {
        root.update(render(nextOptions))
        await flushWork()
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

function createBaseOptions(store, overrides = {}) {
  return {
    loadingAuth: false,
    isAuthenticated: true,
    currentUser: { userId: SOLO_RECOVERY_TEST_USER_ID },
    recoveryStore: store,
    getBackendSession: async (sessionId) => {
      const checkpoint = [...store.records.values()].find(
        (entry) => entry.round.backendSessionId === sessionId,
      )
      return backendSession(checkpoint)
    },
    endBackendSession: async () => assert.fail('unexpected backend end'),
    getEpochTimeMs: () => STARTED_AT + 10_000,
    hydrateRound: () => {},
    hydratePlayer: async () => ({ kind: 'SETTLED' }),
    adoptBackendSession: () => {},
    getRuntimeSnapshot: () => ({
      playerPosition: { lat: 28.5505, lon: 77.2688 },
      simulationSpeedMetersPerSecond: 80,
      movement: null,
      targets: [],
      caughtTargets: [],
      score: 0,
      xp: 0,
      isSpawningPaused: false,
    }),
    ...overrides,
  }
}

async function establishTestRound(hook, session) {
  const operation = hook.current.beginRoundOperation()
  assert.ok(operation)
  const established = await hook.current.establishRound(session, operation)
  hook.current.completeRoundOperation(operation)
  return established
}

function testSession({
  sessionId = '44444444-4444-4444-8444-444444444444',
  userId = SOLO_RECOVERY_TEST_USER_ID,
  startedAtEpochMs = STARTED_AT,
} = {}) {
  return {
    sessionId,
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(startedAtEpochMs).toISOString(),
    userId,
  }
}

function liveTarget({
  id = '55555555-5555-4555-8555-555555555555',
} = {}) {
  return {
    id,
    creatureId: 'sparkbit',
    lat: 28.56,
    lon: 77.27,
    rarity: 'common',
    score: 10,
    spawnedAt: STARTED_AT + 9_000,
    expiresAt: STARTED_AT + 30_000,
    lifetimeMs: 21_000,
  }
}

async function createLiveCatch(hook, session = testSession()) {
  await act(async () => establishTestRound(hook, session))
  const target = liveTarget()
  assert.equal(hook.current.queueRuntimeCheckpoint({
    targets: [target],
  }), true)
  await act(async () => flushWork())
  let caught
  await act(async () => {
    caught = hook.current.applyTargetCatch({
      targetId: target.id,
      caughtAtEpochMs: STARTED_AT + 10_000,
      settledPosition: { lat: 28.56, lon: 77.27 },
    })
    await Promise.resolve()
  })
  assert.equal(caught.applied, true)
  return caught
}

test('exact round-terminal checkpoint persists after a delayed clock callback', async () => {
  const store = createMemoryStore()
  let nowEpochMs = STARTED_AT + 10_000
  const runtime = {
    playerPosition: { lat: 28.5505, lon: 77.2688 },
    simulationSpeedMetersPerSecond: 80,
    movement: {
      movementRecoveryId: '55555555-5555-4555-8555-555555555555',
      phase: 'MOVING',
      purpose: 'MAP',
      destination: { lat: 28.56, lon: 77.27 },
      chasedTargetId: null,
      routeCoordinates: [[28.55, 77.26], [28.56, 77.27]],
      anchorDistanceMeters: 0,
      anchorTimeEpochMs: STARTED_AT + 10_000,
    },
  }
  const hook = await mountRecovery(createBaseOptions(store, {
    getEpochTimeMs: () => nowEpochMs,
    getRuntimeSnapshot: () => runtime,
  }))
  const session = testSession()
  const endsAtEpochMs = STARTED_AT + 60_000

  try {
    await act(async () => establishTestRound(hook, session))
    assert.equal(hook.current.queueRuntimeCheckpoint({
      movement: runtime.movement,
    }), true)
    await act(async () => flushWork())

    nowEpochMs = endsAtEpochMs + 3_000
    const settledPosition = { lat: 28.555, lon: 77.265 }
    assert.equal(hook.current.queueRuntimeCheckpoint({
      settledPosition,
      movement: null,
    }), false)
    assert.equal(hook.current.queueRuntimeCheckpoint({
      settledPosition,
      movement: null,
      allowRoundTerminal: true,
      roundTerminalAtEpochMs: endsAtEpochMs,
    }), true)
    await act(async () => flushWork())

    const checkpoint = store.records.values().next().value
    assert.deepEqual(checkpoint.player.settledPosition, settledPosition)
    assert.equal(checkpoint.movement, null)
    assert.equal(checkpoint.updatedAtEpochMs, endsAtEpochMs - 1)
  } finally {
    await hook.unmount()
  }
})

test('auth unresolved performs no recovery storage or backend operation', async () => {
  const store = createMemoryStore()
  let backendCalls = 0
  const hook = await mountRecovery(createBaseOptions(store, {
    loadingAuth: true,
    isAuthenticated: false,
    currentUser: null,
    getBackendSession: async () => {
      backendCalls += 1
    },
  }))

  try {
    assert.equal(
      hook.current.bootstrapState,
      SOLO_RECOVERY_BOOTSTRAP_STATES.AUTH_UNRESOLVED,
    )
    assert.equal(hook.current.isReady, false)
    assert.deepEqual(store.calls, [])
    assert.equal(backendCalls, 0)
  } finally {
    await hook.unmount()
  }
})

test('authenticated checkpoint hydrates player before the same absolute round', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(new Map([
    [checkpoint.identityKey, checkpoint],
  ]))
  const order = []
  const hook = await mountRecovery(createBaseOptions(store, {
    hydratePlayer: async (recovered, options) => {
      order.push(['player', recovered.identityKey, options.nowEpochMs])
      return { kind: 'SETTLED' }
    },
    hydrateRound: (timeline) => order.push(['round', timeline]),
  }))

  try {
    assert.equal(hook.current.isReady, true)
    assert.equal(order[0][0], 'player')
    assert.equal(order[1][0], 'round')
    assert.deepEqual(order[1][1], {
      durationSeconds: checkpoint.round.durationSeconds,
      startedAtEpochMs: checkpoint.round.startedAtEpochMs,
      endsAtEpochMs: checkpoint.round.endsAtEpochMs,
    })
  } finally {
    await hook.unmount()
  }
})

test('target, caught, score, XP, and spawn state hydrate before player and READY', async () => {
  const checkpoint = createValidSoloCheckpoint({ score: 10 })
  const activeTarget = {
    id: '55555555-5555-4555-8555-555555555555',
    creatureId: 'sparkbit',
    lat: 28.56,
    lon: 77.27,
    rarity: 'common',
    score: 10,
    spawnedAt: STARTED_AT + 1_000,
    expiresAt: STARTED_AT + 30_000,
    lifetimeMs: 29_000,
  }
  const caughtTarget = {
    ...activeTarget,
    id: '66666666-6666-4666-8666-666666666666',
    caughtAt: STARTED_AT + 4_000,
  }
  checkpoint.targets = [activeTarget]
  checkpoint.caughtTargets = [caughtTarget]
  checkpoint.xp = 10
  checkpoint.backendSync.pendingCatches = [{
    catchId: '77777777-7777-4777-8777-777777777777',
    targetId: caughtTarget.id,
    creatureId: caughtTarget.creatureId,
    caughtAtEpochMs: caughtTarget.caughtAt,
  }]
  checkpoint.spawning.nextSpawnAtEpochMs = STARTED_AT + 20_000
  const store = createMemoryStore(new Map([
    [checkpoint.identityKey, checkpoint],
  ]))
  const order = []
  const hook = await mountRecovery(createBaseOptions(store, {
    hydrateGameplay: async (recovered) => {
      order.push('gameplay')
      assert.equal(recovered.targets[0].id, activeTarget.id)
      assert.equal(recovered.targets[0].name, 'Sparkbit')
      assert.equal(recovered.caughtTargets[0].id, caughtTarget.id)
      assert.equal(recovered.score, 10)
      assert.equal(recovered.xp, 10)
      assert.equal(
        recovered.spawning.nextSpawnAtEpochMs,
        STARTED_AT + 20_000,
      )
      return { isMovementValid: () => true }
    },
    hydratePlayer: async () => {
      order.push('player')
      return { kind: 'SETTLED' }
    },
    hydrateRound: () => order.push('round'),
  }))

  try {
    assert.deepEqual(order, ['gameplay', 'player', 'round'])
    assert.equal(hook.current.isReady, true)
  } finally {
    await hook.unmount()
  }
})

test('guest identity hydrates only its own guest checkpoint', async () => {
  const guestIdentity = createGuestSoloIdentityKey(GUEST_INSTALLATION_ID)
  const checkpoint = createValidSoloCheckpoint({ identityKey: guestIdentity })
  const store = createMemoryStore(new Map([[guestIdentity, checkpoint]]))
  const originalLocalStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => GUEST_INSTALLATION_ID,
    setItem: () => {},
  }
  let hydratedIdentity = null

  try {
    const hook = await mountRecovery(createBaseOptions(store, {
      isAuthenticated: false,
      currentUser: null,
      hydratePlayer: async (recovered) => {
        hydratedIdentity = recovered.identityKey
        return { kind: 'SETTLED' }
      },
    }))
    try {
      assert.equal(hook.current.isReady, true)
      assert.equal(hook.current.identityKey, guestIdentity)
      assert.equal(hydratedIdentity, guestIdentity)
      assert.deepEqual(store.calls[0], ['read', guestIdentity])
    } finally {
      await hook.unmount()
    }
  } finally {
    globalThis.localStorage = originalLocalStorage
  }
})

test('no checkpoint reaches READY without contacting the backend', async () => {
  const store = createMemoryStore()
  let backendCalls = 0
  const hook = await mountRecovery(createBaseOptions(store, {
    getBackendSession: async () => {
      backendCalls += 1
    },
  }))

  try {
    assert.equal(hook.current.isReady, true)
    assert.equal(hook.current.warning, '')
    assert.equal(backendCalls, 0)
  } finally {
    await hook.unmount()
  }
})

test('a malformed record discarded by the storage boundary still reaches READY', async () => {
  const store = createMemoryStore()
  store.read = async (identityKey) => {
    store.calls.push(['read-discarded-invalid', identityKey])
    return {
      ok: true,
      checkpoint: null,
      discardedReason: 'invalid',
      cleanupRequired: true,
      error: new Error('invalid checkpoint'),
    }
  }
  const hook = await mountRecovery(createBaseOptions(store))

  try {
    assert.equal(hook.current.isReady, true)
    assert.ok(store.calls.some(
      ([operation]) => operation === 'read-discarded-invalid',
    ))
  } finally {
    await hook.unmount()
  }
})

test('storage bootstrap failure releases the barrier with one warning', async () => {
  const store = createMemoryStore()
  store.read = async (identityKey) => {
    store.calls.push(['read-failed', identityKey])
    return { ok: false, error: new Error('IndexedDB blocked') }
  }
  const hook = await mountRecovery(createBaseOptions(store))

  try {
    assert.equal(hook.current.isReady, true)
    assert.equal(hook.current.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
    assert.equal(
      hook.current.queueRuntimeCheckpoint({ movement: null }),
      false,
    )
  } finally {
    await hook.unmount()
  }
})

test('StrictMode uses one bootstrap flight and hydrates once', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(new Map([
    [checkpoint.identityKey, checkpoint],
  ]))
  let playerHydrations = 0
  let roundHydrations = 0
  const hook = await mountRecovery(createBaseOptions(store, {
    hydratePlayer: async () => {
      playerHydrations += 1
      return { kind: 'SETTLED' }
    },
    hydrateRound: () => {
      roundHydrations += 1
    },
  }), { strict: true })

  try {
    assert.equal(hook.current.isReady, true)
    assert.equal(
      store.calls.filter(([operation]) => operation === 'read').length,
      1,
    )
    assert.equal(playerHydrations, 1)
    assert.equal(roundHydrations, 1)
  } finally {
    await hook.unmount()
  }
})

test('end and reset delete the active checkpoint without blocking gameplay', async () => {
  const store = createMemoryStore()
  const options = createBaseOptions(store)
  const hook = await mountRecovery(options)
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }

  try {
    await act(async () => {
      const established = await establishTestRound(hook, session)
      assert.equal(established.timeline.endsAtEpochMs, STARTED_AT + 60_000)
    })
    assert.equal(store.records.size, 1)
    await act(async () => {
      assert.equal(hook.current.queueRuntimeCheckpoint({
        movement: null,
        settledPosition: { lat: 28.56, lon: 77.27 },
        simulationSpeedMetersPerSecond: 160,
      }), true)
      await flushWork()
    })
    assert.equal(
      store.records.values().next().value
        .player.simulationSpeedMetersPerSecond,
      160,
    )

    await act(async () => hook.current.finishRound({ backendEnded: true }))
    assert.equal(store.records.size, 0)

    await act(async () => establishTestRound(hook, session))
    assert.equal(store.records.size, 1)
    await act(async () => hook.current.resetRound())
    assert.equal(store.records.size, 0)
  } finally {
    await hook.unmount()
  }
})

test('active write failure keeps the round usable and disables later writes', async () => {
  const store = createMemoryStore()
  let replaceCalls = 0
  store.replace = async (identityKey) => {
    store.calls.push(['replace-failed', identityKey])
    replaceCalls += 1
    return { ok: false, operation: 'replace', error: new Error('disk full') }
  }
  const hook = await mountRecovery(createBaseOptions(store))
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }

  try {
    let established
    await act(async () => {
      established = await establishTestRound(hook, session)
    })
    assert.equal(established.ok, false)
    assert.ok(established.timeline)
    assert.equal(hook.current.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
    assert.equal(
      hook.current.queueRuntimeCheckpoint({ movement: null }),
      false,
    )
    assert.equal(replaceCalls, 1)
  } finally {
    await hook.unmount()
  }
})

test('logout deletes the authenticated checkpoint before switching to guest', async () => {
  const userCheckpoint = createValidSoloCheckpoint()
  const guestIdentity = createGuestSoloIdentityKey(GUEST_INSTALLATION_ID)
  const store = createMemoryStore(new Map([
    [userCheckpoint.identityKey, userCheckpoint],
  ]))
  const originalLocalStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => GUEST_INSTALLATION_ID,
    setItem: () => {},
  }
  const authenticated = createBaseOptions(store)
  const hook = await mountRecovery(authenticated)

  try {
    await hook.update({
      ...authenticated,
      isAuthenticated: false,
      currentUser: null,
    })
    assert.equal(hook.current.identityKey, guestIdentity)
    assert.equal(hook.current.isReady, true)
    assert.equal(store.records.has(userCheckpoint.identityKey), false)
    assert.ok(store.calls.some(
      ([operation, identityKey]) =>
        operation === 'delete' && identityKey === userCheckpoint.identityKey,
    ))
  } finally {
    await hook.unmount()
    globalThis.localStorage = originalLocalStorage
  }
})

test('unmount drains an in-flight checkpoint write before closing storage', async () => {
  let releaseWrite
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve
  })
  const store = createMemoryStore()
  store.replace = async (identityKey, checkpoint) => {
    store.calls.push(['replace-start', identityKey])
    await writeGate
    store.records.set(identityKey, structuredClone(checkpoint))
    store.calls.push(['replace-end', identityKey])
    return { ok: true, operation: 'replace' }
  }
  const hook = await mountRecovery(createBaseOptions(store))
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }
  const operation = hook.current.beginRoundOperation()
  const establishment = hook.current.establishRound(session, operation)

  await hook.unmount()
  assert.equal(store.calls.some(([operation]) => operation === 'close'), false)
  releaseWrite()
  await establishment
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(
    store.calls.slice(-2).map(([operation]) => operation),
    ['replace-end', 'close'],
  )
})

test('round launch is single-flight and reset invalidates its late backend response', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const operation = hook.current.beginRoundOperation()
  assert.ok(operation)
  assert.equal(hook.current.beginRoundOperation(), null)
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }

  try {
    await act(async () => hook.current.resetRound())
    let established
    await act(async () => {
      established = await hook.current.establishRound(session, operation)
    })
    assert.equal(established.stale, true)
    assert.equal(store.records.size, 0)
  } finally {
    await hook.unmount()
  }
})

test('spawn, catch, and expiry each persist one coherent semantic checkpoint', async () => {
  const store = createMemoryStore()
  const identityKey = createValidSoloCheckpoint().identityKey
  const runtime = {
    playerPosition: { lat: 28.5505, lon: 77.2688 },
    simulationSpeedMetersPerSecond: 80,
    movement: null,
    targets: [],
    caughtTargets: [],
    score: 0,
    xp: 0,
    spawning: {
      paused: false,
      nextSpawnAtEpochMs: STARTED_AT + 15_000,
    },
  }
  const options = createBaseOptions(store, {
    getRuntimeSnapshot: () => structuredClone(runtime),
  })
  const hook = await mountRecovery(options)
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }
  const firstTarget = {
    id: '55555555-5555-4555-8555-555555555555',
    creatureId: 'sparkbit',
    lat: 28.56,
    lon: 77.27,
    rarity: 'common',
    score: 10,
    spawnedAt: STARTED_AT + 9_000,
    expiresAt: STARTED_AT + 30_000,
    lifetimeMs: 21_000,
  }
  const secondTarget = {
    ...firstTarget,
    id: '66666666-6666-4666-8666-666666666666',
  }

  try {
    await act(async () => establishTestRound(hook, session))
    let replaceCount = store.calls.filter(([operation]) => operation === 'replace').length

    runtime.playerPosition = { lat: 28.551, lon: 77.269 }
    await hook.update(options)
    runtime.playerPosition = { lat: 28.552, lon: 77.27 }
    await hook.update(options)
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount,
    )

    runtime.targets = [firstTarget]
    assert.equal(hook.current.queueRuntimeCheckpoint({
      targets: runtime.targets,
      spawning: runtime.spawning,
    }), true)
    await act(async () => flushWork())
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount + 1,
    )
    replaceCount += 1

    const caught = hook.current.applyTargetCatch({
      targetId: firstTarget.id,
      caughtAtEpochMs: STARTED_AT + 10_000,
      settledPosition: runtime.playerPosition,
    })
    assert.equal(caught.applied, true)
    await act(async () => flushWork())
    const caughtCheckpoint = store.records.get(identityKey)
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount + 1,
    )
    assert.equal(caughtCheckpoint.targets.length, 0)
    assert.equal(caughtCheckpoint.caughtTargets.length, 1)
    assert.equal(caughtCheckpoint.score, 10)
    assert.equal(caughtCheckpoint.xp, 10)
    assert.equal(caughtCheckpoint.backendSync.pendingCatches.length, 1)
    replaceCount += 1

    let acknowledgement
    await act(async () => {
      acknowledgement = await hook.current.acknowledgePendingCatch(
        caught.scope,
      )
      await flushWork()
    })
    assert.equal(acknowledgement.acknowledged, true)
    const acknowledgedCheckpoint = store.records.get(identityKey)
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount + 1,
    )
    assert.equal(acknowledgedCheckpoint.targets.length, 0)
    assert.equal(acknowledgedCheckpoint.caughtTargets.length, 1)
    assert.equal(acknowledgedCheckpoint.score, 10)
    assert.equal(acknowledgedCheckpoint.xp, 10)
    assert.equal(acknowledgedCheckpoint.backendSync.pendingCatches.length, 0)
    replaceCount += 1

    assert.equal(hook.current.applyTargetCatch({
      targetId: firstTarget.id,
      caughtAtEpochMs: STARTED_AT + 11_000,
    }).applied, false)
    await act(async () => flushWork())
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount,
    )

    runtime.targets = [secondTarget]
    assert.equal(hook.current.queueRuntimeCheckpoint({
      targets: runtime.targets,
      caughtTargets: acknowledgedCheckpoint.caughtTargets,
      score: acknowledgedCheckpoint.score,
      xp: acknowledgedCheckpoint.xp,
    }), true)
    await act(async () => flushWork())
    replaceCount += 1
    const expired = hook.current.applyTargetsExpired({
      targetIds: [secondTarget.id],
      expiredAtEpochMs: STARTED_AT + 12_000,
      targets: [],
      spawning: runtime.spawning,
    })
    assert.equal(expired.applied, true)
    await act(async () => flushWork())
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount + 1,
    )
    assert.equal(
      store.records.get(identityKey).targets.length,
      0,
    )
    replaceCount += 1
    const staleAfterExpiry = hook.current.applyTargetCatch({
      targetId: secondTarget.id,
      caughtAtEpochMs: STARTED_AT + 12_001,
    })
    await act(async () => flushWork())
    assert.equal(staleAfterExpiry.applied, false)
    assert.equal(store.records.get(identityKey).score, 10)
    assert.equal(
      store.calls.filter(([operation]) => operation === 'replace').length,
      replaceCount,
    )
  } finally {
    await hook.unmount()
  }
})

test('live state is immediate while backend waits for the exact catch checkpoint', async () => {
  const store = createMemoryStore()
  const catchWrite = deferred()
  const originalReplace = store.replace
  let capturedCatchCheckpoint = null
  store.replace = async (identityKey, checkpoint) => {
    if (
      checkpoint.backendSync?.pendingCatches.length > 0 &&
      !capturedCatchCheckpoint
    ) {
      capturedCatchCheckpoint = structuredClone(checkpoint)
      await catchWrite.promise
    }
    return originalReplace(identityKey, checkpoint)
  }
  const hook = await mountRecovery(createBaseOptions(store))
  let backendCalls = 0

  try {
    const caught = await createLiveCatch(hook)
    assert.equal(caught.checkpoint.targets.length, 0)
    assert.equal(caught.checkpoint.caughtTargets.length, 1)
    assert.equal(caught.checkpoint.score, 10)
    assert.equal(caught.checkpoint.xp, 10)
    const submission = submitLiveSoloCatchOnce({
      submission: {
        caughtTarget: caught.caughtTarget,
        pendingCatch: caught.pendingCatch,
        scope: caught.scope,
        durability: caught.durability,
      },
      submitBackendCatch: async () => {
        backendCalls += 1
        return { catchId: caught.pendingCatch.catchId, score: 10 }
      },
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })

    await flushWork()
    assert.equal(backendCalls, 0)
    assert.equal(capturedCatchCheckpoint.score, 10)
    assert.equal(capturedCatchCheckpoint.backendSync.pendingCatches.length, 1)

    catchWrite.resolve({ ok: true })
    const result = await submission
    assert.equal(result.submitted, true)
    assert.equal(result.acknowledged, true)
    assert.equal(backendCalls, 1)
    assert.equal(
      store.records.get(caught.scope.identityKey)
        .backendSync.pendingCatches.length,
      0,
    )
  } finally {
    catchWrite.resolve({ ok: true })
    await hook.unmount()
  }
})

test('route-frame geometry writes nothing until one semantic crossing', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const anchorTimeEpochMs = STARTED_AT + 10_000
  const route = [[0, 0], [0, 0.001]]
  const target = {
    ...liveTarget(),
    lat: 0,
    lon: 50 / 111_195,
  }
  const movement = {
    movementRecoveryId: '99999999-9999-4999-8999-999999999999',
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: 0, lon: 0.001 },
    chasedTargetId: null,
    routeCoordinates: route,
    anchorDistanceMeters: 0,
    anchorTimeEpochMs,
  }

  try {
    await act(async () => establishTestRound(hook, testSession()))
    assert.equal(hook.current.queueRuntimeCheckpoint({
      targets: [target],
      movement,
    }), true)
    await act(async () => flushWork())
    const writesBeforeFrames = store.calls.filter(
      ([operation]) => operation === 'replace',
    ).length
    const plan = createRouteAnimationPlan(route)
    const movementAnchor = {
      anchorDistanceMeters: 0,
      anchorTimeEpochMs,
      speedMetersPerSecond: 80,
    }

    for (const [previousDistanceMeters, proposedDistanceMeters] of [
      [0, 5],
      [5, 10],
      [10, 20],
    ]) {
      const result = hook.current.resolveLiveCatchInterval({
        plan,
        previousDistanceMeters,
        proposedDistanceMeters,
        previousEpochTimeMs:
          anchorTimeEpochMs + previousDistanceMeters / 80 * 1000,
        proposedEpochTimeMs:
          anchorTimeEpochMs + proposedDistanceMeters / 80 * 1000,
        movementAnchor,
      })
      assert.deepEqual(result.entries, [])
    }
    assert.equal(store.calls.filter(
      ([operation]) => operation === 'replace',
    ).length, writesBeforeFrames)

    const crossing = hook.current.resolveLiveCatchInterval({
      plan,
      previousDistanceMeters: 20,
      proposedDistanceMeters: 40,
      previousEpochTimeMs: anchorTimeEpochMs + 250,
      proposedEpochTimeMs: anchorTimeEpochMs + 500,
      movementAnchor,
    })
    const transition = hook.current.applyTargetCatchBatch({
      catches: crossing.entries,
      checkpointAtEpochMs: anchorTimeEpochMs + 500,
      settledPosition: { lat: 0, lon: 40 / 111_195 },
    })
    assert.equal(transition.applied, true)
    await transition.submissions[0].durability
    assert.equal(store.calls.filter(
      ([operation]) => operation === 'replace',
    ).length, writesBeforeFrames + 1)
  } finally {
    await hook.unmount()
  }
})

test('catch resolved while expiry advances movement wins one terminal transition', async () => {
  const store = createMemoryStore()
  let hook
  let triggerCatchDuringAdvance = false
  let nestedCatch = null
  const target = liveTarget()
  const runtime = {
    playerPosition: { lat: 28.56, lon: 77.27 },
    simulationSpeedMetersPerSecond: 80,
    movement: null,
    targets: [target],
    caughtTargets: [],
    score: 0,
    xp: 0,
    spawning: { paused: false, nextSpawnAtEpochMs: STARTED_AT + 15_000 },
  }
  const options = createBaseOptions(store, {
    getRuntimeSnapshot: ({ advanceMovement } = {}) => {
      if (advanceMovement && triggerCatchDuringAdvance) {
        triggerCatchDuringAdvance = false
        nestedCatch = hook.current.applyTargetCatch({
          targetId: target.id,
          caughtAtEpochMs: STARTED_AT + 10_000,
          settledPosition: runtime.playerPosition,
        })
      }
      return structuredClone(runtime)
    },
  })
  hook = await mountRecovery(options)

  try {
    await act(async () => establishTestRound(hook, testSession()))
    assert.equal(hook.current.queueRuntimeCheckpoint({
      targets: [target],
      spawning: runtime.spawning,
    }), true)
    await act(async () => flushWork())
    const writesBeforeRace = store.calls.filter(
      ([operation]) => operation === 'replace',
    ).length

    triggerCatchDuringAdvance = true
    const expiry = hook.current.applyTargetsExpired({
      targetIds: [target.id],
      expiredAtEpochMs: STARTED_AT + 12_000,
      targets: [],
      spawning: runtime.spawning,
    })
    assert.equal(expiry.applied, false)
    assert.equal(nestedCatch.applied, true)
    await nestedCatch.durability
    await flushWork()

    const checkpoint = store.records.values().next().value
    assert.equal(checkpoint.targets.length, 0)
    assert.equal(checkpoint.caughtTargets.length, 1)
    assert.equal(checkpoint.score, 10)
    assert.equal(checkpoint.xp, 10)
    assert.equal(store.calls.filter(
      ([operation]) => operation === 'replace',
    ).length, writesBeforeRace + 1)
  } finally {
    await hook.unmount()
  }
})

test('catch persistence rejection enters degraded mode and submits only once', async () => {
  const store = createMemoryStore()
  const originalReplace = store.replace
  let rejectCatchWrite = true
  store.replace = async (identityKey, checkpoint) => {
    if (rejectCatchWrite && checkpoint.backendSync?.pendingCatches.length > 0) {
      rejectCatchWrite = false
      return {
        ok: false,
        operation: 'replace',
        error: new Error('IndexedDB rejected catch'),
      }
    }
    return originalReplace(identityKey, checkpoint)
  }
  const hook = await mountRecovery(createBaseOptions(store))
  let backendCalls = 0

  try {
    const caught = await createLiveCatch(hook)
    let result
    await act(async () => {
      result = await submitLiveSoloCatchOnce({
        submission: caught,
        submitBackendCatch: async () => {
          backendCalls += 1
          return null
        },
        isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
        acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
      })
    })

    assert.equal(caught.checkpoint.score, 10)
    assert.equal(result.durability.degraded, true)
    assert.equal(result.submitted, true)
    assert.equal(backendCalls, 1)
    assert.equal(hook.current.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
    await flushWork()
    assert.equal(backendCalls, 1)
  } finally {
    await hook.unmount()
  }
})

test('catch persistence timeout enters degraded mode without a backend retry', async () => {
  const store = createMemoryStore()
  const catchWrite = deferred()
  const originalReplace = store.replace
  let holdCatchWrite = true
  store.replace = async (identityKey, checkpoint) => {
    if (holdCatchWrite && checkpoint.backendSync?.pendingCatches.length > 0) {
      holdCatchWrite = false
      await catchWrite.promise
    }
    return originalReplace(identityKey, checkpoint)
  }
  const hook = await mountRecovery(createBaseOptions(store))
  let backendCalls = 0

  try {
    const caught = await createLiveCatch(hook)
    let submission
    let result
    await act(async () => {
      submission = submitLiveSoloCatchOnce({
        submission: caught,
        submitBackendCatch: async () => {
          backendCalls += 1
          return null
        },
        isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
        acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
      })
      await flushWork()
    })
    assert.equal(backendCalls, 0)
    await act(async () => {
      result = await submission
    })

    assert.equal(result.durability.timedOut, true)
    assert.equal(result.durability.degraded, true)
    assert.equal(backendCalls, 1)
    assert.equal(hook.current.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
    await flushWork()
    assert.equal(backendCalls, 1)

    catchWrite.resolve({ ok: true })
    await act(async () => flushWork())
    assert.equal(backendCalls, 1)
  } finally {
    catchWrite.resolve({ ok: true })
    await hook.unmount()
  }
})

test('late catch persistence failure after timeout cannot submit again', async () => {
  const store = createMemoryStore()
  const catchWrite = deferred()
  const originalReplace = store.replace
  let holdCatchWrite = true
  store.replace = async (identityKey, checkpoint) => {
    if (holdCatchWrite && checkpoint.backendSync?.pendingCatches.length > 0) {
      holdCatchWrite = false
      await catchWrite.promise
    }
    return originalReplace(identityKey, checkpoint)
  }
  const hook = await mountRecovery(createBaseOptions(store))
  let backendCalls = 0

  try {
    const caught = await createLiveCatch(hook)
    const submission = submitLiveSoloCatchOnce({
      submission: caught,
      submitBackendCatch: async () => {
        backendCalls += 1
        return null
      },
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })
    await flushWork()
    assert.equal(backendCalls, 0)

    const result = await submission
    assert.equal(result.durability.timedOut, true)
    assert.equal(result.durability.degraded, true)
    assert.equal(backendCalls, 1)

    catchWrite.reject(new Error('late IndexedDB failure'))
    await act(async () => flushWork())
    assert.equal(backendCalls, 1)
  } finally {
    catchWrite.resolve({ ok: false })
    await hook.unmount()
  }
})

test('successful catch response acknowledges the same RECONCILING round', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const backendResponse = deferred()

  try {
    const caught = await createLiveCatch(hook)
    const submission = submitLiveSoloCatchOnce({
      submission: caught,
      submitBackendCatch: async () => backendResponse.promise,
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })
    await caught.durability
    await flushWork()

    const finishingScope = hook.current.captureActiveRoundScope()
    const finish = await hook.current.finishRound({
      backendEnded: true,
      expectedScope: finishingScope,
    })
    assert.equal(finish.reconciled, true)
    assert.equal(
      store.records.get(caught.scope.identityKey).round.phase,
      'RECONCILING',
    )

    backendResponse.resolve({
      catchId: caught.pendingCatch.catchId,
      score: 10,
    })
    const result = await submission
    const reconciled = store.records.get(caught.scope.identityKey)
    assert.equal(result.acknowledged, true)
    assert.equal(reconciled.round.phase, 'RECONCILING')
    assert.equal(reconciled.backendSync.pendingCatches.length, 0)
    assert.equal(reconciled.movement, null)
    assert.deepEqual(reconciled.targets, [])
  } finally {
    backendResponse.resolve(null)
    await hook.unmount()
  }
})

test('catch success from round A cannot mutate restarted round B', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const backendResponse = deferred()
  const sessionB = testSession({
    sessionId: '88888888-8888-4888-8888-888888888888',
    startedAtEpochMs: STARTED_AT + 1_000,
  })

  try {
    const caught = await createLiveCatch(hook)
    const submission = submitLiveSoloCatchOnce({
      submission: caught,
      submitBackendCatch: async () => backendResponse.promise,
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })
    await caught.durability
    await flushWork()
    await hook.current.resetRound()
    await establishTestRound(hook, sessionB)
    const before = structuredClone(store.records.get(caught.scope.identityKey))

    backendResponse.resolve({
      catchId: caught.pendingCatch.catchId,
      score: 10,
    })
    const result = await submission
    assert.equal(result.stale, true)
    assert.deepEqual(store.records.get(caught.scope.identityKey), before)
  } finally {
    backendResponse.resolve(null)
    await hook.unmount()
  }
})

test('catch success from identity A cannot mutate identity B', async () => {
  const store = createMemoryStore()
  const optionsA = createBaseOptions(store)
  const hook = await mountRecovery(optionsA)
  const backendResponse = deferred()
  const userBId = '22222222-2222-4222-8222-222222222222'

  try {
    const caught = await createLiveCatch(hook)
    const submission = submitLiveSoloCatchOnce({
      submission: caught,
      submitBackendCatch: async () => backendResponse.promise,
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })
    await caught.durability
    await flushWork()
    await hook.update({
      ...optionsA,
      currentUser: { userId: userBId },
    })
    const sessionB = testSession({
      sessionId: '88888888-8888-4888-8888-888888888888',
      userId: userBId,
    })
    await establishTestRound(hook, sessionB)
    const identityB = `user:${userBId}`
    const before = structuredClone(store.records.get(identityB))

    backendResponse.resolve({
      catchId: caught.pendingCatch.catchId,
      score: 10,
    })
    const result = await submission
    assert.equal(result.stale, true)
    assert.deepEqual(store.records.get(identityB), before)
  } finally {
    backendResponse.resolve(null)
    await hook.unmount()
  }
})

test('old A1 catch response cannot mutate A2 after A to B to A', async () => {
  const store = createMemoryStore()
  const optionsA = createBaseOptions(store)
  const hook = await mountRecovery(optionsA)
  const backendResponse = deferred()
  const userBId = '22222222-2222-4222-8222-222222222222'

  try {
    const caught = await createLiveCatch(hook)
    const submission = submitLiveSoloCatchOnce({
      submission: caught,
      submitBackendCatch: async () => backendResponse.promise,
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })
    await caught.durability
    await flushWork()
    await hook.update({
      ...optionsA,
      currentUser: { userId: userBId },
    })
    await hook.update(optionsA)
    const sessionA2 = testSession({
      sessionId: '99999999-9999-4999-8999-999999999999',
      startedAtEpochMs: STARTED_AT + 2_000,
    })
    await establishTestRound(hook, sessionA2)
    const before = structuredClone(store.records.get(caught.scope.identityKey))

    backendResponse.resolve({
      catchId: caught.pendingCatch.catchId,
      score: 10,
    })
    const result = await submission
    assert.equal(result.stale, true)
    assert.deepEqual(store.records.get(caught.scope.identityKey), before)
  } finally {
    backendResponse.resolve(null)
    await hook.unmount()
  }
})

test('failed old catch response cannot alter the new round', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const backendResponse = deferred()
  const sessionB = testSession({
    sessionId: '88888888-8888-4888-8888-888888888888',
    startedAtEpochMs: STARTED_AT + 1_000,
  })

  try {
    const caught = await createLiveCatch(hook)
    const submission = submitLiveSoloCatchOnce({
      submission: caught,
      submitBackendCatch: async () => backendResponse.promise,
      isSubmissionScopeCurrent: hook.current.isCatchSubmissionScopeCurrent,
      acknowledgePendingCatch: hook.current.acknowledgePendingCatch,
    })
    await caught.durability
    await flushWork()
    await hook.current.resetRound()
    await establishTestRound(hook, sessionB)
    const before = structuredClone(store.records.get(caught.scope.identityKey))

    backendResponse.resolve(null)
    const result = await submission
    assert.equal(result.response, null)
    assert.deepEqual(store.records.get(caught.scope.identityKey), before)
    assert.equal(hook.current.warning, '')
  } finally {
    backendResponse.resolve(null)
    await hook.unmount()
  }
})

test('late round A finish cannot delete an established round B', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const sessionA = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }
  const sessionB = {
    ...sessionA,
    sessionId: '88888888-8888-4888-8888-888888888888',
    startedAt: new Date(STARTED_AT + 1_000).toISOString(),
  }

  try {
    await act(async () => establishTestRound(hook, sessionA))
    const scopeA = hook.current.captureActiveRoundScope()
    const restart = hook.current.beginRestartOperation()
    assert.ok(restart)
    assert.equal(hook.current.beginRestartOperation(), null)
    await restart.cleanup
    let establishedB
    await act(async () => {
      establishedB = await hook.current.establishRound(sessionB, restart.scope)
      hook.current.completeRoundOperation(restart.scope)
    })
    assert.ok(establishedB.timeline)

    let staleFinish
    await act(async () => {
      staleFinish = await hook.current.finishRound({
        backendEnded: true,
        expectedScope: scopeA,
      })
    })
    assert.equal(staleFinish.stale, true)
    assert.equal(store.records.size, 1)
    assert.equal(
      store.records.values().next().value.round.backendSessionId,
      sessionB.sessionId,
    )
  } finally {
    await hook.unmount()
  }
})

test('identity switch does not wait for a never-resolving old writer', async () => {
  const store = createMemoryStore()
  let releaseUserWrite
  const userWrite = new Promise((resolve) => {
    releaseUserWrite = resolve
  })
  const originalReplace = store.replace
  store.replace = async (identityKey, checkpoint) => {
    if (identityKey.startsWith('user:11111111')) {
      store.calls.push(['replace-stuck', identityKey])
      await userWrite
    }
    return originalReplace(identityKey, checkpoint)
  }
  const authenticated = createBaseOptions(store)
  const hook = await mountRecovery(authenticated)
  const operation = hook.current.beginRoundOperation()
  const establishment = hook.current.establishRound({
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }, operation)
  const userBId = '22222222-2222-4222-8222-222222222222'

  try {
    await hook.update({
      ...authenticated,
      currentUser: { userId: userBId },
    })
    assert.equal(hook.current.identityKey, `user:${userBId}`)
    assert.equal(hook.current.isReady, true)
    assert.equal(store.calls.some(
      ([operationName, identityKey]) =>
        operationName === 'read' && identityKey === `user:${userBId}`,
    ), true)
    releaseUserWrite()
    const staleEstablishment = await establishment
    assert.equal(staleEstablishment.stale, true)
  } finally {
    releaseUserWrite()
    await hook.unmount()
  }
})

test('retired writer failure after B is ready cannot disable B persistence', async () => {
  const store = createMemoryStore()
  let failUserAWrite
  const userAWrite = new Promise((resolve) => {
    failUserAWrite = resolve
  })
  const originalReplace = store.replace
  store.replace = async (identityKey, checkpoint) => {
    if (identityKey.startsWith('user:11111111')) {
      store.calls.push(['replace-stuck', identityKey])
      await userAWrite
      return {
        ok: false,
        operation: 'replace',
        error: new Error('late user A failure'),
      }
    }
    return originalReplace(identityKey, checkpoint)
  }
  const authenticated = createBaseOptions(store)
  const hook = await mountRecovery(authenticated)
  const operationA = hook.current.beginRoundOperation()
  const establishmentA = hook.current.establishRound({
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }, operationA)
  const userBId = '22222222-2222-4222-8222-222222222222'

  try {
    await hook.update({
      ...authenticated,
      currentUser: { userId: userBId },
    })
    assert.equal(hook.current.isReady, true)
    assert.equal(hook.current.warning, '')

    failUserAWrite()
    assert.equal((await establishmentA).stale, true)
    await act(async () => flushWork())
    assert.equal(hook.current.warning, '')

    const operationB = hook.current.beginRoundOperation()
    let establishedB
    await act(async () => {
      establishedB = await hook.current.establishRound({
        sessionId: '88888888-8888-4888-8888-888888888888',
        status: 'RUNNING',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId: userBId,
      }, operationB)
      hook.current.completeRoundOperation(operationB)
    })
    assert.equal(establishedB.ok, true)
    assert.equal(hook.current.warning, '')
    assert.equal(
      store.records.get(`user:${userBId}`).round.backendSessionId,
      '88888888-8888-4888-8888-888888888888',
    )
  } finally {
    failUserAWrite()
    await hook.unmount()
  }
})

test('repeated identities bootstrap while permanently stuck writers retire', async () => {
  const store = createMemoryStore()
  const originalReplace = store.replace
  const stuckIdentities = new Set([
    'user:11111111-1111-4111-8111-111111111111',
    'user:22222222-2222-4222-8222-222222222222',
    'user:33333333-3333-4333-8333-333333333333',
  ])
  store.replace = async (identityKey, checkpoint) => {
    if (stuckIdentities.has(identityKey)) {
      store.calls.push(['replace-never', identityKey])
      return new Promise(() => {})
    }
    return originalReplace(identityKey, checkpoint)
  }
  const identities = [
    SOLO_RECOVERY_TEST_USER_ID,
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '99999999-9999-4999-8999-999999999999',
  ]
  let options = createBaseOptions(store)
  const hook = await mountRecovery(options)
  const staleEstablishments = []

  try {
    for (let index = 0; index < identities.length - 1; index += 1) {
      const userId = identities[index]
      const operation = hook.current.beginRoundOperation()
      staleEstablishments.push(hook.current.establishRound({
        sessionId: `${String(index + 4).repeat(8)}-4444-4444-8444-444444444444`,
        status: 'RUNNING',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId,
      }, operation))
      const nextUserId = identities[index + 1]
      options = {
        ...options,
        currentUser: { userId: nextUserId },
      }
      await hook.update(options)
      assert.equal(hook.current.identityKey, `user:${nextUserId}`)
      assert.equal(hook.current.isReady, true)
      assert.equal(hook.current.warning, '')
    }

    const staleResults = await Promise.all(staleEstablishments)
    assert.equal(staleResults.every((result) => result.stale), true)
    assert.equal(hook.current.warning, '')
    for (const userId of identities) {
      assert.equal(store.calls.some(
        ([operationName, identityKey]) =>
          operationName === 'read' && identityKey === `user:${userId}`,
      ), true)
    }
  } finally {
    await hook.unmount()
  }
})

test('active cleanup failure and timeout report persistence unavailable accurately', async () => {
  for (const cleanupMode of ['failed', 'timed-out']) {
    const store = createMemoryStore()
    const hook = await mountRecovery(createBaseOptions(store))
    const session = {
      sessionId: '44444444-4444-4444-8444-444444444444',
      status: 'RUNNING',
      durationSeconds: 60,
      startedAt: new Date(STARTED_AT).toISOString(),
      userId: SOLO_RECOVERY_TEST_USER_ID,
    }
    let releaseDelete

    try {
      await act(async () => establishTestRound(hook, session))
      store.delete = cleanupMode === 'failed'
        ? async () => ({
            ok: false,
            operation: 'delete',
            error: new Error('delete failed'),
          })
        : async () => new Promise((resolve) => {
            releaseDelete = resolve
          })

      let cleanup
      await act(async () => {
        cleanup = await hook.current.finishRound({ backendEnded: true })
      })
      assert.equal(cleanup.deleted, false, cleanupMode)
      assert.equal(cleanup.persistenceAvailable, false, cleanupMode)
      assert.equal(cleanup.timedOut, cleanupMode === 'timed-out', cleanupMode)
      assert.equal(hook.current.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
    } finally {
      releaseDelete?.({ ok: true, operation: 'delete' })
      await hook.unmount()
    }
  }
})

test('failed reconciling replacement does not report reconciliation success', async () => {
  const store = createMemoryStore()
  const hook = await mountRecovery(createBaseOptions(store))
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(STARTED_AT).toISOString(),
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }

  try {
    await act(async () => establishTestRound(hook, session))
    store.replace = async () => ({
      ok: false,
      operation: 'replace',
      error: new Error('replace failed'),
    })
    let cleanup
    await act(async () => {
      cleanup = await hook.current.finishRound({ backendEnded: false })
    })
    assert.equal(cleanup.reconciled, false)
    assert.equal(cleanup.persistenceAvailable, false)
    assert.equal(hook.current.warning, SOLO_RECOVERY_UNAVAILABLE_WARNING)
  } finally {
    await hook.unmount()
  }
})

test('old bootstrap result and runtime hydration are ignored after account switch', async () => {
  const checkpointA = createValidSoloCheckpoint()
  const store = createMemoryStore(new Map([
    [checkpointA.identityKey, checkpointA],
  ]))
  let resolveBackendA
  const backendA = new Promise((resolve) => {
    resolveBackendA = resolve
  })
  const hydrated = []
  const resetIdentities = []
  const userBId = '22222222-2222-4222-8222-222222222222'
  const options = createBaseOptions(store, {
    getBackendSession: async (sessionId) => {
      if (sessionId === checkpointA.round.backendSessionId) {
        return backendA
      }
      return null
    },
    hydratePlayer: async (checkpoint) => {
      hydrated.push(checkpoint.identityKey)
      return { kind: 'SETTLED' }
    },
    resetRuntime: () => resetIdentities.push('reset'),
  })
  const hook = await mountRecovery(options)

  try {
    await hook.update({
      ...options,
      currentUser: { userId: userBId },
    })
    assert.equal(hook.current.identityKey, `user:${userBId}`)
    assert.equal(hook.current.isReady, true)
    resolveBackendA(backendSession(checkpointA))
    await act(async () => flushWork())
    assert.deepEqual(hydrated, [])
    assert.equal(resetIdentities.length >= 2, true)
  } finally {
    resolveBackendA(backendSession(checkpointA))
    await hook.unmount()
  }
})

for (const staleOutcome of ['replace', 'delete']) {
  test(`bootstrap A1 ${staleOutcome} cannot mutate A2 after A -> B -> A`, async () => {
    const checkpointA1 = createValidSoloCheckpoint()
    const store = createMemoryStore(new Map([
      [checkpointA1.identityKey, checkpointA1],
    ]))
    const backendA1 = deferred()
    const userBId = '22222222-2222-4222-8222-222222222222'
    const sessionA2 = {
      sessionId: '99999999-9999-4999-8999-999999999999',
      status: 'RUNNING',
      durationSeconds: 60,
      startedAt: new Date(STARTED_AT + 1_000).toISOString(),
      userId: SOLO_RECOVERY_TEST_USER_ID,
    }
    let aBootstrapRequests = 0
    let adoptedBackendSessionId
    let playerHydrations = 0
    let roundHydrations = 0
    const options = createBaseOptions(store, {
      getBackendSession: async (sessionId) => {
        if (sessionId !== checkpointA1.round.backendSessionId) {
          return null
        }
        aBootstrapRequests += 1
        return aBootstrapRequests === 1
          ? backendA1.promise
          : backendSession(checkpointA1)
      },
      adoptBackendSession: (session) => {
        adoptedBackendSessionId = session?.sessionId ?? null
      },
      hydratePlayer: async () => {
        playerHydrations += 1
        return { kind: 'SETTLED' }
      },
      hydrateRound: () => {
        roundHydrations += 1
      },
    })
    const hook = await mountRecovery(options)

    try {
      await hook.update({
        ...options,
        currentUser: { userId: userBId },
      })
      assert.equal(hook.current.isReady, true)

      await hook.update(options)
      assert.equal(hook.current.isReady, true)
      assert.equal(aBootstrapRequests, 2)

      await act(async () => hook.current.resetRound())
      adoptedBackendSessionId = sessionA2.sessionId
      await act(async () => establishTestRound(hook, sessionA2))
      const scopeA2 = hook.current.captureActiveRoundScope()
      const hydrationCounts = {
        player: playerHydrations,
        round: roundHydrations,
      }
      const mutationCount = store.calls.filter(
        ([operation, identityKey]) =>
          identityKey === checkpointA1.identityKey &&
          (operation === 'replace' || operation === 'delete'),
      ).length

      assert.equal(
        store.records.get(checkpointA1.identityKey).round.backendSessionId,
        sessionA2.sessionId,
      )

      await act(async () => {
        if (staleOutcome === 'replace') {
          backendA1.resolve(backendSession(checkpointA1))
        } else {
          backendA1.reject(Object.assign(new Error('missing'), { status: 404 }))
        }
        await flushWork()
      })

      assert.equal(
        store.records.get(checkpointA1.identityKey).round.backendSessionId,
        sessionA2.sessionId,
      )
      assert.equal(
        hook.current.captureActiveRoundScope().backendSessionId,
        sessionA2.sessionId,
      )
      assert.equal(hook.current.isActiveRoundScopeCurrent(scopeA2), true)
      assert.equal(adoptedBackendSessionId, sessionA2.sessionId)
      assert.equal(hook.current.warning, '')
      assert.equal(hook.current.isReady, true)
      assert.deepEqual(
        { player: playerHydrations, round: roundHydrations },
        hydrationCounts,
      )
      assert.equal(store.calls.filter(
        ([operation, identityKey]) =>
          identityKey === checkpointA1.identityKey &&
          (operation === 'replace' || operation === 'delete'),
      ).length, mutationCount)
      assert.equal(hook.current.queueRuntimeCheckpoint({ movement: null }), true)
      await act(async () => flushWork())
      assert.equal(
        store.records.get(checkpointA1.identityKey).round.backendSessionId,
        sessionA2.sessionId,
      )
    } finally {
      backendA1.resolve(backendSession(checkpointA1))
      await hook.unmount()
    }
  })
}

test('round launch and finish scopes become stale across logout', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const guestIdentity = createGuestSoloIdentityKey(GUEST_INSTALLATION_ID)
  const store = createMemoryStore()
  const originalLocalStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => GUEST_INSTALLATION_ID,
    setItem: () => {},
  }
  const options = createBaseOptions(store)
  const hook = await mountRecovery(options)
  const launchA = hook.current.beginRoundOperation()
  const sessionA = backendSession(checkpoint)

  try {
    await hook.update({
      ...options,
      isAuthenticated: false,
      currentUser: null,
    })
    let lateStart
    await act(async () => {
      lateStart = await hook.current.establishRound(sessionA, launchA)
    })
    assert.equal(lateStart.stale, true)
    assert.equal(hook.current.identityKey, guestIdentity)
    assert.equal(store.records.has(guestIdentity), false)

    const staleFinish = await hook.current.finishRound({
      backendEnded: true,
      expectedScope: {
        identityKey: checkpoint.identityKey,
        lifecycleGeneration: launchA.lifecycleGeneration,
        clientRoundId: launchA.clientRoundId,
        backendSessionId: sessionA.sessionId,
      },
    })
    assert.equal(staleFinish.stale, true)
    assert.equal(store.records.has(guestIdentity), false)
  } finally {
    globalThis.localStorage = originalLocalStorage
    await hook.unmount()
  }
})

test('MOVING user A logout resets guest NONE to an explicit clean baseline', async () => {
  const checkpointA = createValidSoloCheckpoint()
  checkpointA.player.settledPosition = { lat: 28.61, lon: 77.31 }
  checkpointA.player.simulationSpeedMetersPerSecond = 160
  checkpointA.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: 'MOVING',
    purpose: 'MAP',
    destination: { lat: 28.65, lon: 77.35 },
    chasedTargetId: null,
    routeCoordinates: [[28.61, 77.31], [28.65, 77.35]],
    anchorDistanceMeters: 10,
    anchorTimeEpochMs: STARTED_AT + 1_000,
  }
  const store = createMemoryStore(new Map([
    [checkpointA.identityKey, checkpointA],
  ]))
  const runtime = {
    destination: null,
    moving: false,
    position: { lat: 28.5505, lon: 77.2688 },
    routeCoordinates: [],
    speed: 80,
  }
  const originalLocalStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => GUEST_INSTALLATION_ID,
    setItem: () => {},
  }
  const options = createBaseOptions(store, {
    hydratePlayer: async (checkpoint) => {
      runtime.destination = checkpoint.movement.destination
      runtime.moving = true
      runtime.position = checkpoint.player.settledPosition
      runtime.routeCoordinates = checkpoint.movement.routeCoordinates
      runtime.speed = checkpoint.player.simulationSpeedMetersPerSecond
      return { kind: 'MOVING', movement: checkpoint.movement }
    },
    resetRuntime: () => {
      runtime.destination = null
      runtime.moving = false
      runtime.position = { lat: 28.5505, lon: 77.2688 }
      runtime.routeCoordinates = []
      runtime.speed = 80
    },
  })
  const hook = await mountRecovery(options)

  try {
    assert.equal(runtime.moving, true)
    await hook.update({
      ...options,
      isAuthenticated: false,
      currentUser: null,
    })
    assert.equal(hook.current.isReady, true)
    assert.equal(hook.current.identityKey.startsWith('guest:'), true)
    assert.deepEqual(runtime, {
      destination: null,
      moving: false,
      position: { lat: 28.5505, lon: 77.2688 },
      routeCoordinates: [],
      speed: 80,
    })
    assert.equal(store.records.has(hook.current.identityKey), false)
  } finally {
    globalThis.localStorage = originalLocalStorage
    await hook.unmount()
  }
})
