import assert from 'node:assert/strict'
import test from 'node:test'
import React, { StrictMode } from 'react'
import { act, create } from 'react-test-renderer'
import { useBackendGameSession } from '../src/hooks/useBackendGameSession.js'
import { useSoloRoundRecovery } from '../src/hooks/useSoloRoundRecovery.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
  SOLO_RECOVERY_ROUND_PHASES,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const onlineListeners = new Set()
globalThis.window = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  addEventListener(type, listener) {
    if (type === 'online') {
      onlineListeners.add(listener)
    }
  },
  removeEventListener(type, listener) {
    if (type === 'online') {
      onlineListeners.delete(listener)
    }
  },
  dispatchEvent(event) {
    if (event.type === 'online') {
      for (const listener of [...onlineListeners]) {
        listener.call(this, event)
      }
    }
    return true
  },
}

const USER_B_ID = '22222222-2222-4222-8222-222222222222'
const SESSION_B_ID = '99999999-9999-4999-8999-999999999999'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

async function flushWork(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}

async function waitFor(predicate, message = 'condition was not reached') {
  for (let index = 0; index < 40; index += 1) {
    await act(async () => {
      await flushWork()
    })
    if (predicate()) {
      return
    }
  }
  assert.fail(message)
}

function createMemoryStore(records = new Map()) {
  const calls = []
  return {
    calls,
    records,
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
      calls.push(['replace', identityKey, structuredClone(checkpoint)])
      records.set(identityKey, structuredClone(checkpoint))
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push(['delete', identityKey])
      records.delete(identityKey)
      return { ok: true, operation: 'delete' }
    },
    close() {},
  }
}

function caughtTarget(index, {
  caughtAtEpochMs = STARTED_AT + 2_000 + index,
} = {}) {
  return {
    id: `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`,
    creatureId: index % 2 === 0 ? 'sparkbit' : 'roadling',
    lat: 28.5505,
    lon: 77.2688 + index / 10_000,
    rarity: 'common',
    score: 10,
    spawnedAt: STARTED_AT,
    expiresAt: STARTED_AT + 50_000,
    lifetimeMs: 50_000,
    caughtAt: caughtAtEpochMs,
  }
}

function pendingCatch(target, index, overrides = {}) {
  return {
    catchId: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`,
    targetId: target.id,
    creatureId: target.creatureId,
    caughtAtEpochMs: target.caughtAt,
    ...overrides,
  }
}

function checkpointWithPending({
  count = 1,
  identityKey,
  phase = SOLO_RECOVERY_ROUND_PHASES.RUNNING,
  sessionId,
  clientRoundId,
  caughtAtEpochMs,
} = {}) {
  const checkpoint = createValidSoloCheckpoint({
    identityKey,
    phase,
    score: count * 10,
  })
  if (sessionId) {
    checkpoint.round.backendSessionId = sessionId
  }
  if (clientRoundId) {
    checkpoint.round.clientRoundId = clientRoundId
  }
  checkpoint.caughtTargets = Array.from({ length: count }, (_, index) => (
    caughtTarget(index, {
      caughtAtEpochMs: caughtAtEpochMs?.[index],
    })
  ))
  checkpoint.backendSync.pendingCatches = checkpoint.caughtTargets.map(
    (target, index) => pendingCatch(target, index),
  )
  checkpoint.xp = checkpoint.score
  return checkpoint
}

function backendSession(checkpoint, overrides = {}) {
  return {
    sessionId: checkpoint.round.backendSessionId,
    status: checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING
      ? 'ENDED'
      : 'RUNNING',
    durationSeconds: checkpoint.round.durationSeconds,
    startedAt: new Date(checkpoint.round.startedAtEpochMs).toISOString(),
    endedAt: checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING
      ? new Date(checkpoint.round.endsAtEpochMs).toISOString()
      : null,
    score: checkpoint.score,
    caughtCount: checkpoint.caughtTargets.length,
    userId: checkpoint.identityKey.startsWith('user:')
      ? checkpoint.identityKey.slice('user:'.length)
      : null,
    ...overrides,
  }
}

function findSessionCheckpoint(store, sessionId) {
  return [...store.records.values()].find(
    (checkpoint) => checkpoint.round.backendSessionId === sessionId,
  )
}

function createBaseOptions(store, submitBackendCatchForSession, overrides = {}) {
  return {
    loadingAuth: false,
    isAuthenticated: true,
    currentUser: { userId: SOLO_RECOVERY_TEST_USER_ID },
    recoveryStore: store,
    getBackendSession: async (sessionId) => {
      const checkpoint = findSessionCheckpoint(store, sessionId)
      assert.ok(checkpoint, `missing checkpoint for backend session ${sessionId}`)
      return backendSession(checkpoint)
    },
    endBackendSession: async () => assert.fail('unexpected backend end'),
    getEpochTimeMs: () => STARTED_AT + 10_000,
    hydrateRound: () => {},
    hydratePlayer: async () => ({ kind: 'SETTLED' }),
    hydrateGameplay: async () => ({ isMovementValid: () => true }),
    adoptBackendSession: () => {},
    getRuntimeSnapshot: () => ({
      playerPosition: { lat: 28.5505, lon: 77.2688 },
      simulationSpeedMetersPerSecond: 80,
      movement: null,
      targets: [],
      caughtTargets: [],
      score: 0,
      xp: 0,
      spawning: { paused: false, nextSpawnAtEpochMs: null },
    }),
    submitBackendCatchForSession,
    ...overrides,
  }
}

function RecoveryHarness({ options, capture }) {
  capture(useSoloRoundRecovery(options))
  return null
}

function FullProductionRecoveryHarness({ options, capture }) {
  const backend = useBackendGameSession(options.token)
  const recovery = useSoloRoundRecovery({
    ...options.recovery,
    adoptBackendSession: backend.adoptBackendSession,
    submitBackendCatchForSession: backend.submitBackendCatchForSession,
  })
  capture({ backend, recovery })
  return null
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
      await act(async () => root.unmount())
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

async function mountFullProductionRecovery(options) {
  let current
  let root
  await act(async () => {
    root = create(React.createElement(FullProductionRecoveryHarness, {
      options,
      capture: (value) => { current = value },
    }))
    await flushWork()
  })
  return {
    get current() {
      return current
    },
    async unmount() {
      await act(async () => root.unmount())
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function clientResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

function fullProductionOptions(store) {
  return {
    token: 'token-A',
    recovery: {
      ...createBaseOptions(store, null),
      submitBackendCatchForSession: undefined,
      adoptBackendSession: undefined,
      getBackendSession: undefined,
    },
  }
}

function successResponse(sessionId, catchId, index = 0) {
  return {
    sessionId,
    catchId,
    status: 'RUNNING',
    score: (index + 1) * 10,
    caughtCount: index + 1,
    acceptedCatchScore: 10,
  }
}

test('production hydration submits the exact stored pending catch once and durably ACKs it', async () => {
  const checkpoint = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const submissions = []
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId, creatureId) => {
      submissions.push({ sessionId, catchId, creatureId })
      return successResponse(sessionId, catchId)
    },
  ))

  try {
    await waitFor(() => store.records.get(checkpoint.identityKey)
      ?.backendSync.pendingCatches.length === 0)
    assert.equal(hook.current.isReady, true)
    assert.deepEqual(submissions, [{
      sessionId: checkpoint.round.backendSessionId,
      catchId: checkpoint.backendSync.pendingCatches[0].catchId,
      creatureId: checkpoint.backendSync.pendingCatches[0].creatureId,
    }])
    const stored = store.records.get(checkpoint.identityKey)
    assert.equal(stored.score, 10)
    assert.equal(stored.xp, 10)
    assert.equal(stored.caughtTargets.length, 1)
  } finally {
    await hook.unmount()
  }
})

test('production hydration reaches the real game-session catch client with one exact POST', async () => {
  const checkpoint = checkpointWithPending()
  const pending = checkpoint.backendSync.pendingCatches[0]
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const originalFetch = globalThis.fetch
  const catchRequests = []
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith(`/api/game/sessions/${checkpoint.round.backendSessionId}`)) {
      return jsonResponse(backendSession(checkpoint))
    }
    if (url.endsWith(
      `/api/game/sessions/${checkpoint.round.backendSessionId}/catches`,
    )) {
      catchRequests.push({ url, options })
      const body = JSON.parse(options.body)
      return jsonResponse({
        ...successResponse(checkpoint.round.backendSessionId, body.catchId),
        creatureId: body.creatureId,
      })
    }
    assert.fail(`unexpected request ${url}`)
  }
  const hook = await mountFullProductionRecovery(fullProductionOptions(store))
  try {
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.equal(catchRequests.length, 1)
    assert.equal(catchRequests[0].options.method, 'POST')
    assert.equal(catchRequests[0].options.headers.Authorization, 'Bearer token-A')
    assert.deepEqual(JSON.parse(catchRequests[0].options.body), {
      catchId: pending.catchId,
      creatureId: pending.creatureId,
    })
    assert.equal(hook.current.backend.backendScore, 10)
    assert.equal(hook.current.backend.backendCaughtCount, 1)
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

for (const {
  name,
  response,
  expectedScore,
  expectedCaughtCount,
  acknowledged = true,
} of [
  {
    name: 'malformed score and valid caught count',
    response: (sessionId, catchId) => ({
      ...successResponse(sessionId, catchId),
      score: 'bad',
      caughtCount: 5,
    }),
    expectedScore: 10,
    expectedCaughtCount: 5,
  },
  {
    name: 'valid score and NaN caught count',
    response: (sessionId, catchId) => ({
      ...successResponse(sessionId, catchId),
      score: 50,
      caughtCount: Number.NaN,
    }),
    expectedScore: 50,
    expectedCaughtCount: 1,
  },
  {
    name: 'negative score',
    response: (sessionId, catchId) => ({
      ...successResponse(sessionId, catchId),
      score: -1,
      caughtCount: 5,
    }),
    expectedScore: 10,
    expectedCaughtCount: 5,
  },
  {
    name: 'fractional score',
    response: (sessionId, catchId) => ({
      ...successResponse(sessionId, catchId),
      score: 10.5,
      caughtCount: 5,
    }),
    expectedScore: 10,
    expectedCaughtCount: 5,
  },
  {
    name: 'infinite score',
    response: (sessionId, catchId) => ({
      ...successResponse(sessionId, catchId),
      score: Number.POSITIVE_INFINITY,
      caughtCount: 5,
    }),
    expectedScore: 10,
    expectedCaughtCount: 5,
  },
  {
    name: 'missing totals',
    response: (sessionId, catchId) => ({ sessionId, catchId }),
    expectedScore: 10,
    expectedCaughtCount: 1,
  },
  {
    name: 'mismatched catch identity with valid totals',
    response: (sessionId) => ({
      ...successResponse(
        sessionId,
        '88888888-8888-4888-8888-888888888888',
      ),
      score: 50,
      caughtCount: 5,
    }),
    expectedScore: 10,
    expectedCaughtCount: 1,
    acknowledged: false,
  },
]) {
  test(`production response with ${name} applies safe totals independently`, async () => {
    const checkpoint = checkpointWithPending()
    const pending = checkpoint.backendSync.pendingCatches[0]
    const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
    const originalFetch = globalThis.fetch
    const catchIds = []
    globalThis.fetch = async (url, options = {}) => {
      if (url.endsWith(`/api/game/sessions/${checkpoint.round.backendSessionId}`)) {
        return clientResponse(backendSession(checkpoint))
      }
      if (url.endsWith(
        `/api/game/sessions/${checkpoint.round.backendSessionId}/catches`,
      )) {
        const request = JSON.parse(options.body)
        catchIds.push(request.catchId)
        return clientResponse(response(
          checkpoint.round.backendSessionId,
          request.catchId,
        ))
      }
      assert.fail(`unexpected request ${url}`)
    }
    const hook = await mountFullProductionRecovery(fullProductionOptions(store))
    try {
      await waitFor(() => catchIds.length === 1)
      if (acknowledged) {
        await waitFor(() => store.records.get(checkpoint.identityKey)
          .backendSync.pendingCatches.length === 0)
      } else {
        await waitFor(() => hook.current.recovery.catchReplayWarning !== '')
      }
      assert.deepEqual(catchIds, [pending.catchId])
      assert.equal(store.records.get(checkpoint.identityKey)
        .backendSync.pendingCatches.length, acknowledged ? 0 : 1)
      assert.equal(hook.current.backend.backendScore, expectedScore)
      assert.equal(
        hook.current.backend.backendCaughtCount,
        expectedCaughtCount,
      )
      const stored = store.records.get(checkpoint.identityKey)
      assert.equal(stored.score, 10)
      assert.equal(stored.xp, 10)
      assert.equal(stored.caughtTargets.length, 1)
    } finally {
      await hook.unmount()
      globalThis.fetch = originalFetch
    }
  })
}

test('production hydration with no pending catches makes zero catch POSTs', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  let submissions = 0
  const hook = await mountRecovery(createBaseOptions(store, async () => {
    submissions += 1
  }))
  try {
    assert.equal(hook.current.isReady, true)
    assert.equal(submissions, 0)
  } finally {
    await hook.unmount()
  }
})

for (const [name, responseFactory] of [
  ['missing response catchId', () => ({ score: 90, caughtCount: 9 })],
  ['mismatched response catchId', () => ({
    catchId: '88888888-8888-4888-8888-888888888888',
    score: 90,
    caughtCount: 9,
  })],
]) {
  test(`recovered ${name} remains pending without an immediate retry`, async () => {
    const checkpoint = checkpointWithPending()
    const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
    let submissions = 0
    const hook = await mountRecovery(createBaseOptions(store, async () => {
      submissions += 1
      return responseFactory()
    }))
    try {
      await waitFor(() => submissions === 1)
      await flushWork()
      assert.equal(submissions, 1)
      assert.equal(store.records.get(checkpoint.identityKey)
        .backendSync.pendingCatches.length, 1)
      assert.notEqual(hook.current.catchReplayWarning, '')
      await act(async () => hook.current.retryPendingCatches())
      await flushWork()
      assert.equal(submissions, 1)
    } finally {
      await hook.unmount()
    }
  })
}

for (const status of [400, 401, 403, 404, 409]) {
  test(`recovered HTTP ${status} is terminal for this lifecycle and preserves evidence`, async () => {
    const checkpoint = checkpointWithPending()
    const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
    let submissions = 0
    const hook = await mountRecovery(createBaseOptions(store, async () => {
      submissions += 1
      const error = new Error(`HTTP ${status}`)
      error.status = status
      error.errorCode = status === 409 ? 'CATCH_ID_CONFLICT' : 'TEST_ERROR'
      throw error
    }))
    try {
      await waitFor(() => submissions === 1)
      assert.equal(store.records.get(checkpoint.identityKey)
        .backendSync.pendingCatches.length, 1)
      await act(async () => hook.current.retryPendingCatches())
      await flushWork()
      assert.equal(submissions, 1)
      assert.notEqual(hook.current.catchReplayWarning, '')
    } finally {
      await hook.unmount()
    }
  })
}

for (const [name, createError] of [
  ['network failure', () => new TypeError('connection reset')],
  ['HTTP 503', () => Object.assign(new Error('unavailable'), { status: 503 })],
]) {
  test(`${name} leaves pending, has no hot loop, and online retry reuses the same catchId`, async () => {
    const checkpoint = checkpointWithPending()
    const pending = checkpoint.backendSync.pendingCatches[0]
    const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
    const catchIds = []
    const hook = await mountRecovery(createBaseOptions(
      store,
      async (sessionId, catchId) => {
        catchIds.push(catchId)
        if (catchIds.length === 1) {
          throw createError()
        }
        return successResponse(sessionId, catchId)
      },
    ))
    try {
      await waitFor(() => catchIds.length === 1)
      await flushWork()
      assert.deepEqual(catchIds, [pending.catchId])
      assert.equal(store.records.get(checkpoint.identityKey)
        .backendSync.pendingCatches.length, 1)
      await act(async () => hook.current.retryPendingCatches())
      await waitFor(() => store.records.get(checkpoint.identityKey)
        .backendSync.pendingCatches.length === 0)
      assert.deepEqual(catchIds, [pending.catchId, pending.catchId])
    } finally {
      await hook.unmount()
    }
  })
}

test('StrictMode registers one online listener that retries the same catch and cleans up', async () => {
  assert.equal(onlineListeners.size, 0)
  const checkpoint = checkpointWithPending()
  const pending = checkpoint.backendSync.pendingCatches[0]
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const catchIds = []
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId) => {
      catchIds.push(catchId)
      if (catchIds.length === 1) {
        throw new TypeError('offline')
      }
      return successResponse(sessionId, catchId)
    },
  ), { strict: true })
  try {
    await waitFor(() => catchIds.length === 1)
    assert.equal(onlineListeners.size, 1)
    assert.equal(store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length, 1)
    await act(async () => {
      globalThis.window.dispatchEvent(new Event('online'))
      await flushWork()
    })
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.deepEqual(catchIds, [pending.catchId, pending.catchId])
  } finally {
    await hook.unmount()
  }
  assert.equal(onlineListeners.size, 0)
})

test('production HTTP 429 stays pending without a hot loop and retries once', async () => {
  const checkpoint = checkpointWithPending()
  const pending = checkpoint.backendSync.pendingCatches[0]
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const originalFetch = globalThis.fetch
  const catchIds = []
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith(`/api/game/sessions/${checkpoint.round.backendSessionId}`)) {
      return clientResponse(backendSession(checkpoint))
    }
    if (url.endsWith(
      `/api/game/sessions/${checkpoint.round.backendSessionId}/catches`,
    )) {
      const request = JSON.parse(options.body)
      catchIds.push(request.catchId)
      if (catchIds.length === 1) {
        return clientResponse({
          message: 'rate limited',
          errorCode: 'RATE_LIMITED',
        }, 429)
      }
      return clientResponse(successResponse(
        checkpoint.round.backendSessionId,
        request.catchId,
      ))
    }
    assert.fail(`unexpected request ${url}`)
  }
  const hook = await mountFullProductionRecovery(fullProductionOptions(store))
  try {
    await waitFor(() => catchIds.length === 1)
    await act(async () => flushWork(20))
    assert.deepEqual(catchIds, [pending.catchId])
    assert.equal(store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length, 1)
    assert.notEqual(hook.current.recovery.catchReplayWarning, '')
    await act(async () => hook.current.recovery.retryPendingCatches())
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.deepEqual(catchIds, [pending.catchId, pending.catchId])
  } finally {
    await hook.unmount()
    globalThis.fetch = originalFetch
  }
})

test('three pending catches replay sequentially by caught time then catchId without local awards', async () => {
  const checkpoint = checkpointWithPending({
    count: 3,
    caughtAtEpochMs: [
      STARTED_AT + 4_000,
      STARTED_AT + 2_000,
      STARTED_AT + 2_000,
    ],
  })
  const expected = [...checkpoint.backendSync.pendingCatches]
    .sort((left, right) => left.caughtAtEpochMs - right.caughtAtEpochMs ||
      left.catchId.localeCompare(right.catchId))
    .map((entry) => entry.catchId)
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const order = []
  let concurrent = 0
  let maximumConcurrent = 0
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId) => {
      concurrent += 1
      maximumConcurrent = Math.max(maximumConcurrent, concurrent)
      order.push(catchId)
      await Promise.resolve()
      concurrent -= 1
      return successResponse(sessionId, catchId, order.length - 1)
    },
  ))
  try {
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.deepEqual(order, expected)
    assert.equal(maximumConcurrent, 1)
    const stored = store.records.get(checkpoint.identityKey)
    assert.equal(stored.score, 30)
    assert.equal(stored.xp, 30)
    assert.equal(stored.caughtTargets.length, 3)
  } finally {
    await hook.unmount()
  }
})

test('terminal C1 does not block C2, while C1 evidence remains pending', async () => {
  const checkpoint = checkpointWithPending({ count: 2 })
  const [catchOne, catchTwo] = checkpoint.backendSync.pendingCatches
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const order = []
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId) => {
      order.push(catchId)
      if (catchId === catchOne.catchId) {
        throw Object.assign(new Error('conflict'), {
          status: 409,
          errorCode: 'CATCH_ID_CONFLICT',
        })
      }
      return successResponse(sessionId, catchId, 1)
    },
  ))
  try {
    await waitFor(() => order.length === 2)
    assert.deepEqual(order, [catchOne.catchId, catchTwo.catchId])
    assert.deepEqual(
      store.records.get(checkpoint.identityKey)
        .backendSync.pendingCatches.map((entry) => entry.catchId),
      [catchOne.catchId],
    )
  } finally {
    await hook.unmount()
  }
})

test('transient C2 stops C3 until one controlled retry trigger', async () => {
  const checkpoint = checkpointWithPending({ count: 3 })
  const [catchOne, catchTwo, catchThree] = checkpoint.backendSync.pendingCatches
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const order = []
  let catchTwoAttempts = 0
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId) => {
      order.push(catchId)
      if (catchId === catchTwo.catchId && catchTwoAttempts === 0) {
        catchTwoAttempts += 1
        throw new TypeError('offline')
      }
      return successResponse(sessionId, catchId)
    },
  ))
  try {
    await waitFor(() => order.length === 2)
    assert.deepEqual(order, [catchOne.catchId, catchTwo.catchId])
    assert.equal(store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length, 2)
    await act(async () => hook.current.retryPendingCatches())
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.deepEqual(order, [
      catchOne.catchId,
      catchTwo.catchId,
      catchTwo.catchId,
      catchThree.catchId,
    ])
  } finally {
    await hook.unmount()
  }
})

test('ACK persistence failure restores pending and a reload replays the same identity safely', async () => {
  const checkpoint = checkpointWithPending()
  const pending = checkpoint.backendSync.pendingCatches[0]
  const records = new Map([[checkpoint.identityKey, checkpoint]])
  const store = createMemoryStore(records)
  const successfulReplace = store.replace.bind(store)
  let rejectAck = true
  store.replace = async (identityKey, replacement) => {
    if (rejectAck && replacement.backendSync.pendingCatches.length === 0) {
      rejectAck = false
      store.calls.push(['replace-failed-ack', identityKey])
      return { ok: false, operation: 'replace', error: new Error('disk full') }
    }
    return successfulReplace(identityKey, replacement)
  }
  const catchIds = []
  const submit = async (sessionId, catchId) => {
    catchIds.push(catchId)
    return successResponse(sessionId, catchId)
  }
  const options = createBaseOptions(store, submit)
  const firstHook = await mountRecovery(options)
  try {
    await waitFor(() => firstHook.current.catchReplayWarning !== '')
    assert.deepEqual(catchIds, [pending.catchId])
    assert.equal(records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length, 1)
  } finally {
    await firstHook.unmount()
  }

  const secondHook = await mountRecovery(options)
  try {
    await waitFor(() => records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.deepEqual(catchIds, [pending.catchId, pending.catchId])
  } finally {
    await secondHook.unmount()
  }

  const thirdHook = await mountRecovery(options)
  try {
    assert.equal(thirdHook.current.isReady, true)
    assert.deepEqual(catchIds, [pending.catchId, pending.catchId])
  } finally {
    await thirdHook.unmount()
  }
})

test('StrictMode and rerender share one recovered in-flight request', async () => {
  const checkpoint = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const response = deferred()
  let submissions = 0
  const options = createBaseOptions(store, async () => {
    submissions += 1
    return response.promise
  })
  const hook = await mountRecovery(options, { strict: true })
  try {
    await waitFor(() => submissions === 1)
    await hook.update(options)
    assert.equal(submissions, 1)
    response.resolve(successResponse(
      checkpoint.round.backendSessionId,
      checkpoint.backendSync.pendingCatches[0].catchId,
    ))
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.equal(submissions, 1)
  } finally {
    response.resolve(null)
    await hook.unmount()
  }
})

test('a never-settling recovered POST does not block READY or duplicate on rerender', async () => {
  const checkpoint = checkpointWithPending()
  const pending = checkpoint.backendSync.pendingCatches[0]
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const response = deferred()
  let submissions = 0
  let hydratedRound = null
  let hydratedPlayer = null
  let hydratedGameplay = null
  let unmounted = false
  const options = createBaseOptions(store, async () => {
    submissions += 1
    return response.promise
  }, {
    hydrateRound: (timeline) => {
      hydratedRound = structuredClone(timeline)
    },
    hydratePlayer: async (recovered) => {
      hydratedPlayer = structuredClone(recovered)
      return { kind: 'SETTLED' }
    },
    hydrateGameplay: async (recovered) => {
      hydratedGameplay = structuredClone(recovered)
      return { isMovementValid: () => true }
    },
  })
  const hook = await mountRecovery(options)
  try {
    await waitFor(() => hook.current.isReady && submissions === 1)
    assert.equal(hydratedRound.startedAtEpochMs,
      checkpoint.round.startedAtEpochMs)
    assert.deepEqual(hydratedPlayer.player, checkpoint.player)
    assert.deepEqual(hydratedGameplay.targets, checkpoint.targets)
    assert.deepEqual(
      hydratedGameplay.caughtTargets.map((target) => target.id),
      checkpoint.caughtTargets.map((target) => target.id),
    )
    assert.equal(store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length, 1)
    await hook.update(options)
    await act(async () => flushWork(20))
    assert.equal(hook.current.isReady, true)
    assert.equal(submissions, 1)

    await hook.unmount()
    unmounted = true
    await act(async () => {
      response.resolve(successResponse(
        checkpoint.round.backendSessionId,
        pending.catchId,
      ))
      await flushWork(20)
    })
    assert.equal(store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length, 1)
  } finally {
    if (!unmounted) {
      await hook.unmount()
    }
    response.resolve(null)
  }
})

test('live submission racing the recovered worker shares one in-flight catch request', async () => {
  const store = createMemoryStore()
  const response = deferred()
  const calls = []
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId, creatureId) => {
      calls.push({ sessionId, catchId, creatureId })
      return response.promise
    },
  ))
  try {
    const operation = hook.current.beginRoundOperation()
    let established
    await act(async () => {
      established = await hook.current.establishRound({
        sessionId: '44444444-4444-4444-8444-444444444444',
        status: 'RUNNING',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId: SOLO_RECOVERY_TEST_USER_ID,
      }, operation)
      hook.current.completeRoundOperation(operation)
    })
    const target = {
      ...caughtTarget(0),
      caughtAt: undefined,
    }
    assert.equal(hook.current.queueRuntimeCheckpoint({ targets: [target] }), true)
    await act(async () => flushWork())
    const caught = hook.current.applyTargetCatch({
      targetId: target.id,
      caughtAtEpochMs: STARTED_AT + 10_000,
    })
    const live = hook.current.submitPendingCatch(caught)
    await act(async () => hook.current.retryPendingCatches())
    await waitFor(() => calls.length === 1)
    response.resolve(successResponse(
      established.scope.backendSessionId,
      caught.pendingCatch.catchId,
    ))
    const result = await live
    assert.equal(result.acknowledged, true)
    assert.equal(calls.length, 1)
  } finally {
    response.resolve(null)
    await hook.unmount()
  }
})

test('reset during recovered replay prevents checkpoint resurrection', async () => {
  const checkpoint = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const response = deferred()
  let submissions = 0
  const hook = await mountRecovery(createBaseOptions(store, async () => {
    submissions += 1
    return response.promise
  }))
  try {
    await waitFor(() => submissions === 1)
    await act(async () => hook.current.resetRound())
    assert.equal(store.records.has(checkpoint.identityKey), false)
    response.resolve(successResponse(
      checkpoint.round.backendSessionId,
      checkpoint.backendSync.pendingCatches[0].catchId,
    ))
    await act(async () => flushWork())
    assert.equal(store.records.has(checkpoint.identityKey), false)
    assert.equal(hook.current.catchReplayWarning, '')
  } finally {
    response.resolve(null)
    await hook.unmount()
  }
})

test('identity A replay completion cannot mutate identity B', async () => {
  const checkpointA = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpointA.identityKey, checkpointA]]))
  const responseA = deferred()
  let submissions = 0
  const submit = async () => {
    submissions += 1
    return responseA.promise
  }
  const optionsA = createBaseOptions(store, submit)
  const hook = await mountRecovery(optionsA)
  try {
    await waitFor(() => submissions === 1)
    await hook.update({
      ...optionsA,
      currentUser: { userId: USER_B_ID },
    })
    responseA.resolve(successResponse(
      checkpointA.round.backendSessionId,
      checkpointA.backendSync.pendingCatches[0].catchId,
    ))
    await act(async () => flushWork())
    assert.equal(store.records.has(`user:${USER_B_ID}`), false)
    assert.equal(hook.current.catchReplayWarning, '')
  } finally {
    responseA.resolve(null)
    await hook.unmount()
  }
})

test('old A1 replay completion cannot acknowledge A2 after A to B to A', async () => {
  const checkpointA = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpointA.identityKey, checkpointA]]))
  const responses = [deferred(), deferred()]
  const catchCalls = []
  const submit = async (sessionId, catchId) => {
    const index = catchCalls.length
    catchCalls.push(catchId)
    return responses[index].promise
  }
  const optionsA = createBaseOptions(store, submit)
  const hook = await mountRecovery(optionsA)
  try {
    await waitFor(() => catchCalls.length === 1)
    await hook.update({
      ...optionsA,
      currentUser: { userId: USER_B_ID },
    })
    await hook.update(optionsA)
    await waitFor(() => catchCalls.length === 2)
    const pendingA2 = store.records.get(checkpointA.identityKey)
      .backendSync.pendingCatches[0]
    const caughtA2 = store.records.get(checkpointA.identityKey)
      .caughtTargets.find((target) => target.id === pendingA2.targetId)
    const scopeA2 = hook.current.captureActiveRoundScope()
    const submissionA2 = {
      caughtTarget: caughtA2,
      pendingCatch: pendingA2,
      scope: {
        ...scopeA2,
        catchId: pendingA2.catchId,
        targetId: pendingA2.targetId,
      },
      durability: Promise.resolve({ ok: true, durable: true }),
    }
    const a2FlightBeforeA1Cleanup = hook.current.submitPendingCatch(submissionA2)
    responses[0].resolve(successResponse(
      checkpointA.round.backendSessionId,
      checkpointA.backendSync.pendingCatches[0].catchId,
    ))
    await act(async () => flushWork())
    assert.equal(store.records.get(checkpointA.identityKey)
      .backendSync.pendingCatches.length, 1)
    assert.equal(hook.current.catchReplayWarning, '')
    await act(async () => hook.current.retryPendingCatches())
    await act(async () => flushWork())
    const a2FlightAfterA1Cleanup = hook.current.submitPendingCatch(submissionA2)
    assert.strictEqual(a2FlightAfterA1Cleanup, a2FlightBeforeA1Cleanup)
    assert.equal(catchCalls.length, 2)
    responses[1].resolve(successResponse(
      checkpointA.round.backendSessionId,
      checkpointA.backendSync.pendingCatches[0].catchId,
    ))
    await waitFor(() => store.records.get(checkpointA.identityKey)
      .backendSync.pendingCatches.length === 0)
  } finally {
    responses.forEach((response) => response.resolve(null))
    await hook.unmount()
  }
})

test('round A replay completion cannot mutate newly established round B', async () => {
  const checkpointA = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpointA.identityKey, checkpointA]]))
  const responseA = deferred()
  let submissions = 0
  const hook = await mountRecovery(createBaseOptions(store, async () => {
    submissions += 1
    return responseA.promise
  }))
  try {
    await waitFor(() => submissions === 1)
    await act(async () => hook.current.resetRound())
    const operation = hook.current.beginRoundOperation()
    await act(async () => {
      await hook.current.establishRound({
        sessionId: SESSION_B_ID,
        status: 'RUNNING',
        durationSeconds: 60,
        startedAt: new Date(STARTED_AT).toISOString(),
        userId: SOLO_RECOVERY_TEST_USER_ID,
      }, operation)
      hook.current.completeRoundOperation(operation)
    })
    const before = structuredClone(store.records.get(checkpointA.identityKey))
    responseA.resolve(successResponse(
      checkpointA.round.backendSessionId,
      checkpointA.backendSync.pendingCatches[0].catchId,
    ))
    await act(async () => flushWork())
    assert.deepEqual(store.records.get(checkpointA.identityKey), before)
  } finally {
    responseA.resolve(null)
    await hook.unmount()
  }
})

test('RUNNING to RECONCILING same-round completion durably ACKs without resuming gameplay', async () => {
  const checkpoint = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const response = deferred()
  let submissions = 0
  const hook = await mountRecovery(createBaseOptions(store, async () => {
    submissions += 1
    return response.promise
  }))
  try {
    await waitFor(() => submissions === 1)
    const scope = hook.current.captureActiveRoundScope()
    await act(async () => hook.current.finishRound({
      backendEnded: true,
      expectedScope: scope,
    }))
    assert.equal(store.records.get(checkpoint.identityKey).round.phase,
      SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
    response.resolve(successResponse(
      checkpoint.round.backendSessionId,
      checkpoint.backendSync.pendingCatches[0].catchId,
    ))
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    const stored = store.records.get(checkpoint.identityKey)
    assert.equal(stored.round.phase, SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
    assert.equal(stored.movement, null)
    assert.deepEqual(stored.targets, [])
  } finally {
    response.resolve(null)
    await hook.unmount()
  }
})

test('an already RECONCILING checkpoint replays an exact catch after backend session end', async () => {
  const checkpoint = checkpointWithPending({
    phase: SOLO_RECOVERY_ROUND_PHASES.RECONCILING,
  })
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  const submissions = []
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId) => {
      submissions.push(catchId)
      return {
        ...successResponse(sessionId, catchId),
        status: 'ENDED',
      }
    },
    { getEpochTimeMs: () => checkpoint.round.endsAtEpochMs + 2_000 },
  ))
  try {
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.deepEqual(submissions, [checkpoint.backendSync.pendingCatches[0].catchId])
    assert.equal(store.records.get(checkpoint.identityKey).round.phase,
      SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
  } finally {
    await hook.unmount()
  }
})

test('missing backend session preserves pending evidence without catch submission hot-loop', async () => {
  const checkpoint = checkpointWithPending()
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  let submissions = 0
  const missing = Object.assign(new Error('not found'), { status: 404 })
  const hook = await mountRecovery(createBaseOptions(
    store,
    async () => { submissions += 1 },
    { getBackendSession: async () => { throw missing } },
  ))
  try {
    assert.equal(hook.current.isReady, true)
    assert.equal(submissions, 0)
    const stored = store.records.get(checkpoint.identityKey)
    assert.equal(stored.round.phase, SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
    assert.equal(stored.backendSync.pendingCatches.length, 1)
    assert.notEqual(hook.current.warning, '')
  } finally {
    await hook.unmount()
  }
})

test('downtime-generated pending catch is locally awarded before exact backend replay', async () => {
  const checkpoint = createValidSoloCheckpoint({
    updatedAtEpochMs: STARTED_AT + 5_000,
  })
  const route = [
    [28.5505, 77.2688],
    [28.5505, 77.2718],
  ]
  checkpoint.player.simulationSpeedMetersPerSecond = 10
  checkpoint.targets = [{
    ...caughtTarget(0),
    caughtAt: undefined,
    lon: 77.2698,
  }]
  checkpoint.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: SOLO_RECOVERY_MOVEMENT_PHASES.MOVING,
    purpose: SOLO_RECOVERY_MOVEMENT_PURPOSES.MAP,
    destination: { lat: route.at(-1)[0], lon: route.at(-1)[1] },
    chasedTargetId: null,
    routeCoordinates: route,
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: STARTED_AT + 5_000,
  }
  const store = createMemoryStore(new Map([[checkpoint.identityKey, checkpoint]]))
  let hydrated = null
  const submissions = []
  const hook = await mountRecovery(createBaseOptions(
    store,
    async (sessionId, catchId, creatureId) => {
      assert.equal(hydrated.score, 10)
      assert.equal(hydrated.xp, 10)
      assert.equal(hydrated.caughtTargets.length, 1)
      assert.equal(hydrated.backendSync.pendingCatches[0].catchId, catchId)
      submissions.push({ catchId, creatureId })
      return successResponse(sessionId, catchId)
    },
    {
      getEpochTimeMs: () => STARTED_AT + 20_000,
      hydrateGameplay: async (recovered) => {
        hydrated = structuredClone(recovered)
        return { isMovementValid: () => true }
      },
    },
  ))
  try {
    await waitFor(() => submissions.length === 1)
    await waitFor(() => store.records.get(checkpoint.identityKey)
      .backendSync.pendingCatches.length === 0)
    assert.equal(submissions[0].creatureId, 'sparkbit')
    const stored = store.records.get(checkpoint.identityKey)
    assert.equal(stored.score, 10)
    assert.equal(stored.xp, 10)
    assert.equal(stored.caughtTargets.length, 1)
  } finally {
    await hook.unmount()
  }
})
