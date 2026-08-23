import assert from 'node:assert/strict'
import test from 'node:test'
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react'
import { act, create } from 'react-test-renderer'
import { TRAVEL_MODES } from '../src/config/travelMode.js'
import { useSoloRoundRecovery } from '../src/hooks/useSoloRoundRecovery.js'
import {
  createSoloTarget,
  useTargetSpawner,
} from '../src/hooks/useTargetSpawner.js'
import { parseSoloRecoveryCheckpoint } from '../src/recovery/soloRecoveryCheckpoint.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PLAYER = Object.freeze({ lat: 28.5505, lon: 77.2688 })
const SNAPPED = Object.freeze({ lat: 28.551, lon: 77.271 })
const USER = Object.freeze({ userId: SOLO_RECOVERY_TEST_USER_ID })
const SESSION_A = '44444444-4444-4444-8444-444444444444'
const SESSION_B = '55555555-5555-4555-8555-555555555555'

function runningSession(sessionId = SESSION_A) {
  return {
    sessionId,
    status: 'RUNNING',
    durationSeconds: 60,
    startedAt: new Date(SOLO_RECOVERY_TEST_STARTED_AT).toISOString(),
    endedAt: null,
    score: 0,
    caughtCount: 0,
    userId: SOLO_RECOVERY_TEST_USER_ID,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createMemoryRecoveryStore(initialCheckpoint = null) {
  let record = initialCheckpoint
    ? structuredClone(initialCheckpoint)
    : null

  return {
    get record() {
      return record ? structuredClone(record) : null
    },
    async read(identityKey) {
      if (record?.identityKey !== identityKey) {
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
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      if (record?.identityKey === identityKey) {
        record = null
      }
      return { ok: true, operation: 'delete' }
    },
    close() {},
  }
}

function createManualWindow() {
  let nextId = 1
  const timers = new Map()
  return {
    window: {
      setTimeout(callback, delayMs) {
        const id = nextId
        nextId += 1
        timers.set(id, { callback, delayMs })
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
      },
      addEventListener() {},
      removeEventListener() {},
    },
    get size() {
      return timers.size
    },
    fireEarliest() {
      const entry = [...timers.entries()].sort(
        ([leftId], [rightId]) => leftId - rightId,
      )[0]
      assert.ok(entry, 'Expected a scheduled lifecycle timer')
      const [id, timer] = entry
      timers.delete(id)
      timer.callback()
    },
  }
}

function usableRoute(source, destination) {
  return {
    coordinates: [
      [source.lat, source.lon],
      [destination.lat, destination.lon],
    ],
    distanceMeters: 1400,
    durationSeconds: 240,
  }
}

function createRoutingSpawnAdapter(calls, overrides = {}) {
  return (
    playerPosition,
    speed,
    level,
    getEpochTimeMs,
    operationOptions,
  ) => createSoloTarget(
    playerPosition,
    speed,
    level,
    getEpochTimeMs,
    {
      ...operationOptions,
      nearestRoadPoint: async (rawPoint, options) => {
        calls.push({ stage: 'nearest', mode: options.travelMode, rawPoint })
        return overrides.nearestRoadPoint
          ? overrides.nearestRoadPoint(rawPoint, options)
          : SNAPPED
      },
      routeBetween: async (source, destination, options) => {
        calls.push({
          stage: 'route',
          mode: options.travelMode,
          source,
          destination,
        })
        return overrides.routeBetween
          ? overrides.routeBetween(source, destination, options)
          : usableRoute(source, destination)
      },
    },
  )
}

function SoloSpawnLifecycleHarness({ options, capture }) {
  const spawnerRef = useRef(null)
  const runtimeSnapshotRef = useRef({
    playerPosition: PLAYER,
    simulationSpeedMetersPerSecond: 80,
    movement: null,
    targets: [],
    caughtTargets: [],
    score: 0,
    xp: 0,
    spawning: { paused: false, nextSpawnAtEpochMs: null },
  })
  const hydrateGameplay = useCallback((checkpoint) => {
    spawnerRef.current?.hydrateTargetState({
      targets: checkpoint.targets,
      spawning: checkpoint.spawning,
    })
  }, [])
  const resetRuntime = useCallback(() => {
    spawnerRef.current?.clearTargets()
  }, [])
  const getRuntimeSnapshot = useCallback(
    () => runtimeSnapshotRef.current,
    [],
  )
  const recovery = useSoloRoundRecovery({
    ...options.recovery,
    hydrateGameplay,
    resetRuntime,
    getRuntimeSnapshot,
  })
  const {
    applyTargetsExpired,
    queueRuntimeCheckpoint,
  } = recovery
  const handleTargetTransition = useCallback((transition) => {
    queueRuntimeCheckpoint({
      targets: transition.targets,
      spawning: transition.spawning,
    })
  }, [queueRuntimeCheckpoint])
  const handleTargetExpired = useCallback((expiredTargets, snapshot) => {
    applyTargetsExpired({
      targetIds: expiredTargets.map((target) => target.id),
      expiredAtEpochMs: snapshot.expiredAtEpochMs,
      settledPosition: PLAYER,
      targets: snapshot.targets,
      spawning: snapshot.spawning,
    })
  }, [applyTargetsExpired])
  const spawner = useTargetSpawner(
    PLAYER,
    80,
    options.gameRunning && recovery.isReady,
    1,
    handleTargetExpired,
    {
      getEpochTimeMs: options.getEpochTimeMs,
      onTargetTransition: handleTargetTransition,
      spawnTarget: options.spawnTarget,
      captureSpawnOperation: recovery.captureRuntimeOperation,
    },
  )

  useLayoutEffect(() => {
    spawnerRef.current = spawner
    runtimeSnapshotRef.current = {
      ...runtimeSnapshotRef.current,
      targets: structuredClone(spawner.targets),
      spawning: {
        paused: spawner.isSpawningPaused,
        nextSpawnAtEpochMs: spawner.nextSpawnAtEpochMs,
      },
    }
  }, [spawner])

  const applyLiveCatch = (targetId) => {
    const caughtAtEpochMs = options.getEpochTimeMs()
    const transition = recovery.applyTargetCatchBatch({
      catches: [{ targetId, caughtAtEpochMs }],
      checkpointAtEpochMs: caughtAtEpochMs,
      settledPosition: PLAYER,
    })
    if (transition.applied) {
      spawner.replaceTargets(transition.checkpoint.targets)
    }
    return transition
  }

  capture({
    recovery,
    spawner,
    applyLiveCatch,
    async resetRoundRuntime() {
      spawner.clearTargets()
      return recovery.resetRound()
    },
  })
  return null
}

async function flushLifecycle(count = 12) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function fireNextTimer(runtime, microtasks = 20) {
  await act(async () => {
    runtime.fireEarliest()
    for (let index = 0; index < microtasks; index += 1) {
      await Promise.resolve()
    }
  })
  await flushLifecycle(2)
}

async function mountLifecycle({
  gameRunning = false,
  getEpochTimeMs,
  getBackendSession = async () => {
    throw new Error('An empty recovery store must not load a backend session')
  },
  spawnTarget,
  store = createMemoryRecoveryStore(),
}) {
  let current
  let root
  let options = {
    gameRunning,
    getEpochTimeMs,
    spawnTarget,
    recovery: {
      loadingAuth: false,
      isAuthenticated: true,
      currentUser: USER,
      recoveryStore: store,
      getBackendSession,
      endBackendSession: async (sessionId) => runningSession(sessionId),
      getEpochTimeMs,
      hydrateRound: () => {},
      hydratePlayer: () => ({ kind: 'SETTLED' }),
      adoptBackendSession: () => {},
    },
  }
  const modeSnapshots = []
  const render = () => React.createElement(SoloSpawnLifecycleHarness, {
    options,
    capture: (value) => {
      current = value
      modeSnapshots.push({
        selected: value.recovery.selectedTravelMode,
        active: value.recovery.activeTravelMode,
      })
    },
  })

  await act(async () => {
    root = create(render())
  })
  await flushLifecycle()

  return {
    get current() {
      return current
    },
    modeSnapshots,
    store,
    async update(overrides) {
      options = { ...options, ...overrides }
      await act(async () => root.update(render()))
      await flushLifecycle(2)
    },
    async unmount() {
      await act(async () => root.unmount())
    },
  }
}

async function establishRound(hook, travelMode, sessionId = SESSION_A) {
  let accepted
  let operation
  let established
  await act(async () => {
    accepted = hook.current.recovery.setSelectedTravelMode(travelMode)
    operation = hook.current.recovery.beginRoundOperation()
    established = await hook.current.recovery.establishRound(
      runningSession(sessionId),
      operation,
    )
    hook.current.recovery.completeRoundOperation(operation)
  })
  await flushLifecycle(2)
  assert.equal(accepted, true)
  assert.equal(established.stale, false)
  return { operation, established }
}

test('real launch capture rejects a setup change and spawns with active CAR', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  const now = { value: SOLO_RECOVERY_TEST_STARTED_AT + 10_000 }
  const calls = []
  const hook = await mountLifecycle({
    getEpochTimeMs: () => now.value,
    spawnTarget: createRoutingSpawnAdapter(calls),
  })

  try {
    let selectionAccepted
    let operation
    let rejected
    let established
    await act(async () => {
      selectionAccepted = hook.current.recovery.setSelectedTravelMode(
        TRAVEL_MODES.CAR,
      )
      operation = hook.current.recovery.beginRoundOperation()
      rejected = hook.current.recovery.setSelectedTravelMode(
        TRAVEL_MODES.WALKING,
      )
      established = await hook.current.recovery.establishRound(
        runningSession(),
        operation,
      )
      hook.current.recovery.completeRoundOperation(operation)
    })
    assert.equal(selectionAccepted, true)
    assert.equal(operation.travelMode, TRAVEL_MODES.CAR)
    assert.equal(rejected, false)
    assert.equal(established.checkpoint.round.travelMode, TRAVEL_MODES.CAR)
    assert.equal(
      hook.current.recovery.captureRuntimeOperation().travelMode,
      TRAVEL_MODES.CAR,
    )

    await hook.update({ gameRunning: true })
    now.value += 5_000
    await fireNextTimer(runtime)

    assert.equal(hook.current.spawner.targets.length, 1)
    assert.deepEqual(calls.map(({ stage, mode }) => [stage, mode]), [
      ['nearest', TRAVEL_MODES.CAR],
      ['route', TRAVEL_MODES.CAR],
    ])
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('recovered v2 WALKING owns real spawn, catch transition, and next cadence', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  const now = { value: SOLO_RECOVERY_TEST_STARTED_AT + 10_000 }
  const checkpoint = createValidSoloCheckpoint({
    travelMode: TRAVEL_MODES.WALKING,
  })
  checkpoint.spawning.nextSpawnAtEpochMs = now.value + 5_000
  const calls = []
  const hook = await mountLifecycle({
    gameRunning: true,
    getEpochTimeMs: () => now.value,
    getBackendSession: async () => runningSession(
      checkpoint.round.backendSessionId,
    ),
    spawnTarget: createRoutingSpawnAdapter(calls),
    store: createMemoryRecoveryStore(checkpoint),
  })

  try {
    assert.ok(hook.modeSnapshots.some(({ selected, active }) => (
      selected === TRAVEL_MODES.CAR && active === null
    )))
    assert.equal(
      hook.current.recovery.captureRuntimeOperation().travelMode,
      TRAVEL_MODES.WALKING,
    )

    now.value += 5_000
    await fireNextTimer(runtime)
    assert.equal(hook.current.spawner.targets.length, 1)
    assert.deepEqual(calls.map(({ stage, mode }) => [stage, mode]), [
      ['nearest', TRAVEL_MODES.WALKING],
      ['route', TRAVEL_MODES.WALKING],
    ])

    let catchTransition
    await act(async () => {
      catchTransition = hook.current.applyLiveCatch(
        hook.current.spawner.targets[0].id,
      )
      await Promise.resolve()
    })
    assert.equal(catchTransition.applied, true)
    assert.deepEqual(hook.current.spawner.targets, [])
    assert.equal(catchTransition.checkpoint.round.travelMode, TRAVEL_MODES.WALKING)

    now.value += 5_000
    await fireNextTimer(runtime)
    assert.equal(hook.current.spawner.targets.length, 1)
    assert.deepEqual(calls.map(({ stage, mode }) => [stage, mode]), [
      ['nearest', TRAVEL_MODES.WALKING],
      ['route', TRAVEL_MODES.WALKING],
      ['nearest', TRAVEL_MODES.WALKING],
      ['route', TRAVEL_MODES.WALKING],
    ])
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('three incompatible route attempts publish nothing and next cadence succeeds', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  const originalWarn = console.warn
  globalThis.window = runtime.window
  console.warn = () => {}
  const now = { value: SOLO_RECOVERY_TEST_STARTED_AT + 10_000 }
  const calls = []
  let routeAttempts = 0
  const spawnTarget = createRoutingSpawnAdapter(calls, {
    routeBetween: async (source, destination) => {
      routeAttempts += 1
      return routeAttempts <= 3
        ? usableRoute(source, {
            lat: destination.lat + 0.01,
            lon: destination.lon,
          })
        : usableRoute(source, destination)
    },
  })
  const hook = await mountLifecycle({
    getEpochTimeMs: () => now.value,
    spawnTarget,
  })

  try {
    await establishRound(hook, TRAVEL_MODES.CAR)
    await hook.update({ gameRunning: true })
    now.value += 5_000
    await fireNextTimer(runtime, 40)

    assert.equal(routeAttempts, 3)
    assert.deepEqual(hook.current.spawner.targets, [])
    assert.ok(runtime.size > 0)

    now.value += 5_000
    await fireNextTimer(runtime, 20)
    assert.equal(routeAttempts, 4)
    assert.equal(hook.current.spawner.targets.length, 1)
    assert.ok(calls.every(({ mode }) => mode === TRAVEL_MODES.CAR))
  } finally {
    console.warn = originalWarn
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('stale WALKING route cannot publish into replacement MOTORCYCLE round', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  const now = { value: SOLO_RECOVERY_TEST_STARTED_AT + 10_000 }
  const calls = []
  const staleRoute = deferred()
  let staleSource
  let staleDestination
  const spawnTarget = createRoutingSpawnAdapter(calls, {
    routeBetween: (source, destination, options) => {
      if (options.travelMode === TRAVEL_MODES.WALKING) {
        staleSource = source
        staleDestination = destination
        return staleRoute.promise
      }
      return usableRoute(source, destination)
    },
  })
  const hook = await mountLifecycle({
    getEpochTimeMs: () => now.value,
    spawnTarget,
  })

  try {
    await establishRound(hook, TRAVEL_MODES.WALKING, SESSION_A)
    await hook.update({ gameRunning: true })
    now.value += 5_000
    await fireNextTimer(runtime, 4)
    assert.deepEqual(calls.map(({ stage, mode }) => [stage, mode]), [
      ['nearest', TRAVEL_MODES.WALKING],
      ['route', TRAVEL_MODES.WALKING],
    ])

    await hook.update({ gameRunning: false })
    await act(async () => {
      await hook.current.resetRoundRuntime()
    })
    await establishRound(hook, TRAVEL_MODES.MOTORCYCLE, SESSION_B)
    await hook.update({ gameRunning: true })
    assert.equal(
      hook.current.recovery.captureRuntimeOperation().travelMode,
      TRAVEL_MODES.MOTORCYCLE,
    )

    staleRoute.resolve(usableRoute(staleSource, staleDestination))
    await flushLifecycle(8)
    assert.deepEqual(hook.current.spawner.targets, [])
    assert.equal(hook.store.record.round.backendSessionId, SESSION_B)
    assert.equal(hook.store.record.round.travelMode, TRAVEL_MODES.MOTORCYCLE)

    now.value += 5_000
    await fireNextTimer(runtime)
    assert.equal(hook.current.spawner.targets.length, 1)
    assert.deepEqual(calls.map(({ stage, mode }) => [stage, mode]), [
      ['nearest', TRAVEL_MODES.WALKING],
      ['route', TRAVEL_MODES.WALKING],
      ['nearest', TRAVEL_MODES.MOTORCYCLE],
      ['route', TRAVEL_MODES.MOTORCYCLE],
    ])
  } finally {
    staleRoute.resolve(usableRoute(staleSource ?? PLAYER, staleDestination ?? SNAPPED))
    await hook.unmount()
    globalThis.window = originalWindow
  }
})
