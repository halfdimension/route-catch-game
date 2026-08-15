import assert from 'node:assert/strict'
import test from 'node:test'
import {
  finishSoloGameplayRound,
  resetSoloGameplayRound,
  restartSoloGameplayRound,
  startSoloGameplayRound,
} from '../src/recovery/soloGameplayLifecycle.js'

const IDENTITY_A = 'user:11111111-1111-4111-8111-111111111111'
const IDENTITY_B = 'user:22222222-2222-4222-8222-222222222222'
const SESSION_A = '44444444-4444-4444-8444-444444444444'
const SESSION_B = '88888888-8888-4888-8888-888888888888'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function runningSession(sessionId, userId) {
  return {
    sessionId,
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(1_000).toISOString(),
    userId,
  }
}

function createRecoveryHarness({
  identityKey = IDENTITY_A,
  activeSessionId = null,
} = {}) {
  let lifecycleGeneration = 1
  let nextOperationId = 0
  let launch = null
  let active = activeSessionId
    ? {
        identityKey,
        lifecycleGeneration,
        clientRoundId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        backendSessionId: activeSessionId,
      }
    : null
  let resetCleanup = Promise.resolve({
    deleted: true,
    persistenceAvailable: true,
  })
  const establishedSessions = []

  const operationCurrent = (scope, { requireLaunch = false } = {}) => Boolean(
    scope &&
    scope.identityKey === identityKey &&
    scope.lifecycleGeneration === lifecycleGeneration &&
    (!requireLaunch || launch?.operationId === scope.operationId),
  )
  const activeCurrent = (scope) => Boolean(
    operationCurrent(scope) &&
    active &&
    active.clientRoundId === scope.clientRoundId &&
    active.backendSessionId === scope.backendSessionId,
  )
  const beginLaunch = () => {
    if (launch) {
      return null
    }
    const scope = {
      identityKey,
      lifecycleGeneration,
      operationId: nextOperationId + 1,
      clientRoundId: `${String(nextOperationId + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
      backendSessionId: null,
    }
    nextOperationId = scope.operationId
    launch = scope
    return scope
  }

  return {
    get active() {
      return active
    },
    get establishedSessions() {
      return establishedSessions
    },
    get lifecycleGeneration() {
      return lifecycleGeneration
    },
    beginRoundOperation: beginLaunch,
    beginRestartOperation() {
      const scope = beginLaunch()
      if (!scope) {
        return null
      }
      lifecycleGeneration += 1
      scope.lifecycleGeneration = lifecycleGeneration
      active = null
      return {
        scope,
        cleanup: Promise.resolve({
          deleted: true,
          persistenceAvailable: true,
        }),
      }
    },
    captureActiveRoundScope: () => active ? { ...active } : null,
    completeRoundOperation(scope) {
      if (launch?.operationId === scope?.operationId) {
        launch = null
      }
    },
    async establishRound(session, scope) {
      if (!operationCurrent(scope, { requireLaunch: true })) {
        return { stale: true, timeline: null }
      }
      active = {
        identityKey: scope.identityKey,
        lifecycleGeneration: scope.lifecycleGeneration,
        clientRoundId: scope.clientRoundId,
        backendSessionId: session.sessionId,
      }
      establishedSessions.push(session.sessionId)
      return {
        stale: false,
        timeline: {
          durationSeconds: 60,
          startedAtEpochMs: 1_000,
          endsAtEpochMs: 61_000,
        },
        scope: { ...active },
      }
    },
    async finishRound({ expectedScope }) {
      if (!activeCurrent(expectedScope)) {
        return { stale: true }
      }
      active = null
      lifecycleGeneration += 1
      return { stale: false, deleted: true, persistenceAvailable: true }
    },
    isActiveRoundScopeCurrent: activeCurrent,
    isOperationCurrent: operationCurrent,
    resetRound() {
      lifecycleGeneration += 1
      launch = null
      active = null
      return resetCleanup
    },
    setIdentity(nextIdentityKey) {
      identityKey = nextIdentityKey
      lifecycleGeneration += 1
      launch = null
      active = null
    },
    setResetCleanup(cleanup) {
      resetCleanup = cleanup
    },
  }
}

test('App coordinator: reset A -> start B -> late finish A cannot affect B', async () => {
  const recovery = createRecoveryHarness({ activeSessionId: SESSION_A })
  const checkpointCleanup = deferred()
  const backendCleanup = deferred()
  const finishedSessionIds = []
  const invalidations = []
  recovery.setResetCleanup(checkpointCleanup.promise)
  const reset = resetSoloGameplayRound({
    recovery,
    backend: {
      finishSessionById(sessionId) {
        finishedSessionIds.push(sessionId)
        return backendCleanup.promise
      },
      invalidateSessionOperations(options) {
        invalidations.push(options)
      },
    },
    resetRuntime: () => {},
  })
  const generationAfterReset = recovery.lifecycleGeneration

  const startB = await startSoloGameplayRound({
    recovery,
    backend: {
      beginSession: async () => runningSession(
        SESSION_B,
        IDENTITY_A.slice('user:'.length),
      ),
    },
    durationSeconds: 60,
    playerName: 'B',
  })
  assert.equal(startB.started, true)
  assert.equal(recovery.active.backendSessionId, SESSION_B)

  checkpointCleanup.resolve({ deleted: true, persistenceAvailable: true })
  backendCleanup.resolve(false)
  const resetResult = await reset

  assert.equal(resetResult.backendEnded, false)
  assert.deepEqual(finishedSessionIds, [SESSION_A])
  assert.deepEqual(invalidations, [{ clearSession: true }])
  assert.equal(recovery.active.backendSessionId, SESSION_B)
  assert.equal(recovery.lifecycleGeneration, generationAfterReset)
})

for (const switchKind of ['logout', 'identity B']) {
  test(`App coordinator: start A pending -> ${switchKind} ignores late A`, async () => {
    const recovery = createRecoveryHarness()
    const backendStart = deferred()
    const started = []
    const pendingStart = startSoloGameplayRound({
      recovery,
      backend: { beginSession: () => backendStart.promise },
      durationSeconds: 60,
      playerName: 'A',
      onStarted: () => started.push('A'),
    })

    recovery.setIdentity(switchKind === 'logout' ? 'guest:77777777-7777-4777-8777-777777777777' : IDENTITY_B)
    backendStart.resolve(runningSession(SESSION_A, IDENTITY_A.slice(5)))
    const result = await pendingStart

    assert.equal(result.started, false)
    assert.equal(result.stale, true)
    assert.deepEqual(started, [])
    assert.deepEqual(recovery.establishedSessions, [])
  })
}

test('App coordinator: repeated start in one tick launches one backend session', async () => {
  const recovery = createRecoveryHarness()
  const backendStart = deferred()
  let launchCount = 0
  const backend = {
    beginSession() {
      launchCount += 1
      return backendStart.promise
    },
  }
  const first = startSoloGameplayRound({
    recovery,
    backend,
    durationSeconds: 60,
    playerName: 'A',
  })
  const repeated = await startSoloGameplayRound({
    recovery,
    backend,
    durationSeconds: 60,
    playerName: 'A',
  })

  assert.equal(repeated.started, false)
  assert.equal(launchCount, 1)
  backendStart.resolve(runningSession(SESSION_A, IDENTITY_A.slice(5)))
  assert.equal((await first).started, true)
})

test('App coordinator: invalidated restart A cannot replace restart B', async () => {
  const recovery = createRecoveryHarness({ activeSessionId: SESSION_A })
  const restartAResponse = deferred()
  const restartA = restartSoloGameplayRound({
    recovery,
    backend: {
      invalidateSessionOperations: () => {},
      replaceSession: () => restartAResponse.promise,
    },
    durationSeconds: 60,
    playerName: 'A',
  })
  await Promise.resolve()

  recovery.setIdentity(IDENTITY_B)
  const restartB = await restartSoloGameplayRound({
    recovery,
    backend: {
      invalidateSessionOperations: () => {},
      replaceSession: async () => runningSession(SESSION_B, IDENTITY_B.slice(5)),
    },
    durationSeconds: 60,
    playerName: 'B',
  })
  assert.equal(restartB.started, true)

  restartAResponse.resolve(runningSession(SESSION_A, IDENTITY_A.slice(5)))
  assert.equal((await restartA).started, false)
  assert.equal(recovery.active.backendSessionId, SESSION_B)
  assert.deepEqual(recovery.establishedSessions, [SESSION_B])
})

test('App coordinator: finish A pending -> establish B preserves B', async () => {
  const recovery = createRecoveryHarness({ activeSessionId: SESSION_A })
  const scopeA = recovery.captureActiveRoundScope()
  const backendFinish = deferred()
  const finishingA = finishSoloGameplayRound({
    recovery,
    backend: { finishSession: () => backendFinish.promise },
    scope: scopeA,
    failureMessage: 'failed',
  })

  recovery.setIdentity(IDENTITY_B)
  const startedB = await startSoloGameplayRound({
    recovery,
    backend: {
      beginSession: async () => runningSession(SESSION_B, IDENTITY_B.slice(5)),
    },
    durationSeconds: 60,
    playerName: 'B',
  })
  assert.equal(startedB.started, true)

  backendFinish.resolve(true)
  const finishResult = await finishingA
  assert.equal(finishResult.stale, true)
  assert.equal(recovery.active.backendSessionId, SESSION_B)
})
