import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'
import {
  DEFAULT_TRAVEL_MODE,
  TRAVEL_MODES,
  isTravelMode,
  requireTravelMode,
} from '../src/config/travelMode.js'
import { useSoloRoundRecovery } from '../src/hooks/useSoloRoundRecovery.js'
import {
  SOLO_RECOVERY_ROUND_PHASES,
  parseSoloRecoveryCheckpoint,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import {
  createValidSoloCheckpoint,
  createValidSoloV1Checkpoint,
  SOLO_RECOVERY_TEST_STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const IDENTITY_KEY = `user:${SOLO_RECOVERY_TEST_USER_ID}`
const SESSION_IDS = [
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
]

function runningSession(
  sessionId = SESSION_IDS[0],
  userId = SOLO_RECOVERY_TEST_USER_ID,
) {
  return {
    sessionId,
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(SOLO_RECOVERY_TEST_STARTED_AT).toISOString(),
    endedAt: null,
    score: 0,
    caughtCount: 0,
    userId,
  }
}

function endedSession(sessionId = SESSION_IDS[0]) {
  return {
    ...runningSession(sessionId),
    status: 'ENDED',
    endedAt: new Date(
      SOLO_RECOVERY_TEST_STARTED_AT + 60_000,
    ).toISOString(),
  }
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

function targetFixture() {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    creatureId: 'sparkbit',
    lat: 28.5505,
    lon: 77.2688,
    rarity: 'common',
    score: 10,
    spawnedAt: SOLO_RECOVERY_TEST_STARTED_AT + 1_000,
    expiresAt: SOLO_RECOVERY_TEST_STARTED_AT + 50_000,
    lifetimeMs: 49_000,
  }
}

function checkpointWithPendingCatch({
  phase = SOLO_RECOVERY_ROUND_PHASES.RECONCILING,
  travelMode = TRAVEL_MODES.WALKING,
} = {}) {
  const target = {
    ...targetFixture(),
    caughtAt: SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
  }
  const checkpoint = createValidSoloCheckpoint({
    phase,
    score: target.score,
    travelMode,
  })
  checkpoint.caughtTargets = [target]
  checkpoint.backendSync.pendingCatches = [{
    catchId: '77777777-7777-4777-8777-777777777777',
    targetId: target.id,
    creatureId: target.creatureId,
    caughtAtEpochMs: target.caughtAt,
  }]
  checkpoint.xp = checkpoint.score
  return checkpoint
}

function successfulCatchResponse(sessionId, catchId) {
  return {
    sessionId,
    catchId,
    status: 'ENDED',
    score: 10,
    caughtCount: 1,
    acceptedCatchScore: 10,
  }
}

function createMemoryRecoveryStore(initialRecord = null) {
  let record = initialRecord ? structuredClone(initialRecord) : null
  const replacements = []
  const deletions = []

  return {
    replacements,
    deletions,
    get record() {
      return record ? structuredClone(record) : null
    },
    async read(identityKey) {
      if (!record || record.identityKey !== identityKey) {
        return { ok: true, operation: 'read', checkpoint: null }
      }
      const parsed = parseSoloRecoveryCheckpoint(record, {
        expectedIdentityKey: identityKey,
      })
      return parsed.ok
        ? {
            ok: true,
            operation: 'read',
            checkpoint: parsed.checkpoint,
            migratedFromSchemaVersion: parsed.migratedFromSchemaVersion,
          }
        : {
            ok: true,
            operation: 'read',
            checkpoint: null,
            cleanupRequired: true,
          }
    },
    async replace(identityKey, checkpoint) {
      assert.equal(checkpoint.identityKey, identityKey)
      record = structuredClone(checkpoint)
      replacements.push(structuredClone(checkpoint))
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      deletions.push(identityKey)
      if (record?.identityKey === identityKey) {
        record = null
      }
      return { ok: true, operation: 'delete' }
    },
    close() {},
  }
}

function RecoveryHookHarness({ options, capture }) {
  capture(useSoloRoundRecovery(options))
  return null
}

async function flushRecovery() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function mountRecoveryHook({
  store = createMemoryRecoveryStore(),
  getBackendSession = async () => {
    throw new Error('No checkpoint should request a backend session')
  },
  ...optionOverrides
} = {}) {
  let current
  let root
  let options = {
    loadingAuth: false,
    isAuthenticated: true,
    currentUser: { userId: SOLO_RECOVERY_TEST_USER_ID },
    recoveryStore: store,
    getBackendSession,
    endBackendSession: async (sessionId) => runningSession(sessionId),
    getEpochTimeMs: () => SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
    hydrateRound: () => {},
    hydratePlayer: () => ({ kind: 'SETTLED' }),
    hydrateGameplay: () => null,
    resetRuntime: () => {},
    adoptBackendSession: () => {},
    getRuntimeSnapshot: () => ({
      playerPosition: { lat: 28.5505, lon: 77.2688 },
      simulationSpeedMetersPerSecond: 80,
      movement: null,
    }),
    ...optionOverrides,
  }

  await act(async () => {
    root = create(React.createElement(RecoveryHookHarness, {
      options,
      capture: (value) => {
        current = value
      },
    }))
  })
  await flushRecovery()

  return {
    get current() {
      return current
    },
    store,
    async updateOptions(overrides) {
      options = {
        ...options,
        ...overrides,
      }
      await act(async () => {
        root.update(React.createElement(RecoveryHookHarness, {
          options,
          capture: (value) => {
            current = value
          },
        }))
      })
      await flushRecovery()
    },
    async updateIdentity(userId) {
      options = {
        ...options,
        currentUser: { userId },
      }
      await act(async () => {
        root.update(React.createElement(RecoveryHookHarness, {
          options,
          capture: (value) => {
            current = value
          },
        }))
      })
      await flushRecovery()
    },
    async unmount() {
      await act(async () => root.unmount())
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    },
  }
}

async function withBrowserWindow(callback) {
  const originalWindow = globalThis.window
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  }
  try {
    await callback()
  } finally {
    globalThis.window = originalWindow
  }
}

test('frontend TravelMode domain accepts only exact public values', () => {
  assert.equal(DEFAULT_TRAVEL_MODE, TRAVEL_MODES.CAR)
  assert.deepEqual(Object.values(TRAVEL_MODES), [
    'CAR',
    'MOTORCYCLE',
    'WALKING',
  ])
  assert.equal(Object.isFrozen(TRAVEL_MODES), true)

  for (const travelMode of Object.values(TRAVEL_MODES)) {
    assert.equal(isTravelMode(travelMode), true)
    assert.equal(requireTravelMode(travelMode), travelMode)
  }
  for (const rejected of [
    'car',
    'motorcycle',
    'walking',
    'BICYCLE',
    'UNKNOWN',
    null,
    undefined,
    true,
    false,
    1,
    {},
    [],
  ]) {
    assert.equal(isTravelMode(rejected), false)
    assert.throws(() => requireTravelMode(rejected), TypeError)
  }
})

for (const travelMode of Object.values(TRAVEL_MODES)) {
  test(`fresh SOLO round synchronously captures selected ${travelMode}`, async () => {
    await withBrowserWindow(async () => {
      const hook = await mountRecoveryHook()
      try {
        assert.equal(hook.current.isReady, true)
        assert.equal(hook.current.activeTravelMode, null)
        assert.equal(hook.current.isTravelModeSelectionLocked, false)
        await act(async () => {
          assert.equal(hook.current.setSelectedTravelMode(travelMode), true)
        })

        let operation
        await act(async () => {
          operation = hook.current.beginRoundOperation()
        })
        assert.equal(operation.travelMode, travelMode)
        assert.equal(hook.current.activeTravelMode, travelMode)
        assert.equal(hook.current.isTravelModeSelectionLocked, true)
        await act(async () => {
          assert.equal(
            hook.current.setSelectedTravelMode(DEFAULT_TRAVEL_MODE),
            false,
          )
        })

        let established
        await act(async () => {
          established = await hook.current.establishRound(
            runningSession(),
            operation,
          )
          hook.current.completeRoundOperation(operation)
        })
        assert.equal(established.checkpoint.round.travelMode, travelMode)
        assert.equal(hook.store.record.round.travelMode, travelMode)
        assert.equal(hook.current.isTravelModeSelectionLocked, true)
      } finally {
        await hook.unmount()
      }
    })
  })
}

test('active mode is immutable, reset enables the next selection, and stale finish is ABA-safe', async () => {
  await withBrowserWindow(async () => {
    const hook = await mountRecoveryHook()
    try {
      let operationA
      let establishedA
      await act(async () => {
        operationA = hook.current.beginRoundOperation()
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.CAR)
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.WALKING),
          false,
        )
        establishedA = await hook.current.establishRound(
          runningSession(SESSION_IDS[0]),
          operationA,
        )
        hook.current.completeRoundOperation(operationA)
      })
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.CAR)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.CAR)

      await act(async () => {
        await hook.current.resetRound()
      })
      assert.equal(hook.current.activeTravelMode, null)
      assert.equal(hook.current.isTravelModeSelectionLocked, false)
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.WALKING),
          true,
        )
      })

      let operationB
      await act(async () => {
        operationB = hook.current.beginRoundOperation()
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      await act(async () => {
        await hook.current.establishRound(
          runningSession(SESSION_IDS[1]),
          operationB,
        )
        hook.current.completeRoundOperation(operationB)
      })

      let staleFinish
      await act(async () => {
        staleFinish = await hook.current.finishRound({
          backendEnded: true,
          expectedScope: establishedA.scope,
        })
      })
      assert.equal(staleFinish.stale, true)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.store.record.round.travelMode, TRAVEL_MODES.WALKING)
    } finally {
      await hook.unmount()
    }
  })
})

test('identity A -> B -> A restores only A checkpoint mode and rejects stale B work', async () => {
  await withBrowserWindow(async () => {
    const hook = await mountRecoveryHook()
    try {
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.MOTORCYCLE),
          true,
        )
      })
      let operationA
      await act(async () => {
        operationA = hook.current.beginRoundOperation()
        await hook.current.establishRound(
          runningSession(SESSION_IDS[0]),
          operationA,
        )
        hook.current.completeRoundOperation(operationA)
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)

      const userB = '22222222-2222-4222-8222-222222222222'
      await hook.updateIdentity(userB)
      assert.equal(hook.current.identityKey, `user:${userB}`)
      assert.equal(hook.current.activeTravelMode, null)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.CAR)

      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.WALKING),
          true,
        )
      })
      let operationB
      await act(async () => {
        operationB = hook.current.beginRoundOperation()
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)

      await hook.updateIdentity(SOLO_RECOVERY_TEST_USER_ID)
      assert.equal(hook.current.identityKey, IDENTITY_KEY)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(
        hook.current.selectedTravelMode,
        TRAVEL_MODES.MOTORCYCLE,
      )
      await act(async () => {
        hook.current.completeRoundOperation(operationB)
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)
    } finally {
      await hook.unmount()
    }
  })
})

for (const travelMode of Object.values(TRAVEL_MODES)) {
  test(`v2 recovery restores active and selected ${travelMode}`, async () => {
    await withBrowserWindow(async () => {
      const checkpoint = createValidSoloCheckpoint({ travelMode })
      const store = createMemoryRecoveryStore(checkpoint)
      const hook = await mountRecoveryHook({
        store,
        getBackendSession: async () => runningSession(
          checkpoint.round.backendSessionId,
        ),
      })
      try {
        assert.equal(hook.current.isReady, true)
        assert.equal(hook.current.activeTravelMode, travelMode)
        assert.equal(hook.current.selectedTravelMode, travelMode)
        assert.equal(hook.current.isTravelModeSelectionLocked, true)
        assert.equal(
          hook.current.captureRuntimeOperation().travelMode,
          travelMode,
        )
        assert.equal(store.record.schemaVersion, 2)
        assert.equal(store.record.round.travelMode, travelMode)
        await act(async () => {
          assert.equal(
            hook.current.setSelectedTravelMode(TRAVEL_MODES.CAR),
            false,
          )
        })
        assert.equal(hook.current.activeTravelMode, travelMode)
      } finally {
        await hook.unmount()
      }
    })
  })
}

test('recovered STARTING ownership remains selection-locked', async () => {
  await withBrowserWindow(async () => {
    const checkpoint = createValidSoloCheckpoint({
      phase: SOLO_RECOVERY_ROUND_PHASES.STARTING,
      travelMode: TRAVEL_MODES.WALKING,
    })
    const hook = await mountRecoveryHook({
      store: createMemoryRecoveryStore(checkpoint),
      getBackendSession: async () => {
        throw new Error('Backend start status is temporarily unavailable')
      },
    })
    try {
      assert.equal(hook.current.isReady, true)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.isTravelModeSelectionLocked, true)
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.MOTORCYCLE),
          false,
        )
      })
      assert.equal(hook.store.record.round.phase,
        SOLO_RECOVERY_ROUND_PHASES.STARTING)
      assert.equal(hook.store.record.round.travelMode, TRAVEL_MODES.WALKING)
    } finally {
      await hook.unmount()
    }
  })
})

test('clean finish unlocks setup and restart captures the next selected mode', async () => {
  await withBrowserWindow(async () => {
    const hook = await mountRecoveryHook()
    try {
      let operation
      let established
      await act(async () => {
        operation = hook.current.beginRoundOperation()
        established = await hook.current.establishRound(
          runningSession(),
          operation,
        )
        hook.current.completeRoundOperation(operation)
      })
      assert.equal(hook.current.isTravelModeSelectionLocked, true)

      await act(async () => {
        await hook.current.finishRound({
          backendEnded: true,
          expectedScope: established.scope,
        })
      })
      assert.equal(hook.current.activeTravelMode, null)
      assert.equal(hook.current.isTravelModeSelectionLocked, false)
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.WALKING),
          true,
        )
      })

      let restart
      await act(async () => {
        restart = hook.current.beginRestartOperation()
        await restart.cleanup
      })
      assert.equal(restart.scope.travelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.isTravelModeSelectionLocked, true)
    } finally {
      await hook.unmount()
    }
  })
})

test('backend close failure retains CAR reconciliation truth but unlocks next-round selection', async () => {
  await withBrowserWindow(async () => {
    const hook = await mountRecoveryHook()
    try {
      let operation
      let established
      await act(async () => {
        operation = hook.current.beginRoundOperation()
        established = await hook.current.establishRound(
          runningSession(),
          operation,
        )
        hook.current.completeRoundOperation(operation)
      })

      await act(async () => {
        await hook.current.finishRound({
          backendEnded: false,
          expectedScope: established.scope,
        })
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.CAR)
      assert.equal(hook.current.isTravelModeSelectionLocked, false)
      assert.equal(hook.store.record.round.phase,
        SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
      assert.equal(hook.store.record.round.travelMode, TRAVEL_MODES.CAR)

      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.WALKING),
          true,
        )
      })
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.CAR)
      assert.equal(hook.store.record.round.travelMode, TRAVEL_MODES.CAR)
    } finally {
      await hook.unmount()
    }
  })
})

test('pending reconciliation preserves WALKING while the next round captures MOTORCYCLE and rejects a late old ACK', async () => {
  await withBrowserWindow(async () => {
    const catchResponse = deferred()
    const hook = await mountRecoveryHook({
      submitBackendCatchForSession: async () => catchResponse.promise,
    })
    try {
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.WALKING),
          true,
        )
      })
      let operationA
      let establishedA
      await act(async () => {
        operationA = hook.current.beginRoundOperation()
        establishedA = await hook.current.establishRound(
          runningSession(SESSION_IDS[0]),
          operationA,
        )
        hook.current.completeRoundOperation(operationA)
      })

      const target = targetFixture()
      let caught
      await act(async () => {
        assert.equal(
          hook.current.queueRuntimeCheckpoint({ targets: [target] }),
          true,
        )
        caught = hook.current.applyTargetCatch({
          targetId: target.id,
          caughtAtEpochMs: SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
        })
        await caught.durability
      })
      assert.equal(caught.applied, true)
      let oldSubmission
      await act(async () => {
        oldSubmission = hook.current.submitPendingCatch(caught)
        await Promise.resolve()
      })

      await act(async () => {
        await hook.current.finishRound({
          backendEnded: true,
          expectedScope: establishedA.scope,
        })
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.isTravelModeSelectionLocked, false)
      assert.equal(
        hook.current.captureActiveRoundScope().travelMode,
        TRAVEL_MODES.WALKING,
      )
      assert.equal(hook.store.record.round.phase,
        SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
      assert.equal(
        hook.store.record.round.travelMode,
        TRAVEL_MODES.WALKING,
      )

      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.MOTORCYCLE),
          true,
        )
      })
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(
        hook.store.record.round.travelMode,
        TRAVEL_MODES.WALKING,
      )

      let restart
      await act(async () => {
        restart = hook.current.beginRestartOperation()
        await restart.cleanup
      })
      assert.equal(restart.scope.travelMode, TRAVEL_MODES.MOTORCYCLE)

      let establishedB
      await act(async () => {
        establishedB = await hook.current.establishRound(
          runningSession(SESSION_IDS[1]),
          restart.scope,
        )
        hook.current.completeRoundOperation(restart.scope)
      })
      assert.equal(establishedB.checkpoint.round.travelMode,
        TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)

      catchResponse.resolve(successfulCatchResponse(
        SESSION_IDS[0],
        caught.pendingCatch.catchId,
      ))
      await act(async () => {
        await oldSubmission
        await Promise.resolve()
      })
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.isTravelModeSelectionLocked, true)
      assert.equal(
        hook.store.record.round.travelMode,
        TRAVEL_MODES.MOTORCYCLE,
      )
    } finally {
      catchResponse.resolve(null)
      await hook.unmount()
    }
  })
})

test('recovered RECONCILING keeps old WALKING truth while selection and ACK completion prepare MOTORCYCLE', async () => {
  await withBrowserWindow(async () => {
    const checkpoint = checkpointWithPendingCatch()
    const store = createMemoryRecoveryStore(checkpoint)
    const catchResponse = deferred()
    let submittedCatchId = null
    const hook = await mountRecoveryHook({
      store,
      getBackendSession: async () => endedSession(
        checkpoint.round.backendSessionId,
      ),
      submitBackendCatchForSession: async (_sessionId, catchId) => {
        submittedCatchId = catchId
        return catchResponse.promise
      },
      getEpochTimeMs: () => checkpoint.round.endsAtEpochMs + 2_000,
    })
    try {
      assert.equal(hook.current.isReady, true)
      assert.equal(submittedCatchId,
        checkpoint.backendSync.pendingCatches[0].catchId)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.isTravelModeSelectionLocked, false)
      assert.equal(hook.current.captureRuntimeOperation().travelMode, undefined)

      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.MOTORCYCLE),
          true,
        )
      })
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(store.record.round.travelMode, TRAVEL_MODES.WALKING)

      catchResponse.resolve(successfulCatchResponse(
        checkpoint.round.backendSessionId,
        checkpoint.backendSync.pendingCatches[0].catchId,
      ))
      await flushRecovery()
      assert.equal(store.record.backendSync.pendingCatches.length, 0)
      assert.equal(store.record.round.phase,
        SOLO_RECOVERY_ROUND_PHASES.RECONCILING)
      assert.equal(store.record.round.travelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.isTravelModeSelectionLocked, false)

      let restart
      await act(async () => {
        restart = hook.current.beginRestartOperation()
        await restart.cleanup
      })
      assert.equal(restart.scope.travelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.isTravelModeSelectionLocked, true)
    } finally {
      catchResponse.resolve(null)
      await hook.unmount()
    }
  })
})

test('v1 recovery hydrates CAR in memory and the next scoped write persists v2', async () => {
  await withBrowserWindow(async () => {
    const v1 = createValidSoloV1Checkpoint()
    const store = createMemoryRecoveryStore(v1)
    const hook = await mountRecoveryHook({
      store,
      getBackendSession: async () => runningSession(
        v1.round.backendSessionId,
      ),
    })
    try {
      assert.equal(hook.current.isReady, true)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.CAR)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.CAR)
      assert.equal(
        hook.current.captureRuntimeOperation().travelMode,
        TRAVEL_MODES.CAR,
      )
      assert.ok(store.replacements.length > 0)
      assert.equal(store.record.schemaVersion, 2)
      assert.equal(store.record.round.travelMode, TRAVEL_MODES.CAR)
    } finally {
      await hook.unmount()
    }
  })
})

test('failed gameplay hydration rolls back provisional mode before a fresh launch', async () => {
  await withBrowserWindow(async () => {
    const checkpoint = createValidSoloCheckpoint({
      travelMode: TRAVEL_MODES.WALKING,
    })
    const store = createMemoryRecoveryStore(checkpoint)
    const hook = await mountRecoveryHook({
      store,
      getBackendSession: async () => runningSession(
        checkpoint.round.backendSessionId,
      ),
      hydrateGameplay: async () => {
        throw new Error('Deliberate gameplay hydration failure')
      },
    })
    try {
      assert.equal(hook.current.isReady, true)
      assert.notEqual(hook.current.warning, '')
      assert.equal(hook.current.activeTravelMode, null)
      assert.equal(hook.current.captureActiveRoundScope(), null)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.CAR)

      let selectionAccepted
      await act(async () => {
        selectionAccepted = hook.current.setSelectedTravelMode(
          TRAVEL_MODES.CAR,
        )
      })
      assert.equal(selectionAccepted, true)

      let operation
      await act(async () => {
        operation = hook.current.beginRoundOperation()
      })
      assert.ok(operation)
      assert.equal(operation.travelMode, TRAVEL_MODES.CAR)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.CAR)
      assert.ok(store.replacements.length > 0)
      assert.ok(
        store.replacements.every(
          (replacement) =>
            replacement.round.travelMode === TRAVEL_MODES.WALKING,
        ),
      )
      assert.equal(store.record.round.travelMode, TRAVEL_MODES.WALKING)
    } finally {
      await hook.unmount()
    }
  })
})

test('same-identity failed re-bootstrap restores the adopted round mode', async () => {
  await withBrowserWindow(async () => {
    let resolveFirstPlayerHydration
    const firstPlayerHydration = new Promise((resolve) => {
      resolveFirstPlayerHydration = resolve
    })
    let gameplayHydrations = 0
    let playerHydrations = 0
    const checkpoint = createValidSoloCheckpoint({
      travelMode: TRAVEL_MODES.WALKING,
    })
    const hook = await mountRecoveryHook({
      store: createMemoryRecoveryStore(checkpoint),
      getBackendSession: async () => runningSession(
        checkpoint.round.backendSessionId,
      ),
      hydrateGameplay: async () => {
        gameplayHydrations += 1
        if (gameplayHydrations === 2) {
          throw new Error('Current re-bootstrap hydration failure')
        }
        return null
      },
      hydratePlayer: async () => {
        playerHydrations += 1
        if (playerHydrations === 1) {
          return firstPlayerHydration
        }
        return { kind: 'SETTLED' }
      },
    })
    try {
      const adoptedScope = hook.current.captureActiveRoundScope()
      assert.equal(gameplayHydrations, 1)
      assert.equal(playerHydrations, 1)
      assert.equal(hook.current.isReady, false)
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(adoptedScope.travelMode, TRAVEL_MODES.WALKING)

      await hook.updateOptions({
        currentUser: {
          userId: SOLO_RECOVERY_TEST_USER_ID,
          refreshVersion: 2,
        },
      })

      assert.equal(gameplayHydrations, 2)
      assert.equal(playerHydrations, 1)
      assert.equal(hook.current.isReady, true)
      assert.notEqual(hook.current.warning, '')
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.WALKING)
      assert.deepEqual(hook.current.captureActiveRoundScope(), adoptedScope)
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.CAR),
          false,
        )
      })

      await act(async () => {
        resolveFirstPlayerHydration({ kind: 'SETTLED' })
        await Promise.resolve()
      })
      await flushRecovery()
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.deepEqual(hook.current.captureActiveRoundScope(), adoptedScope)
    } finally {
      resolveFirstPlayerHydration?.({ kind: 'SETTLED' })
      await hook.unmount()
    }
  })
})

test('post-adoption player hydration failure retains recovered round mode', async () => {
  await withBrowserWindow(async () => {
    const checkpoint = createValidSoloCheckpoint({
      travelMode: TRAVEL_MODES.WALKING,
    })
    const hook = await mountRecoveryHook({
      store: createMemoryRecoveryStore(checkpoint),
      getBackendSession: async () => runningSession(
        checkpoint.round.backendSessionId,
      ),
      hydratePlayer: async () => {
        throw new Error('Deliberate player hydration failure')
      },
    })
    try {
      assert.equal(hook.current.isReady, true)
      assert.notEqual(hook.current.warning, '')
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.WALKING)
      assert.equal(
        hook.current.captureActiveRoundScope().travelMode,
        TRAVEL_MODES.WALKING,
      )
    } finally {
      await hook.unmount()
    }
  })
})

test('late stale hydration failure cannot roll back a newer round mode', async () => {
  await withBrowserWindow(async () => {
    let rejectOldHydration
    const oldHydration = new Promise((_, reject) => {
      rejectOldHydration = reject
    })
    const checkpoint = createValidSoloCheckpoint({
      travelMode: TRAVEL_MODES.WALKING,
    })
    const hook = await mountRecoveryHook({
      store: createMemoryRecoveryStore(checkpoint),
      getBackendSession: async () => runningSession(
        checkpoint.round.backendSessionId,
      ),
      hydrateGameplay: () => oldHydration,
    })
    try {
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.WALKING)

      const userB = '22222222-2222-4222-8222-222222222222'
      await hook.updateIdentity(userB)
      await act(async () => {
        assert.equal(
          hook.current.setSelectedTravelMode(TRAVEL_MODES.MOTORCYCLE),
          true,
        )
      })

      let operationB
      await act(async () => {
        operationB = hook.current.beginRoundOperation()
        await hook.current.establishRound(
          runningSession(SESSION_IDS[1], userB),
          operationB,
        )
        hook.current.completeRoundOperation(operationB)
      })
      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)

      await act(async () => {
        rejectOldHydration(new Error('Late stale hydration failure'))
        await Promise.resolve()
      })
      await flushRecovery()

      assert.equal(hook.current.activeTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(hook.current.selectedTravelMode, TRAVEL_MODES.MOTORCYCLE)
      assert.equal(
        hook.current.captureActiveRoundScope().travelMode,
        TRAVEL_MODES.MOTORCYCLE,
      )
    } finally {
      await hook.unmount()
    }
  })
})
