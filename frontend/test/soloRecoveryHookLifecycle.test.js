import assert from 'node:assert/strict'
import test from 'node:test'
import React, { StrictMode, useLayoutEffect, useRef } from 'react'
import {
  act,
  create,
} from 'react-test-renderer'
import { useGameSession } from '../src/hooks/useGameSession.js'
import { useBackendGameSession } from '../src/hooks/useBackendGameSession.js'
import { usePlayerState } from '../src/hooks/usePlayerState.js'
import { useRouteAnimation } from '../src/hooks/useRouteAnimation.js'
import { SOLO_NAVIGATION_START_KINDS } from '../src/hooks/navigationFrameChannel.js'
import { useSoloRoundRecovery } from '../src/hooks/useSoloRoundRecovery.js'
import { resolveRecoveredSoloMovement } from '../src/recovery/soloRecoveryRuntime.js'
import {
  SOLO_ROUTE_EVENT_TYPES,
  resolveSoloLiveCatchInterval,
} from '../src/utils/soloRouteCatchEvents.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createManualRuntime() {
  let nextId = 1
  const timeouts = new Map()
  const intervals = new Map()
  const animationFrames = new Map()
  const timeoutRegistrations = []
  const intervalRegistrations = []

  return {
    window: {
      setTimeout(callback, delayMs) {
        const id = nextId
        nextId += 1
        const registration = { id, callback, delayMs }
        timeouts.set(id, registration)
        timeoutRegistrations.push(registration)
        return id
      },
      clearTimeout(id) {
        timeouts.delete(id)
      },
      setInterval(callback, delayMs) {
        const id = nextId
        nextId += 1
        const registration = { id, callback, delayMs }
        intervals.set(id, registration)
        intervalRegistrations.push(registration)
        return id
      },
      clearInterval(id) {
        intervals.delete(id)
      },
    },
    requestAnimationFrame(callback) {
      const id = nextId
      nextId += 1
      animationFrames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id)
    },
    takeAnimationFrame() {
      const entry = animationFrames.entries().next().value
      if (!entry) {
        return null
      }
      const [id, callback] = entry
      animationFrames.delete(id)
      return callback
    },
    timeoutEntries: () => [...timeouts.entries()],
    intervalEntries: () => [...intervals.entries()],
    timeoutRegistrations: () => [...timeoutRegistrations],
    intervalRegistrations: () => [...intervalRegistrations],
    animationFrameCount: () => animationFrames.size,
    fireTimeout(id) {
      const timer = timeouts.get(id)
      timeouts.delete(id)
      timer?.callback()
    },
    fireInterval(id) {
      intervals.get(id)?.callback()
    },
  }
}

async function withManualRuntime(callback) {
  const runtime = createManualRuntime()
  const originalWindow = globalThis.window
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  globalThis.window = runtime.window
  globalThis.requestAnimationFrame = runtime.requestAnimationFrame
  globalThis.cancelAnimationFrame = runtime.cancelAnimationFrame

  try {
    await callback(runtime)
  } finally {
    globalThis.window = originalWindow
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  }
}

function RouteHookHarness({ options, capture }) {
  capture(useRouteAnimation(options))
  return null
}

function GameHookHarness({ options, capture }) {
  capture(useGameSession(options))
  return null
}

function PlayerHookHarness({ options, capture }) {
  capture(usePlayerState(options))
  return null
}

function BackendSessionHookHarness({ options, capture }) {
  capture(useBackendGameSession(options.token))
  return null
}

function RecoveryPlayerHookHarness({ options, capture }) {
  const playerApiRef = useRef(null)
  const runtimeSnapshotRef = useRef({
    playerPosition: { lat: 28.5505, lon: 77.2688 },
    simulationSpeedMetersPerSecond: 80,
    movement: null,
  })
  const recovery = useSoloRoundRecovery({
    ...options.recovery,
    hydratePlayer: (...args) =>
      playerApiRef.current?.hydratePlayerState(...args),
    resetRuntime: () => playerApiRef.current?.resetPlayerRecoveryRuntime(),
    getRuntimeSnapshot: () => runtimeSnapshotRef.current,
  })
  const player = usePlayerState({
    ...options.player,
    captureRouteOperation: recovery.captureRuntimeOperation,
    onMovementTransition: recovery.queueRuntimeCheckpoint,
  })
  useLayoutEffect(() => {
    playerApiRef.current = player
    runtimeSnapshotRef.current = {
      playerPosition: player.getSettledPlayerPosition(),
      simulationSpeedMetersPerSecond: player.simulationSpeed,
      movement: player.getMovementRecoverySnapshot(),
    }
  }, [player])
  capture({ player, recovery })
  return null
}


function ActiveGameHookHarness({ options, capture }) {
  const { initialRound, ...sessionOptions } = options
  const session = useGameSession(sessionOptions)
  const initializedRef = useRef(null)

  if (initializedRef.current === null) {
    initializedRef.current = true
    session.startGame(initialRound)
  }

  capture(session)
  return null
}

async function mountHook(Harness, options, { strict = false } = {}) {
  let current
  let root
  const capture = (value) => {
    current = value
  }
  const render = (nextOptions) => React.createElement(
    Harness,
    { options: nextOptions, capture },
  )
  const wrap = (element) => strict
    ? React.createElement(StrictMode, null, element)
    : element

  await act(async () => {
    root = create(wrap(render(options)))
  })

  return {
    get current() {
      return current
    },
    async update(nextOptions) {
      await act(async () => {
        root.update(wrap(render(nextOptions)))
      })
    },
    async unmount() {
      await act(async () => root.unmount())
    },
  }
}

const LONG_ROUTE = [[28.55, 77.26], [28.57, 77.26]]
const SHORT_ROUTE = [[28.55, 77.26], [28.551, 77.26]]
const RECOVERY_ROUTE = [[28.55, 77.26], [28.65, 77.26]]

function movingCheckpoint({
  speed = 80,
  anchorDistanceMeters = 100,
  purpose = 'MAP',
} = {}) {
  const checkpoint = createValidSoloCheckpoint()
  checkpoint.player.simulationSpeedMetersPerSecond = speed
  checkpoint.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: 'MOVING',
    purpose,
    destination: { lat: 28.65, lon: 77.26 },
    chasedTargetId: purpose === 'CHASE'
      ? '66666666-6666-4666-8666-666666666666'
      : null,
    routeCoordinates: RECOVERY_ROUTE,
    anchorDistanceMeters,
    anchorTimeEpochMs: SOLO_RECOVERY_TEST_STARTED_AT + 1_000,
  }
  return checkpoint
}

test('route hook re-anchors active speed changes without a discontinuity', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 100_000
    const frames = []
    const options = (speedMetersPerSecond) => ({
      speedMetersPerSecond,
      getEpochTimeMs: () => epochMs,
      onNavigationFrame: (frame) => frames.push(frame),
    })
    const hook = await mountHook(RouteHookHarness, options(10))

    try {
      await act(async () => {
        hook.current.startAnimation(LONG_ROUTE)
      })
      epochMs = 105_000
      await act(async () => runtime.takeAnimationFrame()(16))
      assert.equal(frames.at(-1).distanceTraveledMeters, 50)

      await hook.update(options(20))
      epochMs = 106_000
      await act(async () => runtime.takeAnimationFrame()(32))
      assert.equal(frames.at(-1).distanceTraveledMeters, 70)
    } finally {
      await hook.unmount()
    }
  })
})

test('CHASE crossing terminates a large frame at the exact catch distance', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 100_000
    const route = [[0, 0], [0, 0.02]]
    const target = {
      id: '66666666-6666-4666-8666-666666666662',
      creatureId: 'sparkbit',
      lat: 0,
      lon: 0.005,
      rarity: 'common',
      score: 10,
      spawnedAt: epochMs - 1_000,
      expiresAt: epochMs + 20_000,
    }
    const targets = [
      { ...target, id: '66666666-6666-4666-8666-666666666661', lon: 0.003 },
      target,
      { ...target, id: '66666666-6666-4666-8666-666666666663', lon: 0.007 },
    ]
    const frames = []
    const positions = []
    const catchIntervals = []
    let completions = 0
    const hook = await mountHook(RouteHookHarness, {
      speedMetersPerSecond: 700,
      getEpochTimeMs: () => epochMs,
      onNavigationFrame: (frame) => frames.push(frame),
      onPositionChange: (position) => positions.push(position),
      resolveRouteInterval: (interval) => resolveSoloLiveCatchInterval({
        plan: interval.plan,
        targets,
        startDistanceMeters: interval.previousDistanceMeters,
        endDistanceMeters: interval.proposedDistanceMeters,
        windowStartEpochMs: interval.previousEpochTimeMs,
        windowEndEpochMs: interval.proposedEpochTimeMs,
        movementAnchor: interval.movementAnchor,
        roundEndsAtEpochMs: epochMs + 20_000,
        chasedTargetId: target.id,
      }),
      onRouteIntervalEvents: (interval) => catchIntervals.push(interval),
    })

    try {
      await act(async () => hook.current.startAnimation(route, () => {
        completions += 1
      }))
      const largeFrame = runtime.takeAnimationFrame()
      epochMs += 2_000
      await act(async () => largeFrame(16))

      const terminal = catchIntervals[0].terminal
      assert.deepEqual(
        catchIntervals[0].entries.map((entry) => entry.targetId),
        [targets[0].id, target.id],
      )
      assert.equal(terminal.targetId, target.id)
      assert.equal(frames.at(-1).distanceTraveledMeters, terminal.distanceMeters)
      assert.ok(frames.at(-1).distanceTraveledMeters > 525)
      assert.ok(frames.at(-1).distanceTraveledMeters < 535)
      assert.ok(frames.every(
        (frame) => frame.distanceTraveledMeters <= terminal.distanceMeters,
      ))
      assert.deepEqual(positions.at(-1), frames.at(-1).position)
      assert.equal(hook.current.isMoving, false)
      assert.equal(runtime.animationFrameCount(), 0)
      assert.equal(completions, 0)
    } finally {
      await hook.unmount()
    }
  })
})

for (const terminalKind of ['CHASE expiry', 'round end']) {
  test(`delayed ${terminalKind} clamps the real route hook before later X/Y/Z events`, async () => {
    await withManualRuntime(async (runtime) => {
      let epochMs = 500_000
      const route = [[0, 0], [0, 0.006]]
      const targetIds = ['X', 'Y', 'Z']
      const targetAtDistance = (id, distanceMeters, expiresAt) => ({
        id,
        creatureId: 'sparkbit',
        lat: 0,
        lon: distanceMeters / 111_195,
        rarity: 'common',
        score: 10,
        spawnedAt: epochMs - 1_000,
        expiresAt,
      })
      const terminalAtEpochMs = epochMs + 2_000
      const targets = [
        targetAtDistance('X', 100, epochMs + 20_000),
        targetAtDistance('Y', 500, terminalAtEpochMs),
        targetAtDistance('Z', 250, epochMs + 20_000),
      ]
      const frames = []
      const intervals = []
      let completions = 0
      const hook = await mountHook(RouteHookHarness, {
        speedMetersPerSecond: 100,
        getEpochTimeMs: () => epochMs,
        onNavigationFrame: (frame) => frames.push(frame),
        resolveRouteInterval: (interval) => resolveSoloLiveCatchInterval({
          plan: interval.plan,
          targets,
          startDistanceMeters: interval.previousDistanceMeters,
          endDistanceMeters: interval.proposedDistanceMeters,
          windowStartEpochMs: interval.previousEpochTimeMs,
          windowEndEpochMs: interval.proposedEpochTimeMs,
          movementAnchor: interval.movementAnchor,
          roundEndsAtEpochMs: terminalKind === 'round end'
            ? terminalAtEpochMs
            : epochMs + 20_000,
          chasedTargetId: terminalKind === 'CHASE expiry' ? 'Y' : null,
        }),
        onRouteIntervalEvents: (interval) => intervals.push(interval),
      })

      try {
        await act(async () => hook.current.startAnimation(route, () => {
          completions += 1
        }))
        const delayedFrame = runtime.takeAnimationFrame()
        epochMs += 5_000
        await act(async () => delayedFrame(16))

        assert.equal(intervals.length, 1)
        assert.equal(
          intervals[0].terminal.type,
          terminalKind === 'CHASE expiry'
            ? SOLO_ROUTE_EVENT_TYPES.TARGET_EXPIRY
            : SOLO_ROUTE_EVENT_TYPES.ROUND_END,
        )
        assert.equal(intervals[0].terminal.atEpochMs, terminalAtEpochMs)
        assert.equal(intervals[0].terminal.distanceMeters, 200)
        assert.deepEqual(
          intervals[0].entries.map((entry) => entry.targetId),
          [targetIds[0]],
        )
        assert.equal(frames.at(-1).distanceTraveledMeters, 200)
        assert.equal(frames.at(-1).isMoving, false)
        assert.ok(frames.every(
          (frame) => frame.distanceTraveledMeters <= 200,
        ))
        assert.equal(runtime.animationFrameCount(), 0)
        assert.equal(hook.current.isMoving, false)
        assert.equal(completions, 0)
      } finally {
        await hook.unmount()
      }
    })
  })
}

test('semantic cancellation fallback settles at its supplied deadline', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 600_000
    const frames = []
    const hook = await mountHook(RouteHookHarness, {
      speedMetersPerSecond: 100,
      getEpochTimeMs: () => epochMs,
      onNavigationFrame: (frame) => frames.push(frame),
    })

    try {
      await act(async () => hook.current.startAnimation([[0, 0], [0, 0.006]]))
      const staleFrame = runtime.takeAnimationFrame()
      epochMs += 5_000
      let settlement
      await act(async () => {
        settlement = hook.current.cancelAnimation({
          settleAtEpochMs: epochMs - 3_000,
        })
      })

      assert.equal(settlement.movementAnchor.anchorDistanceMeters, 200)
      assert.equal(frames.at(-1).distanceTraveledMeters, 200)
      assert.equal(frames.at(-1).isMoving, false)
      assert.equal(runtime.animationFrameCount(), 0)
      await act(async () => staleFrame(16))
      assert.equal(frames.at(-1).distanceTraveledMeters, 200)
    } finally {
      await hook.unmount()
    }
  })
})

test('route hook does not double-count after backward clock and speed change', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 100_000
    const frames = []
    const options = (speedMetersPerSecond) => ({
      speedMetersPerSecond,
      getEpochTimeMs: () => epochMs,
      onNavigationFrame: (frame) => frames.push(frame),
    })
    const hook = await mountHook(RouteHookHarness, options(10))

    try {
      await act(async () => hook.current.startAnimation(LONG_ROUTE))
      epochMs = 110_000
      await act(async () => runtime.takeAnimationFrame()(16))
      assert.equal(frames.at(-1).distanceTraveledMeters, 100)

      epochMs = 105_000
      await hook.update(options(20))
      epochMs = 110_000
      await act(async () => runtime.takeAnimationFrame()(32))
      assert.equal(frames.at(-1).distanceTraveledMeters, 100)

      epochMs = 111_000
      await act(async () => runtime.takeAnimationFrame()(48))
      assert.equal(frames.at(-1).distanceTraveledMeters, 120)
    } finally {
      await hook.unmount()
    }
  })
})

test('route completion fires once and cancellation blocks stale frame work', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 200_000
    let completions = 0
    const positions = []
    const hook = await mountHook(RouteHookHarness, {
      speedMetersPerSecond: 100,
      getEpochTimeMs: () => epochMs,
      onPositionChange: (position) => positions.push(position),
    })

    try {
      await act(async () => {
        hook.current.startAnimation(SHORT_ROUTE, () => {
          completions += 1
        })
      })
      const completingFrame = runtime.takeAnimationFrame()
      epochMs = 202_000
      await act(async () => completingFrame(16))
      assert.equal(completions, 1)
      assert.equal(hook.current.isMoving, false)

      await act(async () => hook.current.cancelAnimation())
      await act(async () => completingFrame(32))
      assert.equal(completions, 1)

      await act(async () => hook.current.startAnimation(LONG_ROUTE))
      const cancelledFrame = runtime.takeAnimationFrame()
      const positionCount = positions.length
      await act(async () => hook.current.cancelAnimation())
      assert.equal(positions.length, positionCount + 1)
      await act(async () => cancelledFrame(48))
      assert.equal(positions.length, positionCount + 1)
    } finally {
      await hook.unmount()
    }
  })
})

test('route replacement near completion rejects stale revision callbacks', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 300_000
    const frames = []
    const positions = []
    let oldCompletions = 0
    let newCompletions = 0
    const hook = await mountHook(RouteHookHarness, {
      speedMetersPerSecond: 100,
      getEpochTimeMs: () => epochMs,
      onNavigationFrame: (frame) => frames.push(frame),
      onPositionChange: (position) => positions.push(position),
    })

    try {
      await act(async () => hook.current.startAnimation(
        SHORT_ROUTE,
        () => { oldCompletions += 1 },
      ))
      epochMs = 301_000
      await act(async () => runtime.takeAnimationFrame()(16))
      const staleNearCompletionFrame = runtime.takeAnimationFrame()

      await act(async () => hook.current.startAnimation(
        LONG_ROUTE,
        () => { newCompletions += 1 },
      ))
      const replacementRevision = frames.at(-1).routeRevision
      const positionCount = positions.length
      epochMs = 302_000
      await act(async () => staleNearCompletionFrame(32))

      assert.equal(frames.at(-1).routeRevision, replacementRevision)
      assert.equal(positions.length, positionCount)
      assert.equal(oldCompletions, 0)
      assert.equal(newCompletions, 0)
    } finally {
      await hook.unmount()
    }
  })
})

test('new route prelude is preserved while supplied anchors avoid a fresh delay', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 400_000
    const frames = []
    const hook = await mountHook(RouteHookHarness, {
      speedMetersPerSecond: 10,
      startDelayMs: 400,
      getEpochTimeMs: () => epochMs,
      onNavigationFrame: (frame) => frames.push(frame),
    })

    try {
      await act(async () => hook.current.startAnimation(LONG_ROUTE))
      assert.equal(runtime.timeoutEntries().length, 1)
      assert.equal(runtime.timeoutEntries()[0][1].delayMs, 400)
      assert.equal(runtime.animationFrameCount(), 0)

      await act(async () => hook.current.cancelAnimation())
      await act(async () => hook.current.startAnimation(
        LONG_ROUTE,
        undefined,
        {
          movementAnchor: {
            anchorDistanceMeters: 20,
            anchorTimeEpochMs: epochMs - 1_000,
            speedMetersPerSecond: 10,
          },
        },
      ))
      assert.equal(runtime.timeoutEntries().length, 0)
      assert.equal(runtime.animationFrameCount(), 1)
      assert.equal(frames.at(-1).distanceTraveledMeters, 30)

      await act(async () => hook.current.cancelAnimation())
      await act(async () => hook.current.startAnimation(
        LONG_ROUTE,
        undefined,
        {
          movementAnchor: {
            anchorDistanceMeters: 0,
            anchorTimeEpochMs: epochMs + 250,
            speedMetersPerSecond: 10,
          },
        },
      ))
      assert.equal(runtime.timeoutEntries()[0][1].delayMs, 250)
    } finally {
      await hook.unmount()
    }
  })
})

test('recovered movement hydrates both renderer configurations identically without a new delay', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = SOLO_RECOVERY_TEST_STARTED_AT + 6_000
    const checkpoint = movingCheckpoint({ speed: 80 })
    const expected = resolveRecoveredSoloMovement(checkpoint, epochMs)
    const movementTransitions = []
    const leaflet = await mountHook(PlayerHookHarness, {
      routeAnimationStartDelayMs: 0,
      getEpochTimeMs: () => epochMs,
      onMovementTransition: (transition) => {
        movementTransitions.push(transition)
      },
    })
    const mapLibre = await mountHook(PlayerHookHarness, {
      routeAnimationStartDelayMs: 400,
      getEpochTimeMs: () => epochMs,
    })

    try {
      const timeoutCount = runtime.timeoutRegistrations().length
      await act(async () => {
        await leaflet.current.hydratePlayerState(checkpoint, {
          nowEpochMs: epochMs,
        })
        await mapLibre.current.hydratePlayerState(checkpoint, {
          nowEpochMs: epochMs,
        })
      })

      assert.deepEqual(leaflet.current.playerPosition, expected.position)
      assert.deepEqual(mapLibre.current.playerPosition, expected.position)
      assert.deepEqual(
        leaflet.current.routeCoordinates,
        mapLibre.current.routeCoordinates,
      )
      assert.deepEqual(leaflet.current.routeCoordinates, RECOVERY_ROUTE)
      assert.equal(runtime.timeoutRegistrations().length, timeoutCount)
      assert.equal(runtime.animationFrameCount(), 2)
      const leafletFrames = []
      const mapLibreFrames = []
      const unsubscribeLeaflet = leaflet.current.subscribeToNavigationFrames(
        (frame) => leafletFrames.push(frame),
      )
      const unsubscribeMapLibre = mapLibre.current.subscribeToNavigationFrames(
        (frame) => mapLibreFrames.push(frame),
      )
      assert.equal(
        leafletFrames.at(-1).navigationStartKind,
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      )
      assert.equal(
        mapLibreFrames.at(-1).navigationStartKind,
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      )
      assert.deepEqual(mapLibreFrames.at(-1).position, expected.position)
      assert.equal(
        mapLibreFrames.at(-1).distanceTraveledMeters,
        expected.movementAnchor.anchorDistanceMeters,
      )
      unsubscribeLeaflet()
      unsubscribeMapLibre()

      epochMs += 1_000
      await act(async () => leaflet.current.setSimulationSpeed(160))
      let reanchored
      await act(async () => {
        reanchored = leaflet.current.getMovementRecoverySnapshot()
      })
      assert.equal(reanchored.anchorTimeEpochMs, epochMs)
      assert.equal(reanchored.anchorDistanceMeters, 580)
      assert.equal(movementTransitions.at(-1).type, 'SPEED_CHANGED')
      assert.equal(
        movementTransitions.at(-1).simulationSpeedMetersPerSecond,
        160,
      )

      epochMs += 2_000
      let continued
      await act(async () => {
        continued = leaflet.current.getMovementRecoverySnapshot()
      })
      assert.equal(continued.anchorDistanceMeters, 900)
    } finally {
      await leaflet.unmount()
      await mapLibre.unmount()
    }
  })
})

test('active recovered CHASE publishes a direct-follow navigation start', async () => {
  await withManualRuntime(async () => {
    const epochMs = SOLO_RECOVERY_TEST_STARTED_AT + 6_000
    const checkpoint = movingCheckpoint({ purpose: 'CHASE' })
    const hook = await mountHook(PlayerHookHarness, {
      routeAnimationStartDelayMs: 400,
      getEpochTimeMs: () => epochMs,
    })

    try {
      await act(async () => {
        await hook.current.hydratePlayerState(checkpoint, {
          nowEpochMs: epochMs,
        })
      })
      const frames = []
      const unsubscribe = hook.current.subscribeToNavigationFrames(
        (frame) => frames.push(frame),
      )
      assert.equal(frames.at(-1).isMoving, true)
      assert.equal(
        frames.at(-1).navigationStartKind,
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      )
      unsubscribe()
    } finally {
      await hook.unmount()
    }
  })
})

test('player hydration settles a route completed during downtime without animation', async () => {
  await withManualRuntime(async (runtime) => {
    const epochMs = SOLO_RECOVERY_TEST_STARTED_AT + 59_000
    const checkpoint = movingCheckpoint({ speed: 700 })
    const hook = await mountHook(PlayerHookHarness, {
      routeAnimationStartDelayMs: 400,
      getEpochTimeMs: () => epochMs,
    })

    try {
      const frames = []
      const unsubscribe = hook.current.subscribeToNavigationFrames(
        (frame) => frames.push(frame),
      )
      let result
      await act(async () => {
        result = await hook.current.hydratePlayerState(checkpoint, {
          nowEpochMs: epochMs,
        })
      })
      assert.equal(result.kind, 'COMPLETED')
      assert.deepEqual(hook.current.playerPosition, {
        lat: 28.65,
        lon: 77.26,
      })
      assert.deepEqual(hook.current.routeCoordinates, [])
      assert.equal(runtime.animationFrameCount(), 0)
      assert.deepEqual(frames, [])
      unsubscribe()
    } finally {
      await hook.unmount()
    }
  })
})

test('recovered MAP routing reuses the normal route request path once', async () => {
  await withManualRuntime(async (runtime) => {
    const epochMs = SOLO_RECOVERY_TEST_STARTED_AT + 10_000
    const checkpoint = createValidSoloCheckpoint()
    checkpoint.movement = {
      movementRecoveryId: '55555555-5555-4555-8555-555555555555',
      phase: 'ROUTING',
      purpose: 'MAP',
      destination: { lat: 28.65, lon: 77.26 },
      chasedTargetId: null,
      routeCoordinates: null,
      anchorDistanceMeters: null,
      anchorTimeEpochMs: null,
    }
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body))
      return {
        ok: true,
        async json() {
          return {
            coordinates: RECOVERY_ROUTE.map(([lat, lon]) => ({ lat, lon })),
          }
        },
      }
    }
    const hook = await mountHook(PlayerHookHarness, {
      routeAnimationStartDelayMs: 400,
      getEpochTimeMs: () => epochMs,
    })

    try {
      await act(async () => {
        await hook.current.hydratePlayerState(checkpoint, {
          nowEpochMs: epochMs,
        })
      })
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0], {
        sourceLat: checkpoint.player.settledPosition.lat,
        sourceLon: checkpoint.player.settledPosition.lon,
        destinationLat: 28.65,
        destinationLon: 77.26,
      })
      assert.deepEqual(hook.current.routeCoordinates, RECOVERY_ROUTE)
      const frames = []
      const unsubscribe = hook.current.subscribeToNavigationFrames(
        (frame) => frames.push(frame),
      )
      assert.equal(
        frames.at(-1).navigationStartKind,
        SOLO_NAVIGATION_START_KINDS.FRESH,
      )
      assert.equal(runtime.timeoutEntries()[0][1].delayMs, 400)
      unsubscribe()
    } finally {
      globalThis.fetch = originalFetch
      await hook.unmount()
    }
  })
})

test('recovered routing response cannot start after lifecycle invalidation or expiry', async () => {
  await withManualRuntime(async (runtime) => {
    const checkpoint = createValidSoloCheckpoint()
    checkpoint.movement = {
      movementRecoveryId: '55555555-5555-4555-8555-555555555555',
      phase: 'ROUTING',
      purpose: 'MAP',
      destination: { lat: 28.65, lon: 77.26 },
      chasedTargetId: null,
      routeCoordinates: null,
      anchorDistanceMeters: null,
      anchorTimeEpochMs: null,
    }
    let resolveRoute
    const routeResponse = new Promise((resolve) => {
      resolveRoute = resolve
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => routeResponse
    let lifecycleCurrent = true
    let nowEpochMs = SOLO_RECOVERY_TEST_STARTED_AT + 10_000
    const hook = await mountHook(PlayerHookHarness, {
      getEpochTimeMs: () => nowEpochMs,
      captureRouteOperation: () => ({
        isCurrent: () => lifecycleCurrent,
      }),
    })

    try {
      let hydration
      await act(async () => {
        hydration = hook.current.hydratePlayerState(checkpoint, {
          nowEpochMs,
          shouldStart: () => (
            lifecycleCurrent &&
            nowEpochMs < checkpoint.round.endsAtEpochMs
          ),
        })
        await Promise.resolve()
      })
      lifecycleCurrent = false
      nowEpochMs = checkpoint.round.endsAtEpochMs
      resolveRoute({
        ok: true,
        async json() {
          return {
            coordinates: RECOVERY_ROUTE.map(([lat, lon]) => ({ lat, lon })),
          }
        },
      })
      let result
      await act(async () => {
        result = await hydration
      })

      assert.equal(result.kind, 'SETTLED')
      assert.equal(runtime.animationFrameCount(), 0)
      assert.equal(hook.current.isMoving, false)
      assert.deepEqual(hook.current.routeCoordinates, [])
    } finally {
      globalThis.fetch = originalFetch
      await hook.unmount()
    }
  })
})

test('reset aborts a pending route and an ignored late response stays inert', async () => {
  await withManualRuntime(async (runtime) => {
    let resolveRoute
    const routeResponse = new Promise((resolve) => {
      resolveRoute = resolve
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => routeResponse
    const hook = await mountHook(PlayerHookHarness, {})

    try {
      let movement
      await act(async () => {
        movement = hook.current.moveToDestination({ lat: 28.65, lon: 77.26 })
        await Promise.resolve()
      })
      await act(async () => hook.current.resetPlayerRecoveryRuntime())
      resolveRoute({
        ok: true,
        async json() {
          return {
            coordinates: RECOVERY_ROUTE.map(([lat, lon]) => ({ lat, lon })),
          }
        },
      })
      await act(async () => movement)

      assert.equal(runtime.animationFrameCount(), 0)
      assert.equal(hook.current.isMoving, false)
      assert.deepEqual(hook.current.routeCoordinates, [])
    } finally {
      globalThis.fetch = originalFetch
      await hook.unmount()
    }
  })
})

test('routing A response cannot start movement after identity B becomes current', async () => {
  await withManualRuntime(async (runtime) => {
    let resolveRoute
    const routeResponse = new Promise((resolve) => {
      resolveRoute = resolve
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => routeResponse
    let currentIdentity = 'user:A'
    const hook = await mountHook(PlayerHookHarness, {
      captureRouteOperation: () => {
        const capturedIdentity = currentIdentity
        return {
          isCurrent: () => currentIdentity === capturedIdentity,
        }
      },
    })

    try {
      let movement
      await act(async () => {
        movement = hook.current.moveToDestination({ lat: 28.65, lon: 77.26 })
        await Promise.resolve()
      })
      currentIdentity = 'user:B'
      resolveRoute({
        ok: true,
        async json() {
          return {
            coordinates: RECOVERY_ROUTE.map(([lat, lon]) => ({ lat, lon })),
          }
        },
      })
      assert.equal(await movement, false)
      assert.equal(runtime.animationFrameCount(), 0)
      assert.equal(hook.current.isMoving, false)
      assert.deepEqual(hook.current.routeCoordinates, [])
    } finally {
      globalThis.fetch = originalFetch
      await hook.unmount()
    }
  })
})

test('production recovery scope rejects routing A1 after A -> B -> A2', async () => {
  await withManualRuntime(async (runtime) => {
    const records = new Map()
    const store = {
      async read(identityKey) {
        return {
          ok: true,
          operation: 'read',
          checkpoint: records.has(identityKey)
            ? structuredClone(records.get(identityKey))
            : null,
        }
      },
      async replace(identityKey, checkpoint) {
        records.set(identityKey, structuredClone(checkpoint))
        return { ok: true, operation: 'replace' }
      },
      async delete(identityKey) {
        records.delete(identityKey)
        return { ok: true, operation: 'delete' }
      },
      close() {},
    }
    const identityA = `user:${SOLO_RECOVERY_TEST_USER_ID}`
    const userBId = '22222222-2222-4222-8222-222222222222'
    const sessionA1 = {
      sessionId: '44444444-4444-4444-8444-444444444444',
      status: 'RUNNING',
      durationSeconds: 60,
      startedAt: new Date(SOLO_RECOVERY_TEST_STARTED_AT).toISOString(),
      userId: SOLO_RECOVERY_TEST_USER_ID,
    }
    const sessionA2 = {
      ...sessionA1,
      sessionId: '99999999-9999-4999-8999-999999999999',
      startedAt: new Date(
        SOLO_RECOVERY_TEST_STARTED_AT + 1_000,
      ).toISOString(),
    }
    let resolveRoute
    const routeResponse = new Promise((resolve) => {
      resolveRoute = resolve
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => routeResponse
    const flushRecovery = async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
    const optionsFor = (userId) => ({
      recovery: {
        loadingAuth: false,
        isAuthenticated: true,
        currentUser: { userId },
        recoveryStore: store,
        getBackendSession: async (sessionId) => ({
          ...(sessionId === sessionA1.sessionId ? sessionA1 : sessionA2),
        }),
        endBackendSession: async () => assert.fail('unexpected backend end'),
        getEpochTimeMs: () => SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
        hydrateRound: () => {},
        adoptBackendSession: () => {},
      },
      player: {
        getEpochTimeMs: () => SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
      },
    })
    const hook = await mountHook(
      RecoveryPlayerHookHarness,
      optionsFor(SOLO_RECOVERY_TEST_USER_ID),
    )

    try {
      await act(async () => flushRecovery())
      assert.equal(hook.current.recovery.isReady, true)

      const operationA1 = hook.current.recovery.beginRoundOperation()
      await act(async () => {
        await hook.current.recovery.establishRound(sessionA1, operationA1)
        hook.current.recovery.completeRoundOperation(operationA1)
      })
      let routingA1
      await act(async () => {
        routingA1 = hook.current.player.moveToDestination({
          lat: 28.65,
          lon: 77.26,
        })
        await flushRecovery()
      })

      await hook.update(optionsFor(userBId))
      await act(async () => flushRecovery())
      assert.equal(hook.current.recovery.isReady, true)
      records.delete(identityA)

      await hook.update(optionsFor(SOLO_RECOVERY_TEST_USER_ID))
      await act(async () => flushRecovery())
      assert.equal(hook.current.recovery.isReady, true)
      const operationA2 = hook.current.recovery.beginRoundOperation()
      await act(async () => {
        await hook.current.recovery.establishRound(sessionA2, operationA2)
        hook.current.recovery.completeRoundOperation(operationA2)
      })
      const scopeA2 = hook.current.recovery.captureActiveRoundScope()
      const positionA2 = structuredClone(hook.current.player.playerPosition)

      resolveRoute({
        ok: true,
        async json() {
          return {
            coordinates: RECOVERY_ROUTE.map(([lat, lon]) => ({ lat, lon })),
          }
        },
      })
      await act(async () => routingA1)

      assert.equal(await routingA1, false)
      assert.equal(hook.current.recovery.identityKey, identityA)
      assert.equal(hook.current.recovery.isActiveRoundScopeCurrent(scopeA2), true)
      assert.equal(
        records.get(identityA).round.backendSessionId,
        sessionA2.sessionId,
      )
      assert.deepEqual(hook.current.player.playerPosition, positionA2)
      assert.deepEqual(hook.current.player.routeCoordinates, [])
      assert.equal(hook.current.player.pendingDestination, null)
      assert.equal(hook.current.player.getMovementRecoverySnapshot(), null)
      assert.equal(hook.current.player.isMoving, false)
      assert.equal(runtime.animationFrameCount(), 0)
    } finally {
      globalThis.fetch = originalFetch
      resolveRoute?.({
        ok: false,
        async json() {
          return {}
        },
      })
      await hook.unmount()
    }
  })
})

function recoveredRoutingChaseCheckpoint({
  caught = false,
  expired = false,
  missing = false,
  unknown = false,
} = {}) {
  const checkpoint = createValidSoloCheckpoint()
  const targetId = '66666666-6666-4666-8666-666666666666'
  const recoveredTarget = {
    id: targetId,
    creatureId: unknown ? 'unknown-creature' : 'sparkbit',
    lat: 28.65,
    lon: 77.26,
    rarity: 'common',
    score: 10,
    spawnedAt: SOLO_RECOVERY_TEST_STARTED_AT + 1_000,
    expiresAt: SOLO_RECOVERY_TEST_STARTED_AT + (expired ? 8_000 : 50_000),
    lifetimeMs: expired ? 7_000 : 49_000,
  }
  checkpoint.targets = missing ? [] : [recoveredTarget]
  if (caught) {
    checkpoint.caughtTargets = [{
      ...recoveredTarget,
      caughtAt: SOLO_RECOVERY_TEST_STARTED_AT + 5_000,
    }]
    checkpoint.score = recoveredTarget.score
    checkpoint.xp = recoveredTarget.score
  }
  checkpoint.movement = {
    movementRecoveryId: '55555555-5555-4555-8555-555555555555',
    phase: 'ROUTING',
    purpose: 'CHASE',
    destination: { lat: 0, lon: 0 },
    chasedTargetId: targetId,
    routeCoordinates: null,
    anchorDistanceMeters: null,
    anchorTimeEpochMs: null,
  }
  return checkpoint
}

for (const targetCase of ['valid', 'expired', 'missing', 'caught', 'unknown']) {
  test(`recovered CHASE routing issues ${targetCase === 'valid' ? 'one' : 'zero'} request for a ${targetCase} target`, async () => {
    await withManualRuntime(async () => {
      const checkpoint = recoveredRoutingChaseCheckpoint({
        caught: targetCase === 'caught',
        expired: targetCase === 'expired',
        missing: targetCase === 'missing',
        unknown: targetCase === 'unknown',
      })
      const records = new Map([[checkpoint.identityKey, checkpoint]])
      const store = {
        async read(identityKey) {
          return {
            ok: true,
            operation: 'read',
            checkpoint: structuredClone(records.get(identityKey) ?? null),
          }
        },
        async replace(identityKey, replacement) {
          records.set(identityKey, structuredClone(replacement))
          return { ok: true, operation: 'replace' }
        },
        async delete(identityKey) {
          records.delete(identityKey)
          return { ok: true, operation: 'delete' }
        },
        close() {},
      }
      let routeRequests = 0
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url, options) => {
        routeRequests += 1
        const body = JSON.parse(options.body)
        assert.equal(body.destinationLat, 28.65)
        assert.equal(body.destinationLon, 77.26)
        return {
          ok: true,
          async json() {
            return {
              coordinates: RECOVERY_ROUTE.map(([lat, lon]) => ({ lat, lon })),
            }
          },
        }
      }
      const hook = await mountHook(RecoveryPlayerHookHarness, {
        recovery: {
          loadingAuth: false,
          isAuthenticated: true,
          currentUser: { userId: SOLO_RECOVERY_TEST_USER_ID },
          recoveryStore: store,
          getBackendSession: async () => ({
            sessionId: checkpoint.round.backendSessionId,
            status: 'RUNNING',
            durationSeconds: checkpoint.round.durationSeconds,
            startedAt: new Date(
              checkpoint.round.startedAtEpochMs,
            ).toISOString(),
            userId: SOLO_RECOVERY_TEST_USER_ID,
          }),
          endBackendSession: async () => assert.fail('unexpected backend end'),
          getEpochTimeMs: () => SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
          hydrateRound: () => {},
          adoptBackendSession: () => {},
        },
        player: {
          getEpochTimeMs: () => SOLO_RECOVERY_TEST_STARTED_AT + 10_000,
        },
      }, { strict: true })

      try {
        await act(async () => {
          await Promise.resolve()
          await Promise.resolve()
          await Promise.resolve()
        })
        assert.equal(hook.current.recovery.isReady, true)
        assert.equal(routeRequests, targetCase === 'valid' ? 1 : 0)
        if (targetCase === 'valid') {
          assert.deepEqual(hook.current.player.routeCoordinates, RECOVERY_ROUTE)
          assert.equal(
            records.get(checkpoint.identityKey).movement.phase,
            'MOVING',
          )
        } else {
          assert.deepEqual(hook.current.player.routeCoordinates, [])
          assert.equal(records.get(checkpoint.identityKey).movement, null)
        }
      } finally {
        globalThis.fetch = originalFetch
        await hook.unmount()
      }
    })
  })
}

test('identity-style runtime reset invalidates an old recovered animation frame', async () => {
  await withManualRuntime(async (runtime) => {
    const checkpoint = movingCheckpoint({ speed: 80 })
    const hook = await mountHook(PlayerHookHarness, {
      getEpochTimeMs: () => SOLO_RECOVERY_TEST_STARTED_AT + 6_000,
    })

    try {
      await act(async () => hook.current.hydratePlayerState(checkpoint, {
        nowEpochMs: SOLO_RECOVERY_TEST_STARTED_AT + 6_000,
      }))
      const staleFrame = runtime.takeAnimationFrame()
      assert.ok(staleFrame)

      await act(async () => hook.current.resetPlayerRecoveryRuntime())
      const resetPosition = structuredClone(hook.current.playerPosition)
      await act(async () => staleFrame(16))

      assert.deepEqual(hook.current.playerPosition, resetPosition)
      assert.equal(hook.current.isMoving, false)
      assert.deepEqual(hook.current.routeCoordinates, [])
    } finally {
      await hook.unmount()
    }
  })
})

function deferredResponse() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body
    },
  }
}

test('backend start has a synchronous single-flight guard and reset invalidates its response', async () => {
  const originalFetch = globalThis.fetch
  const createResponse = deferredResponse()
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return createResponse.promise
  }
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })

  try {
    let firstStart
    let repeatedStart
    await act(async () => {
      firstStart = hook.current.beginSession(60, 'A')
      repeatedStart = hook.current.beginSession(60, 'A')
      await Promise.resolve()
    })
    assert.equal(await repeatedStart, false)
    assert.equal(requests, 1)

    await act(async () => hook.current.invalidateSessionOperations({
      clearSession: true,
    }))
    createResponse.resolve(jsonResponse({
      sessionId: '44444444-4444-4444-8444-444444444444',
      status: 'CREATED',
    }))
    assert.equal(await firstStart, false)
    assert.equal(hook.current.backendSession, null)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

test('invalidated restart A cannot overwrite a later restart B', async () => {
  const originalFetch = globalThis.fetch
  const createA = deferredResponse()
  const createB = deferredResponse()
  const startB = deferredResponse()
  let createCount = 0
  globalThis.fetch = async (url) => {
    if (url.endsWith('/start')) {
      return startB.promise
    }
    createCount += 1
    return createCount === 1 ? createA.promise : createB.promise
  }
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
  const sessionA = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'CREATED',
  }
  const sessionB = {
    sessionId: '88888888-8888-4888-8888-888888888888',
    status: 'CREATED',
  }
  const runningB = { ...sessionB, status: 'RUNNING' }

  try {
    let restartA
    await act(async () => {
      restartA = hook.current.replaceSession(60, 'A')
      await Promise.resolve()
    })
    await act(async () => hook.current.invalidateSessionOperations())
    let restartB
    await act(async () => {
      restartB = hook.current.replaceSession(60, 'B')
      await Promise.resolve()
    })

    createB.resolve(jsonResponse(sessionB))
    await act(async () => Promise.resolve())
    startB.resolve(jsonResponse(runningB))
    await act(async () => restartB)
    assert.equal(hook.current.backendSession.sessionId, sessionB.sessionId)

    createA.resolve(jsonResponse(sessionA))
    assert.equal(await restartA, false)
    assert.equal(hook.current.backendSession.sessionId, sessionB.sessionId)
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

test('late finish response for A cannot replace adopted backend session B', async () => {
  const originalFetch = globalThis.fetch
  const finishA = deferredResponse()
  globalThis.fetch = async () => finishA.promise
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
  const sessionA = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
  }
  const sessionB = {
    sessionId: '88888888-8888-4888-8888-888888888888',
    status: 'RUNNING',
  }

  try {
    await act(async () => hook.current.adoptBackendSession(sessionA))
    let finishing
    await act(async () => {
      finishing = hook.current.finishSession('failed', {
        expectedSessionId: sessionA.sessionId,
      })
      await Promise.resolve()
    })
    await act(async () => hook.current.adoptBackendSession(sessionB))
    let finishResult
    await act(async () => {
      finishA.resolve(jsonResponse({ ...sessionA, status: 'ENDED' }))
      finishResult = await finishing
    })
    assert.equal(finishResult, false)
    assert.equal(hook.current.backendSession.sessionId, sessionB.sessionId)
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

test('detached finish targets captured A and a late error cannot affect B', async () => {
  const originalFetch = globalThis.fetch
  const finishA = deferredResponse()
  const requestedUrls = []
  globalThis.fetch = async (url) => {
    requestedUrls.push(url)
    return finishA.promise
  }
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
  const sessionB = {
    sessionId: '88888888-8888-4888-8888-888888888888',
    status: 'RUNNING',
    score: 0,
    caughtCount: 0,
  }

  try {
    let finishingA
    await act(async () => {
      finishingA = hook.current.finishSessionById(
        '44444444-4444-4444-8444-444444444444',
      )
      await Promise.resolve()
      hook.current.adoptBackendSession(sessionB)
    })
    finishA.reject(new TypeError('late network failure'))
    assert.equal(await finishingA, false)
    assert.equal(hook.current.backendSession.sessionId, sessionB.sessionId)
    assert.equal(hook.current.sessionNotice, null)
    assert.equal(
      requestedUrls[0].endsWith(
        '/api/game/sessions/44444444-4444-4444-8444-444444444444/end',
      ),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

test('late catch failure from A cannot warn or mutate adopted session B', async () => {
  const originalFetch = globalThis.fetch
  const catchA = deferredResponse()
  let capturedRequest = null
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options }
    return catchA.promise
  }
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
  const sessionA = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    score: 10,
    caughtCount: 1,
  }
  const sessionB = {
    sessionId: '88888888-8888-4888-8888-888888888888',
    status: 'RUNNING',
    score: 20,
    caughtCount: 2,
  }

  try {
    await act(async () => hook.current.adoptBackendSession(sessionA))
    let submissionA
    await act(async () => {
      submissionA = hook.current.submitBackendCatch(
        '77777777-7777-4777-8777-777777777777',
        'sparkbit',
      )
      await Promise.resolve()
    })
    assert.deepEqual(JSON.parse(capturedRequest.options.body), {
      catchId: '77777777-7777-4777-8777-777777777777',
      creatureId: 'sparkbit',
    })
    assert.equal(
      capturedRequest.options.headers.Authorization,
      'Bearer token-A',
    )
    await act(async () => hook.current.adoptBackendSession(sessionB))
    let result
    await act(async () => {
      catchA.reject(new TypeError('late catch failure'))
      result = await submissionA
    })

    assert.equal(result, null)
    assert.equal(hook.current.backendSession.sessionId, sessionB.sessionId)
    assert.equal(hook.current.backendScore, 20)
    assert.equal(hook.current.backendCaughtCount, 2)
    assert.equal(hook.current.catchSubmissionWarning, '')
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

for (const [name, response] of [
  ['missing catchId', { score: 90, caughtCount: 9 }],
  ['mismatched catchId', {
    catchId: '88888888-8888-4888-8888-888888888888',
    score: 90,
    caughtCount: 9,
  }],
]) {
  test(`backend ${name} response cannot update totals or confirm a catch`, async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => jsonResponse(response)
    const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
    const session = {
      sessionId: '44444444-4444-4444-8444-444444444444',
      status: 'RUNNING',
      score: 10,
      caughtCount: 1,
    }

    try {
      await act(async () => hook.current.adoptBackendSession(session))
      let error
      await act(async () => {
        try {
          await hook.current.submitBackendCatchForSession(
            session.sessionId,
            '77777777-7777-4777-8777-777777777777',
            'sparkbit',
          )
        } catch (caughtError) {
          error = caughtError
        }
      })
      assert.equal(error?.failureKind, 'RESPONSE_IDENTITY')
      assert.equal(hook.current.backendScore, 10)
      assert.equal(hook.current.backendCaughtCount, 1)
      assert.notEqual(hook.current.catchSubmissionWarning, '')
    } finally {
      globalThis.fetch = originalFetch
      await hook.unmount()
    }
  })
}

test('matching catch response updates backend-only totals for the scoped session', async () => {
  const originalFetch = globalThis.fetch
  const catchId = '77777777-7777-4777-8777-777777777777'
  globalThis.fetch = async () => jsonResponse({
    catchId,
    score: 20,
    caughtCount: 2,
  })
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    score: 10,
    caughtCount: 1,
  }

  try {
    await act(async () => hook.current.adoptBackendSession(session))
    let result
    await act(async () => {
      result = await hook.current.submitBackendCatchForSession(
        session.sessionId,
        catchId,
        'sparkbit',
      )
    })
    assert.equal(result.catchId, catchId)
    assert.equal(hook.current.backendScore, 20)
    assert.equal(hook.current.backendCaughtCount, 2)
    assert.equal(hook.current.catchSubmissionWarning, '')
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})

test('stale replay scope cannot apply matching totals even when session ID is reused', async () => {
  const originalFetch = globalThis.fetch
  const catchResponse = deferredResponse()
  globalThis.fetch = async () => catchResponse.promise
  const hook = await mountHook(BackendSessionHookHarness, { token: 'token-A' })
  const catchId = '77777777-7777-4777-8777-777777777777'
  const session = {
    sessionId: '44444444-4444-4444-8444-444444444444',
    status: 'RUNNING',
    score: 10,
    caughtCount: 1,
  }
  let current = true

  try {
    await act(async () => hook.current.adoptBackendSession(session))
    let submission
    await act(async () => {
      submission = hook.current.submitBackendCatchForSession(
        session.sessionId,
        catchId,
        'sparkbit',
        { shouldApply: () => current },
      )
      await Promise.resolve()
    })
    current = false
    catchResponse.resolve(jsonResponse({
      catchId,
      score: 90,
      caughtCount: 9,
    }))
    await act(async () => submission)
    assert.equal(hook.current.backendScore, 10)
    assert.equal(hook.current.backendCaughtCount, 1)
    assert.equal(hook.current.catchSubmissionWarning, '')
  } finally {
    globalThis.fetch = originalFetch
    await hook.unmount()
  }
})


test('game-session wall clock expires once and restart creates a fresh timeline', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 1_000
    let expirations = 0
    const hook = await mountHook(GameHookHarness, {
      getEpochTimeMs: () => epochMs,
      onRoundExpired: () => { expirations += 1 },
    })

    try {
      let firstTimeline
      await act(async () => {
        firstTimeline = hook.current.startGame({ durationSeconds: 10 })
      })
      assert.equal(firstTimeline.startedAtEpochMs, 1_000)
      assert.equal(firstTimeline.endsAtEpochMs, 11_000)
      assert.equal(hook.current.remainingSeconds, 10)

      const [intervalId] = runtime.intervalEntries()[0]
      const [timeoutId, timeout] = runtime.timeoutEntries()[0]
      assert.equal(timeout.delayMs, 10_000)

      epochMs = 6_500
      await act(async () => runtime.fireInterval(intervalId))
      assert.equal(hook.current.remainingSeconds, 5)

      epochMs = 15_000
      await act(async () => runtime.fireInterval(intervalId))
      await act(async () => runtime.fireTimeout(timeoutId))
      assert.equal(hook.current.gameState, 'ended')
      assert.equal(hook.current.remainingSeconds, 0)
      assert.equal(expirations, 1)

      epochMs = 20_000
      let restarted
      await act(async () => {
        restarted = hook.current.restartGame({ durationSeconds: 5 })
      })
      assert.equal(restarted.startedAtEpochMs, 20_000)
      assert.equal(restarted.endsAtEpochMs, 25_000)

      const staleRestartTimeout = runtime.timeoutEntries()[0][1].callback
      await act(async () => hook.current.endGame())
      epochMs = 30_000
      await act(async () => staleRestartTimeout())
      assert.equal(expirations, 1)

      epochMs = 40_000
      await act(async () => hook.current.restartGame({ durationSeconds: 5 }))
      const staleResetTimeout = runtime.timeoutEntries()[0][1].callback
      await act(async () => hook.current.resetGameSession())
      epochMs = 50_000
      await act(async () => staleResetTimeout())
      assert.equal(hook.current.gameState, 'ready')
      assert.equal(expirations, 1)
    } finally {
      await hook.unmount()
    }
  })
})

test('StrictMode and competing round timers cannot double-expire one round', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 60_000
    let expirations = 0
    const hook = await mountHook(GameHookHarness, {
      getEpochTimeMs: () => epochMs,
      onRoundExpired: () => { expirations += 1 },
    }, { strict: true })

    try {
      await act(async () => hook.current.startGame({ durationSeconds: 2 }))
      const [intervalId] = runtime.intervalEntries()[0]
      const [timeoutId] = runtime.timeoutEntries()[0]
      epochMs = 62_000

      await act(async () => {
        runtime.fireTimeout(timeoutId)
        runtime.fireInterval(intervalId)
      })

      assert.equal(hook.current.gameState, 'ended')
      assert.equal(expirations, 1)
    } finally {
      await hook.unmount()
    }
  })
})

test('StrictMode replays an already-running round effect with one live timer pair', async () => {
  await withManualRuntime(async (runtime) => {
    let epochMs = 70_000
    let expirations = 0
    const hook = await mountHook(ActiveGameHookHarness, {
      getEpochTimeMs: () => epochMs,
      onRoundExpired: () => { expirations += 1 },
      initialRound: {
        durationSeconds: 2,
        startedAtEpochMs: 70_000,
      },
    }, { strict: true })

    try {
      const timeoutRegistrations = runtime.timeoutRegistrations()
      const intervalRegistrations = runtime.intervalRegistrations()

      assert.equal(timeoutRegistrations.length, 2)
      assert.equal(intervalRegistrations.length, 2)
      assert.equal(runtime.timeoutEntries().length, 1)
      assert.equal(runtime.intervalEntries().length, 1)
      assert.equal(
        runtime.timeoutEntries()[0][0],
        timeoutRegistrations[1].id,
      )
      assert.equal(
        runtime.intervalEntries()[0][0],
        intervalRegistrations[1].id,
      )

      epochMs = 71_000
      await act(async () => {
        runtime.fireInterval(intervalRegistrations[1].id)
      })
      assert.equal(hook.current.remainingSeconds, 1)

      epochMs = 72_000
      await act(async () => {
        runtime.fireTimeout(timeoutRegistrations[1].id)
      })
      assert.equal(hook.current.gameState, 'ended')
      assert.equal(hook.current.remainingSeconds, 0)
      assert.equal(expirations, 1)

      await act(async () => {
        timeoutRegistrations[0].callback()
        intervalRegistrations[0].callback()
      })
      assert.equal(expirations, 1)
    } finally {
      await hook.unmount()
    }
  })
})
