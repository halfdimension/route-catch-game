import assert from 'node:assert/strict'
import test from 'node:test'
import React, { StrictMode } from 'react'
import { act, create } from 'react-test-renderer'
import {
  getNextSoloSpawnDeadline,
  useTargetSpawner,
} from '../src/hooks/useTargetSpawner.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TARGET_ID = '66666666-6666-4666-8666-666666666666'

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
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
    },
    timers,
    fire(id) {
      const timer = timers.get(id)
      timers.delete(id)
      timer?.callback()
    },
  }
}

function SpawnerHarness({ options, capture }) {
  capture(useTargetSpawner(
    options.playerPosition,
    options.speed,
    options.canSpawn,
    options.level,
    options.onExpired,
    options.dependencies,
  ))
  return null
}

async function mountSpawner(options, { strict = false } = {}) {
  let current
  let root
  const capture = (value) => {
    current = value
  }
  const render = (nextOptions) => {
    const child = React.createElement(SpawnerHarness, {
      options: nextOptions,
      capture,
    })
    return strict ? React.createElement(StrictMode, null, child) : child
  }
  await act(async () => {
    root = create(render(options))
  })
  return {
    get current() {
      return current
    },
    async update(nextOptions) {
      await act(async () => root.update(render(nextOptions)))
    },
    async unmount() {
      await act(async () => root.unmount())
    },
  }
}

function baseOptions(overrides = {}) {
  return {
    playerPosition: { lat: 28.55, lon: 77.26 },
    speed: 80,
    canSpawn: false,
    level: 1,
    onExpired: () => {},
    dependencies: {},
    ...overrides,
  }
}

function recoveredTarget(expiresAt) {
  return {
    id: TARGET_ID,
    creatureId: 'sparkbit',
    lat: 28.55,
    lon: 77.26,
    rarity: 'common',
    score: 10,
    spawnedAt: expiresAt - 12_000,
    expiresAt,
    lifetimeMs: 12_000,
  }
}

test('spawn cadence advances from its deadline and skips missed slots', () => {
  assert.equal(getNextSoloSpawnDeadline(5_000, 5_100), 10_000)
  assert.equal(getNextSoloSpawnDeadline(5_000, 16_000), 20_000)
})

test('restored target keeps its absolute remaining expiry with one StrictMode timer', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 10_000
  const expirations = []
  const options = baseOptions({
    onExpired: (targets) => expirations.push(targets.map((target) => target.id)),
    dependencies: { getEpochTimeMs: () => nowEpochMs },
  })
  const hook = await mountSpawner(options, { strict: true })

  try {
    await act(async () => hook.current.hydrateTargetState({
      targets: [recoveredTarget(12_000)],
      spawning: { paused: true, nextSpawnAtEpochMs: null },
    }))
    assert.equal(hook.current.targets[0].id, TARGET_ID)
    assert.equal(runtime.timers.size, 1)
    const [timerId, timer] = runtime.timers.entries().next().value
    assert.equal(timer.delayMs, 2_000)

    nowEpochMs = 12_000
    await act(async () => runtime.fire(timerId))
    assert.deepEqual(hook.current.targets, [])
    assert.deepEqual(expirations, [[TARGET_ID]])
    assert.equal(runtime.timers.size, 0)
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('future spawn deadline restores and a missed deadline schedules without burst', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 10_000
  const transitions = []
  const dependencies = {
    getEpochTimeMs: () => nowEpochMs,
    onTargetTransition: (transition) => transitions.push(transition.type),
    spawnTarget: async () => recoveredTarget(nowEpochMs + 12_000),
  }
  const initial = baseOptions({ dependencies })
  const hook = await mountSpawner(initial)

  try {
    await act(async () => hook.current.hydrateTargetState({
      targets: [],
      spawning: { paused: false, nextSpawnAtEpochMs: 12_000 },
    }))
    await hook.update({ ...initial, canSpawn: true })
    assert.equal(runtime.timers.size, 1)
    assert.equal(runtime.timers.values().next().value.delayMs, 2_000)
    assert.deepEqual(transitions, [])

    await hook.update({ ...initial, canSpawn: false })
    await act(async () => hook.current.hydrateTargetState({
      targets: [],
      spawning: { paused: false, nextSpawnAtEpochMs: 9_000 },
    }))
    await hook.update({ ...initial, canSpawn: true })
    assert.equal(hook.current.nextSpawnAtEpochMs, 15_000)
    assert.equal(runtime.timers.size, 1)
    assert.deepEqual(transitions, ['SPAWN_SCHEDULED'])
    assert.equal(hook.current.targets.length, 0)
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('paused recovery has no spawn timer and resume creates one future schedule', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 20_000
  const transitions = []
  const options = baseOptions({
    dependencies: {
      getEpochTimeMs: () => nowEpochMs,
      onTargetTransition: (transition) => transitions.push(transition.type),
    },
  })
  const hook = await mountSpawner(options)

  try {
    await act(async () => hook.current.hydrateTargetState({
      targets: [],
      spawning: { paused: true, nextSpawnAtEpochMs: null },
    }))
    await hook.update({ ...options, canSpawn: true })
    assert.equal(runtime.timers.size, 0)
    await act(async () => hook.current.toggleSpawning())
    assert.equal(hook.current.isSpawningPaused, false)
    assert.equal(hook.current.nextSpawnAtEpochMs, 25_000)
    assert.equal(runtime.timers.size, 1)
    assert.deepEqual(transitions, ['SPAWNING_RESUMED'])
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('one spawn opportunity creates one target with spawnedAt and one spawn transition', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 30_000
  const transitions = []
  const spawned = {
    ...recoveredTarget(47_000),
    spawnedAt: 35_000,
  }
  const options = baseOptions({
    canSpawn: true,
    dependencies: {
      getEpochTimeMs: () => nowEpochMs,
      onTargetTransition: (transition) => transitions.push(transition.type),
      spawnTarget: async () => structuredClone(spawned),
    },
  })
  const hook = await mountSpawner(options)

  try {
    assert.equal(hook.current.nextSpawnAtEpochMs, 35_000)
    const timerId = runtime.timers.keys().next().value
    nowEpochMs = 35_000
    await act(async () => {
      runtime.fire(timerId)
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(hook.current.targets.length, 1)
    assert.equal(hook.current.targets[0].spawnedAt, 35_000)
    assert.equal(
      transitions.filter((type) => type === 'TARGET_SPAWNED').length,
      1,
    )
    assert.equal(runtime.timers.size >= 1, true)
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('delayed spawn callback preserves cadence phase without a burst', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 0
  let spawnCalls = 0
  const options = baseOptions({
    canSpawn: true,
    dependencies: {
      getEpochTimeMs: () => nowEpochMs,
      spawnTarget: async () => {
        spawnCalls += 1
        return recoveredTarget(nowEpochMs + 12_000)
      },
    },
  })
  const hook = await mountSpawner(options)

  try {
    const timerId = runtime.timers.keys().next().value
    nowEpochMs = 16_000
    await act(async () => {
      runtime.fire(timerId)
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.equal(spawnCalls, 1)
    assert.equal(hook.current.targets.length, 1)
    assert.equal(hook.current.nextSpawnAtEpochMs, 20_000)
    assert.equal(
      [...runtime.timers.values()].filter(
        (timer) => timer.delayMs === 4_000,
      ).length,
      1,
    )
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('pause and resume invalidate an old pending spawn response', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 10_000
  const pendingSpawn = deferred()
  const transitions = []
  const options = baseOptions({
    canSpawn: true,
    dependencies: {
      getEpochTimeMs: () => nowEpochMs,
      onTargetTransition: (transition) => transitions.push(transition.type),
      spawnTarget: () => pendingSpawn.promise,
    },
  })
  const hook = await mountSpawner(options)

  try {
    const timerId = runtime.timers.keys().next().value
    nowEpochMs = 15_000
    await act(async () => runtime.fire(timerId))
    await act(async () => hook.current.toggleSpawning())
    await act(async () => hook.current.toggleSpawning())
    assert.equal(hook.current.nextSpawnAtEpochMs, 20_000)

    await act(async () => {
      pendingSpawn.resolve(recoveredTarget(30_000))
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.deepEqual(hook.current.targets, [])
    assert.equal(
      transitions.filter((type) => type === 'TARGET_SPAWNED').length,
      0,
    )
    assert.equal(runtime.timers.size, 1)
  } finally {
    pendingSpawn.resolve(recoveredTarget(30_000))
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('a hanging spawn skips absolute opportunities with one request in flight', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 0
  const pendingSpawns = []
  let activeSpawns = 0
  let maximumActiveSpawns = 0
  const options = baseOptions({
    canSpawn: true,
    dependencies: {
      getEpochTimeMs: () => nowEpochMs,
      spawnTarget: () => {
        activeSpawns += 1
        maximumActiveSpawns = Math.max(maximumActiveSpawns, activeSpawns)
        const pending = deferred()
        pendingSpawns.push(pending)
        return pending.promise
      },
    },
  })
  const hook = await mountSpawner(options)

  try {
    for (const opportunity of [5_000, 10_000, 15_000]) {
      nowEpochMs = opportunity
      const timerId = runtime.timers.keys().next().value
      await act(async () => {
        runtime.fire(timerId)
        await Promise.resolve()
      })
    }

    assert.equal(pendingSpawns.length, 1)
    assert.equal(maximumActiveSpawns, 1)
    assert.equal(hook.current.nextSpawnAtEpochMs, 20_000)

    nowEpochMs = 17_000
    activeSpawns -= 1
    await act(async () => {
      pendingSpawns[0].resolve(recoveredTarget(30_000))
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(hook.current.targets.length, 1)

    nowEpochMs = 20_000
    await act(async () => {
      runtime.fire(runtime.timers.keys().next().value)
      await Promise.resolve()
    })
    assert.equal(pendingSpawns.length, 2)
    assert.equal(maximumActiveSpawns, 1)
    assert.equal(hook.current.nextSpawnAtEpochMs, 25_000)
  } finally {
    if (pendingSpawns[1]) {
      activeSpawns -= 1
      pendingSpawns[1].resolve(recoveredTarget(40_000))
    }
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('an old spawn finalizer cannot release a newer generation owner', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 0
  const pendingSpawns = []
  const options = baseOptions({
    canSpawn: true,
    dependencies: {
      getEpochTimeMs: () => nowEpochMs,
      spawnTarget: () => {
        const pending = deferred()
        pendingSpawns.push(pending)
        return pending.promise
      },
    },
  })
  const hook = await mountSpawner(options)

  try {
    nowEpochMs = 5_000
    await act(async () => {
      runtime.fire(runtime.timers.keys().next().value)
      await Promise.resolve()
    })
    assert.equal(pendingSpawns.length, 1)

    await act(async () => {
      hook.current.hydrateTargetState({
        targets: [],
        spawning: { paused: false, nextSpawnAtEpochMs: 11_000 },
      })
    })
    nowEpochMs = 11_000
    await act(async () => {
      runtime.fire(runtime.timers.keys().next().value)
      await Promise.resolve()
    })
    assert.equal(pendingSpawns.length, 2)

    await act(async () => {
      pendingSpawns[0].resolve(recoveredTarget(30_000))
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.deepEqual(hook.current.targets, [])

    nowEpochMs = 16_000
    await act(async () => {
      runtime.fire(runtime.timers.keys().next().value)
      await Promise.resolve()
    })
    assert.equal(pendingSpawns.length, 2)
    assert.equal(hook.current.nextSpawnAtEpochMs, 21_000)

    await act(async () => {
      pendingSpawns[1].resolve(recoveredTarget(35_000))
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(hook.current.targets.length, 1)

    nowEpochMs = 21_000
    await act(async () => {
      runtime.fire(runtime.timers.keys().next().value)
      await Promise.resolve()
    })
    assert.equal(pendingSpawns.length, 3)
  } finally {
    pendingSpawns.forEach((pending) => {
      pending.resolve(recoveredTarget(40_000))
    })
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

for (const lifecycle of ['reset', 'restart', 'logout', 'identity switch']) {
  test(`pending spawn is ignored after ${lifecycle}`, async () => {
    const runtime = createManualWindow()
    const originalWindow = globalThis.window
    globalThis.window = runtime.window
    let nowEpochMs = 30_000
    const pendingSpawn = deferred()
    const options = baseOptions({
      canSpawn: true,
      dependencies: {
        getEpochTimeMs: () => nowEpochMs,
        spawnTarget: () => pendingSpawn.promise,
      },
    })
    const hook = await mountSpawner(options)

    try {
      const timerId = runtime.timers.keys().next().value
      nowEpochMs = 35_000
      await act(async () => runtime.fire(timerId))

      if (lifecycle === 'reset') {
        await act(async () => hook.current.clearTargets())
      } else if (lifecycle === 'restart') {
        await act(async () => {
          hook.current.clearTargets()
          hook.current.hydrateTargetState({
            targets: [],
            spawning: {
              paused: false,
              nextSpawnAtEpochMs: 40_000,
            },
          })
        })
      } else if (lifecycle === 'logout') {
        await hook.update({ ...options, canSpawn: false })
        await hook.update(options)
      } else {
        await act(async () => hook.current.hydrateTargetState({
          targets: [],
          spawning: {
            paused: false,
            nextSpawnAtEpochMs: 40_000,
          },
        }))
      }

      await act(async () => {
        pendingSpawn.resolve(recoveredTarget(50_000))
        await Promise.resolve()
        await Promise.resolve()
      })
      assert.deepEqual(hook.current.targets, [])
    } finally {
      pendingSpawn.resolve(recoveredTarget(50_000))
      await hook.unmount()
      globalThis.window = originalWindow
    }
  })
}

test('StrictMode retains one active spawn cadence timer', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  const hook = await mountSpawner(baseOptions({
    canSpawn: true,
    dependencies: { getEpochTimeMs: () => 10_000 },
  }), { strict: true })

  try {
    assert.equal(runtime.timers.size, 1)
    assert.equal(runtime.timers.values().next().value.delayMs, 5_000)
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('caught target makes an already-captured expiry callback inert', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 10_000
  const expirations = []
  const options = baseOptions({
    onExpired: (targets) => expirations.push(targets),
    dependencies: { getEpochTimeMs: () => nowEpochMs },
  })
  const hook = await mountSpawner(options)

  try {
    await act(async () => hook.current.hydrateTargetState({
      targets: [recoveredTarget(12_000)],
      spawning: { paused: true, nextSpawnAtEpochMs: null },
    }))
    const oldExpiryCallback = runtime.timers.values().next().value.callback
    await act(async () => hook.current.replaceTargets([]))
    nowEpochMs = 12_000
    await act(async () => oldExpiryCallback())

    assert.deepEqual(hook.current.targets, [])
    assert.deepEqual(expirations, [])
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('pausing spawns does not invalidate an active target expiry', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 10_000
  const expirations = []
  const options = baseOptions({
    onExpired: (targets) => expirations.push(
      targets.map((target) => target.id),
    ),
    dependencies: { getEpochTimeMs: () => nowEpochMs },
  })
  const hook = await mountSpawner(options)

  try {
    await act(async () => hook.current.hydrateTargetState({
      targets: [recoveredTarget(12_000)],
      spawning: { paused: false, nextSpawnAtEpochMs: 15_000 },
    }))
    const expiryTimer = [...runtime.timers.entries()].find(
      ([, timer]) => timer.delayMs === 2_000,
    )
    await act(async () => hook.current.toggleSpawning())
    nowEpochMs = 12_000
    await act(async () => expiryTimer[1].callback())

    assert.deepEqual(hook.current.targets, [])
    assert.deepEqual(expirations, [[TARGET_ID]])
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})

test('old-round expiry callback cannot touch hydrated replacement targets', async () => {
  const runtime = createManualWindow()
  const originalWindow = globalThis.window
  globalThis.window = runtime.window
  let nowEpochMs = 10_000
  const expirations = []
  const options = baseOptions({
    onExpired: (targets) => expirations.push(targets),
    dependencies: { getEpochTimeMs: () => nowEpochMs },
  })
  const hook = await mountSpawner(options)
  const replacement = {
    ...recoveredTarget(30_000),
    id: '88888888-8888-4888-8888-888888888888',
  }

  try {
    await act(async () => hook.current.hydrateTargetState({
      targets: [recoveredTarget(12_000)],
      spawning: { paused: true, nextSpawnAtEpochMs: null },
    }))
    const oldExpiryCallback = runtime.timers.values().next().value.callback
    await act(async () => hook.current.hydrateTargetState({
      targets: [replacement],
      spawning: { paused: true, nextSpawnAtEpochMs: null },
    }))
    nowEpochMs = 30_000
    await act(async () => oldExpiryCallback())

    assert.deepEqual(hook.current.targets, [replacement])
    assert.deepEqual(expirations, [])
  } finally {
    await hook.unmount()
    globalThis.window = originalWindow
  }
})
