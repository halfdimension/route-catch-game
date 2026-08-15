import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'
import {
  createSoloFollowCameraOptions,
  DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE,
  getSoloCameraInteractionType,
  isSoloCameraUserInteraction,
  SOLO_CAMERA_EVENTS,
  SOLO_CAMERA_INTERACTION_TYPES,
  SOLO_CAMERA_MODES,
  SOLO_CAMERA_PROGRAMMATIC_EVENT,
  SOLO_FOLLOW_MAX_ZOOM,
  SOLO_FOLLOW_MIN_ZOOM,
  SOLO_FOLLOW_ZOOM_EVENTS,
  SOLO_NAVIGATION_DESTINATION_EVENTS,
  SOLO_OVERVIEW_MAX_ZOOM,
  transitionSoloCameraMode,
  transitionSoloFollowZoom,
  transitionSoloNavigationDestination,
} from '../src/components/maplibre/mapLibreSoloGameState.js'
import {
  createSoloCameraWorkManager,
  useMapLibreSoloCamera,
} from '../src/components/maplibre/useMapLibreSoloCamera.js'
import {
  createNavigationFrameChannel,
  SOLO_NAVIGATION_START_KINDS,
} from '../src/hooks/navigationFrameChannel.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ROUTE_A = [
  [28.6, 77.2],
  [28.61, 77.21],
]
const ROUTE_B = [
  [28.6, 77.2],
  [28.62, 77.24],
]

function createFakeTimers() {
  let nextTimerId = 1
  const timers = new Map()

  return {
    schedule(callback, delayMs = 0) {
      const timerId = nextTimerId
      nextTimerId += 1
      timers.set(timerId, { callback, cancelled: false, delayMs })
      return timerId
    },
    clear(timerId) {
      const timer = timers.get(timerId)

      if (timer) {
        timer.cancelled = true
      }
    },
    runAll({ includeCancelled = false } = {}) {
      const pendingTimers = [...timers.values()]
      timers.clear()
      pendingTimers.forEach((timer) => {
        if (includeCancelled || !timer.cancelled) {
          timer.callback()
        }
      })
    },
    entries() {
      return [...timers.values()]
    },
  }
}

function createFakeMap() {
  const operations = []

  return {
    operations,
    fitBounds(routeName) {
      operations.push(`fit:${routeName}`)
    },
    easeTo(routeName) {
      operations.push(`follow:${routeName}`)
    },
    jumpTo(routeName) {
      operations.push(`jump:${routeName}`)
    },
    stop() {
      operations.push('stop')
    },
  }
}

function createCameraWorkHarness() {
  const timers = createFakeTimers()
  const map = createFakeMap()
  const manager = createSoloCameraWorkManager({
    scheduleTimer: (callback) => timers.schedule(callback),
    clearTimer: (timerId) => timers.clear(timerId),
    getMap: () => map,
  })

  return { manager, map, timers }
}

function createCameraHookMap() {
  const operations = []
  const cameraApiCalls = []
  let zoom = 17.5

  return {
    operations,
    cameraApiCalls,
    fitBounds(bounds, options, eventData) {
      cameraApiCalls.push('fitBounds')
      operations.push({ type: 'fit', bounds, options, eventData })
    },
    easeTo(options, eventData) {
      cameraApiCalls.push('easeTo')
      operations.push({ type: 'ease', options, eventData })
    },
    jumpTo(options, eventData) {
      cameraApiCalls.push('jumpTo')
      operations.push({ type: 'jump', options, eventData })
    },
    stop() {
      cameraApiCalls.push('stop')
      operations.push({ type: 'stop' })
    },
    getBearing() {
      cameraApiCalls.push('getBearing')
      return 0
    },
    getZoom() {
      cameraApiCalls.push('getZoom')
      return zoom
    },
    setZoom(nextZoom) {
      zoom = nextZoom
    },
    getContainer() {
      cameraApiCalls.push('getContainer')
      return { closest: () => null }
    },
  }
}

async function withCameraHookRuntime(callback, {
  prefersReducedMotion = false,
} = {}) {
  const originalWindow = globalThis.window
  const timers = createFakeTimers()
  globalThis.window = {
    setTimeout: (timerCallback, delayMs) =>
      timers.schedule(timerCallback, delayMs),
    clearTimeout: (timerId) => timers.clear(timerId),
    matchMedia: () => ({
      matches: prefersReducedMotion,
      addEventListener() {},
      removeEventListener() {},
    }),
  }

  try {
    await callback({ timers })
  } finally {
    globalThis.window = originalWindow
  }
}

function CameraHookHarness({ options, capture }) {
  capture(useMapLibreSoloCamera(options))
  return null
}

async function mountCameraHook(options) {
  let current
  let root
  const render = (nextOptions) => React.createElement(CameraHookHarness, {
    options: nextOptions,
    capture: (value) => { current = value },
  })

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

function cameraOptions(map, channel, overrides = {}) {
  return {
    mapRef: { current: map },
    playerPosition: { lat: 28.6, lon: 77.2 },
    pendingDestination: null,
    routeCoordinates: [],
    isMoving: false,
    subscribeToNavigationFrames: channel.subscribe,
    ...overrides,
  }
}

function navigationFrame({
  routeRevision = 1,
  navigationStartKind = SOLO_NAVIGATION_START_KINDS.FRESH,
  position = { lat: 28.6, lon: 77.2 },
  lookAheadPosition = { lat: 28.605, lon: 77.205 },
  progress = 0,
  isMoving = false,
  timestampMs = 100,
} = {}) {
  return {
    routeRevision,
    navigationStartKind,
    position,
    lookAheadPosition,
    bearingDegrees: 45,
    lookAheadDistanceMeters: 40,
    distanceTraveledMeters: progress * 1_000,
    distanceRemainingMeters: (1 - progress) * 1_000,
    totalDistanceMeters: 1_000,
    speedMetersPerSecond: 80,
    progress,
    isMoving,
    timestampMs,
  }
}

function prepareDestination(
  currentDestination,
  routeCoordinates,
  pendingDestination = null,
) {
  return transitionSoloNavigationDestination(currentDestination, {
    type: SOLO_NAVIGATION_DESTINATION_EVENTS.ROUTE_PREPARED,
    routeCoordinates,
    pendingDestination,
  })
}

function applyNavigationFrame(
  currentDestination,
  navigationFrame,
  previousFrame = null,
) {
  return transitionSoloNavigationDestination(currentDestination, {
    type: SOLO_NAVIGATION_DESTINATION_EVENTS.NAVIGATION_FRAME,
    navigationFrame,
    previousFrame,
  })
}

test('clearing a route invalidates scheduled overview follow work', () => {
  const { manager, map, timers } = createCameraWorkHarness()
  const routeRevision = manager.getRevision()

  map.fitBounds('A')
  manager.schedule(() => map.easeTo('A'), 240, routeRevision)
  manager.invalidate({ stopMap: true })

  // Exercise the callback even though clearTimer marked it cancelled. The
  // generation check must independently keep stale work harmless.
  timers.runAll({ includeCancelled: true })

  assert.deepEqual(map.operations, ['fit:A', 'stop'])
})

test('route replacement permits only the replacement camera callback', () => {
  const { manager, map, timers } = createCameraWorkHarness()
  const routeARevision = manager.getRevision()

  map.fitBounds('A')
  manager.schedule(() => map.easeTo('A'), 240, routeARevision)

  manager.invalidate({ stopMap: true })
  const routeBRevision = manager.getRevision()
  map.fitBounds('B')
  manager.schedule(() => map.easeTo('B'), 240, routeBRevision)

  timers.runAll({ includeCancelled: true })

  assert.deepEqual(map.operations, [
    'fit:A',
    'stop',
    'fit:B',
    'follow:B',
  ])
})

test('teardown removes subscriptions and invalidates camera timers', () => {
  const { manager, map, timers } = createCameraWorkHarness()
  const channel = createNavigationFrameChannel()
  const receivedFrames = []
  const unsubscribe = channel.subscribe((frame) => {
    receivedFrames.push(frame)
    map.jumpTo('frame')
  })
  const operationRevision = manager.getRevision()

  manager.schedule(() => map.easeTo('scheduled'), 240, operationRevision)

  unsubscribe()
  manager.invalidate({ stopMap: true })
  channel.publish({ routeRevision: 1 })
  timers.runAll({ includeCancelled: true })

  assert.deepEqual(receivedFrames, [])
  assert.deepEqual(map.operations, ['stop'])
})

test('navigation frame subscribers replay complete route-scoped metadata', () => {
  const channel = createNavigationFrameChannel()
  const receivedFrames = []

  channel.publish({
    routeRevision: 4,
    navigationStartKind: SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
  })
  const unsubscribe = channel.subscribe((frame) => {
    receivedFrames.push({
      routeRevision: frame.routeRevision,
      navigationStartKind: frame.navigationStartKind,
    })
  })
  channel.publish({
    routeRevision: 5,
    navigationStartKind: SOLO_NAVIGATION_START_KINDS.FRESH,
  })
  unsubscribe()
  channel.publish({
    routeRevision: 6,
    navigationStartKind: SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
  })

  assert.deepEqual(receivedFrames, [
    {
      routeRevision: 4,
      navigationStartKind: SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
    },
    {
      routeRevision: 5,
      navigationStartKind: SOLO_NAVIGATION_START_KINDS.FRESH,
    },
  ])
})

test('recovered active MAP enters FOLLOW at its reconstructed near-complete frame', async () => {
  await withCameraHookRuntime(async ({ timers }) => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredFrame = navigationFrame({
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      position: { lat: 28.6195, lon: 77.239 },
      lookAheadPosition: { lat: 28.62, lon: 77.24 },
      progress: 0.995,
      isMoving: true,
      timestampMs: 5_000,
    })

    try {
      await act(async () => hook.current.handleMapLoad())
      await act(async () => {
        channel.publish({ ...recoveredFrame, isMoving: false })
        channel.publish(recoveredFrame)
      })
      await hook.update({
        ...baseOptions,
        playerPosition: recoveredFrame.position,
        routeCoordinates: ROUTE_B,
        isMoving: true,
      })

      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FOLLOW)
      assert.equal(
        map.operations.some((operation) => operation.type === 'fit'),
        false,
      )
      const follow = map.operations.findLast(
        (operation) => operation.type === 'jump',
      )
      assert.ok(follow)
      assert.ok(follow.options.center[1] > recoveredFrame.position.lat)
      assert.ok(follow.options.center[1] > 28.619)
      assert.equal(timers.entries().length, 0)
    } finally {
      await hook.unmount()
    }
  })
})

test('a recovered frame before map load uses zero map APIs then enters FOLLOW', async () => {
  await withCameraHookRuntime(async () => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredFrame = navigationFrame({
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      position: { lat: 28.608, lon: 77.208 },
      lookAheadPosition: { lat: 28.61, lon: 77.21 },
      progress: 0.6,
      isMoving: true,
    })

    try {
      await act(async () => {
        channel.publish({ ...recoveredFrame, isMoving: false })
        channel.publish(recoveredFrame)
      })
      await hook.update({
        ...baseOptions,
        playerPosition: recoveredFrame.position,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      await act(async () => hook.current.handleFollowZoomStart({
        type: 'wheel',
        originalEvent: { type: 'wheel' },
      }))
      await act(async () => hook.current.handleFollowZoomEnd({
        type: 'zoomend',
        originalEvent: { type: 'wheel' },
      }))
      await act(async () => hook.current.handleCameraInteraction({
        type: 'dragstart',
        originalEvent: { type: 'mousedown' },
      }))
      assert.deepEqual(map.cameraApiCalls, [])

      await act(async () => hook.current.handleMapLoad())
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FOLLOW)
      assert.deepEqual(map.cameraApiCalls, ['getBearing', 'jumpTo'])
      assert.equal(
        map.operations.filter((operation) => operation.type === 'jump').length,
        1,
      )
      assert.equal(
        map.operations.some((operation) => operation.type === 'fit'),
        false,
      )
    } finally {
      await hook.unmount()
    }
  })
})

test('a fresh route before map load defers APIs then keeps overview and follow', async () => {
  await withCameraHookRuntime(async ({ timers }) => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const freshFrame = navigationFrame({
      navigationStartKind: SOLO_NAVIGATION_START_KINDS.FRESH,
      isMoving: false,
    })

    try {
      await act(async () => {
        channel.publish(freshFrame)
        channel.publish({
          ...freshFrame,
          isMoving: true,
          timestampMs: 150,
        })
      })
      await hook.update({
        ...baseOptions,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      assert.deepEqual(map.cameraApiCalls, [])

      await act(async () => hook.current.handleMapLoad())
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.OVERVIEW)
      assert.deepEqual(map.cameraApiCalls, [
        'getBearing',
        'stop',
        'getContainer',
        'fitBounds',
      ])
      assert.equal(timers.entries()[0].delayMs, 240)

      await act(async () => timers.runAll())
      await act(async () => channel.publish({
        ...freshFrame,
        isMoving: true,
        timestampMs: 200,
      }))
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FOLLOW)
      assert.equal(
        map.operations.some((operation) => operation.type === 'ease'),
        true,
      )
      assert.equal(
        map.operations.some((operation) => operation.type === 'jump'),
        true,
      )
    } finally {
      await hook.unmount()
    }
  })
})

test('a recovered pre-load frame cannot affect its fresh replacement', async () => {
  await withCameraHookRuntime(async ({ timers }) => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredA = navigationFrame({
      routeRevision: 1,
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      progress: 0.5,
      isMoving: true,
    })
    const freshB = navigationFrame({
      routeRevision: 2,
      navigationStartKind: SOLO_NAVIGATION_START_KINDS.FRESH,
      position: { lat: 28.61, lon: 77.21 },
      lookAheadPosition: { lat: 28.62, lon: 77.24 },
      isMoving: false,
    })

    try {
      await act(async () => {
        channel.publish({ ...recoveredA, isMoving: false })
        channel.publish(recoveredA)
      })
      await hook.update({
        ...baseOptions,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      await act(async () => channel.publish(freshB))
      await hook.update({
        ...baseOptions,
        playerPosition: freshB.position,
        routeCoordinates: ROUTE_B,
        isMoving: false,
      })
      assert.deepEqual(map.cameraApiCalls, [])

      await act(async () => hook.current.handleMapLoad())
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.OVERVIEW)
      assert.deepEqual(hook.current.activeNavigationDestination, {
        lat: ROUTE_B.at(-1)[0],
        lon: ROUTE_B.at(-1)[1],
      })
      assert.equal(
        map.operations.filter((operation) => operation.type === 'fit').length,
        1,
      )
      assert.equal(
        map.operations.some((operation) => operation.type === 'jump'),
        false,
      )

      const apiCallCount = map.cameraApiCalls.length
      await act(async () => channel.publish({
        ...recoveredA,
        timestampMs: 999,
      }))
      assert.equal(map.cameraApiCalls.length, apiCallCount)

      await act(async () => timers.runAll())
      await act(async () => channel.publish({
        ...freshB,
        isMoving: true,
        timestampMs: 1_000,
      }))
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FOLLOW)
    } finally {
      await hook.unmount()
    }
  })
})

test('fresh and recovered-ROUTING results retain overview after recovered A', async () => {
  await withCameraHookRuntime(async ({ timers }) => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredA = navigationFrame({
      routeRevision: 1,
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      progress: 0.5,
      isMoving: true,
    })

    try {
      await act(async () => hook.current.handleMapLoad())
      await act(async () => {
        channel.publish({ ...recoveredA, isMoving: false })
        channel.publish(recoveredA)
      })
      await hook.update({
        ...baseOptions,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      assert.equal(
        map.operations.some((operation) => operation.type === 'fit'),
        false,
      )

      const freshB = navigationFrame({
        routeRevision: 2,
        navigationStartKind: SOLO_NAVIGATION_START_KINDS.FRESH,
        position: { lat: 28.61, lon: 77.21 },
        lookAheadPosition: { lat: 28.62, lon: 77.24 },
        isMoving: true,
      })
      await act(async () => channel.publish(freshB))
      await hook.update({
        ...baseOptions,
        playerPosition: freshB.position,
        routeCoordinates: ROUTE_B,
        isMoving: true,
      })

      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.OVERVIEW)
      assert.equal(
        map.operations.filter((operation) => operation.type === 'fit').length,
        1,
      )
      assert.equal(timers.entries()[0].delayMs, 240)
    } finally {
      await hook.unmount()
    }
  })
})

test('recovered CHASE FOLLOW detaches to FREE and resumes at the latest frame', async () => {
  await withCameraHookRuntime(async ({ timers }) => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredChase = navigationFrame({
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      progress: 0.4,
      isMoving: true,
    })

    try {
      await act(async () => hook.current.handleMapLoad())
      await act(async () => {
        channel.publish({ ...recoveredChase, isMoving: false })
        channel.publish(recoveredChase)
      })
      await hook.update({
        ...baseOptions,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      await act(async () => hook.current.handleCameraInteraction({
        type: 'dragstart',
        originalEvent: { type: 'mousedown' },
      }))
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FREE)

      const latestFrame = navigationFrame({
        navigationStartKind:
          SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
        position: { lat: 28.609, lon: 77.209 },
        lookAheadPosition: { lat: 28.61, lon: 77.21 },
        progress: 0.8,
        isMoving: true,
        timestampMs: 200,
      })
      const jumpCount = map.operations.filter(
        (operation) => operation.type === 'jump',
      ).length
      await act(async () => channel.publish(latestFrame))
      assert.equal(
        map.operations.filter((operation) => operation.type === 'jump').length,
        jumpCount,
      )

      await act(async () => hook.current.resumeFollow())
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FOLLOW)
      const resumed = map.operations.findLast(
        (operation) => operation.type === 'ease',
      )
      assert.ok(resumed.options.center[1] > latestFrame.position.lat)
      await act(async () => timers.runAll())

      map.setZoom(20)
      await act(async () => hook.current.handleFollowZoomStart({
        type: 'wheel',
        originalEvent: { type: 'wheel' },
      }))
      await act(async () => hook.current.handleFollowZoomEnd({
        type: 'zoomend',
        originalEvent: { type: 'wheel' },
      }))
      assert.equal(hook.current.cameraMode, SOLO_CAMERA_MODES.FOLLOW)
      assert.equal(
        map.operations.findLast((operation) => operation.type === 'jump')
          .options.zoom,
        SOLO_FOLLOW_MAX_ZOOM,
      )
    } finally {
      await hook.unmount()
    }
  })
})

test('recovered FOLLOW uses the reduced-motion positional profile', async () => {
  await withCameraHookRuntime(async () => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredFrame = navigationFrame({
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      progress: 0.7,
      isMoving: true,
    })

    try {
      await act(async () => hook.current.handleMapLoad())
      await act(async () => {
        channel.publish({ ...recoveredFrame, isMoving: false })
        channel.publish(recoveredFrame)
      })
      await hook.update({
        ...baseOptions,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      const follow = map.operations.findLast(
        (operation) => operation.type === 'jump',
      )
      assert.equal(hook.current.prefersReducedMotion, true)
      assert.equal(follow.options.pitch, 0)
      assert.equal(follow.options.bearing, 0)
      assert.equal(
        map.operations.some((operation) => operation.type === 'fit'),
        false,
      )
    } finally {
      await hook.unmount()
    }
  }, { prefersReducedMotion: true })
})

test('stale recovered camera work cannot manipulate its fresh replacement', async () => {
  await withCameraHookRuntime(async ({ timers }) => {
    const channel = createNavigationFrameChannel()
    const map = createCameraHookMap()
    const baseOptions = cameraOptions(map, channel)
    const hook = await mountCameraHook(baseOptions)
    const recoveredA = navigationFrame({
      routeRevision: 1,
      navigationStartKind:
        SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
      progress: 0.5,
      isMoving: true,
    })

    try {
      await act(async () => hook.current.handleMapLoad())
      await act(async () => {
        channel.publish({ ...recoveredA, isMoving: false })
        channel.publish(recoveredA)
      })
      await hook.update({
        ...baseOptions,
        routeCoordinates: ROUTE_A,
        isMoving: true,
      })
      await act(async () => hook.current.handleCameraInteraction({
        type: 'dragstart',
        originalEvent: { type: 'mousedown' },
      }))
      await act(async () => hook.current.resumeFollow())

      const freshB = navigationFrame({
        routeRevision: 2,
        position: { lat: 28.61, lon: 77.21 },
        lookAheadPosition: { lat: 28.62, lon: 77.24 },
      })
      await act(async () => channel.publish(freshB))
      await hook.update({
        ...baseOptions,
        playerPosition: freshB.position,
        routeCoordinates: ROUTE_B,
        isMoving: false,
      })
      const replacementIndex = map.operations.findLastIndex(
        (operation) => operation.type === 'fit',
      )
      await act(async () => timers.runAll({ includeCancelled: true }))
      await act(async () => channel.publish({
        ...recoveredA,
        timestampMs: 999,
      }))

      const replacementOperations = map.operations.slice(replacementIndex + 1)
      assert.equal(
        replacementOperations.filter(
          (operation) => operation.type === 'ease',
        ).length,
        1,
      )
      assert.equal(
        replacementOperations.some((operation) =>
          operation.type === 'jump' &&
          operation.options.center[1] < freshB.position.lat),
        false,
      )
    } finally {
      await hook.unmount()
    }
  })
})

test('ordinary and chase destinations clear when navigation completes', () => {
  const navigationCases = [
    {
      name: 'ordinary map route',
      routeCoordinates: ROUTE_A,
      pendingDestination: { lat: 28.611, lon: 77.211 },
      expectedDestination: { lat: 28.611, lon: 77.211 },
    },
    {
      name: 'Pokémon chase route',
      routeCoordinates: ROUTE_B,
      pendingDestination: null,
      expectedDestination: { lat: 28.62, lon: 77.24 },
    },
  ]

  for (const navigationCase of navigationCases) {
    let destination = prepareDestination(
      null,
      navigationCase.routeCoordinates,
      navigationCase.pendingDestination,
    )
    const movingFrame = { isMoving: true, progress: 0.5 }

    assert.deepEqual(
      destination,
      navigationCase.expectedDestination,
      navigationCase.name,
    )
    destination = applyNavigationFrame(destination, movingFrame)
    assert.ok(destination)
    destination = applyNavigationFrame(
      destination,
      { isMoving: false, progress: 1 },
      movingFrame,
    )
    assert.equal(destination, null)
  }
})

test('prelude cancellation clears its destination', () => {
  let destination = prepareDestination(null, ROUTE_A)

  destination = transitionSoloNavigationDestination(destination, {
    type: SOLO_NAVIGATION_DESTINATION_EVENTS.ROUTE_CLEARED,
  })

  assert.equal(destination, null)
})

test('route replacement swaps the active destination', () => {
  let destination = prepareDestination(null, ROUTE_A)

  destination = prepareDestination(destination, ROUTE_B)

  assert.deepEqual(destination, { lat: 28.62, lon: 77.24 })
})

test('FREE mode retains the destination while gameplay movement continues', () => {
  let destination = prepareDestination(null, ROUTE_A)
  let cameraMode = transitionSoloCameraMode(
    SOLO_CAMERA_MODES.FOLLOW,
    SOLO_CAMERA_EVENTS.USER_INTERACTION,
  )

  destination = applyNavigationFrame(destination, {
    isMoving: true,
    progress: 0.75,
  })

  assert.equal(cameraMode, SOLO_CAMERA_MODES.FREE)
  assert.deepEqual(destination, { lat: 28.61, lon: 77.21 })
})

function applyCameraInteraction(cameraMode, event) {
  if (
    isSoloCameraUserInteraction(event) &&
    getSoloCameraInteractionType(event) ===
      SOLO_CAMERA_INTERACTION_TYPES.DETACH
  ) {
    return transitionSoloCameraMode(
      cameraMode,
      SOLO_CAMERA_EVENTS.USER_INTERACTION,
    )
  }

  return cameraMode
}

test('programmatic camera events and pure user zoom stay FOLLOW', () => {
  let cameraMode = SOLO_CAMERA_MODES.FOLLOW

  for (const operation of ['fit', 'ease', 'jump']) {
    cameraMode = applyCameraInteraction(cameraMode, {
      operation,
      soloCameraOperation: SOLO_CAMERA_PROGRAMMATIC_EVENT,
    })
  }

  const zoomEvents = [
    { type: 'wheel', originalEvent: { type: 'wheel' } },
    { type: 'zoomstart', originalEvent: { type: 'click' } },
    {
      type: 'movestart',
      originalEvent: { type: 'keydown', key: '+' },
    },
    {
      type: 'movestart',
      originalEvent: { type: 'keydown', key: '-' },
    },
    { type: 'zoomstart', originalEvent: { type: 'touchmove' } },
  ]

  zoomEvents.forEach((event) => {
    assert.equal(
      getSoloCameraInteractionType(event),
      SOLO_CAMERA_INTERACTION_TYPES.ZOOM,
    )
    cameraMode = applyCameraInteraction(cameraMode, event)
  })

  assert.equal(cameraMode, SOLO_CAMERA_MODES.FOLLOW)
})

test('real pan and manual rotation detach FOLLOW into FREE', () => {
  for (const event of [
    { type: 'dragstart', originalEvent: { type: 'mousedown' } },
    { type: 'rotatestart', originalEvent: { type: 'pointerdown' } },
    {
      type: 'movestart',
      originalEvent: { type: 'keydown', key: 'ArrowLeft' },
    },
  ]) {
    assert.equal(
      getSoloCameraInteractionType(event),
      SOLO_CAMERA_INTERACTION_TYPES.DETACH,
    )
    assert.equal(
      applyCameraInteraction(SOLO_CAMERA_MODES.FOLLOW, event),
      SOLO_CAMERA_MODES.FREE,
    )
  }
})

test('follow zoom override is reused, reset by a new route, and safe on resume', () => {
  const navigationFrame = {
    position: { lat: 28.6, lon: 77.2 },
    lookAheadPosition: { lat: 28.61, lon: 77.2 },
    bearingDegrees: 0,
    timestampMs: 100,
  }
  let followZoom = transitionSoloFollowZoom(null, {
    type: SOLO_FOLLOW_ZOOM_EVENTS.USER_ZOOMED,
    zoom: 20,
  })

  assert.equal(followZoom, SOLO_FOLLOW_MAX_ZOOM)
  assert.equal(
    createSoloFollowCameraOptions(navigationFrame, { followZoom }).zoom,
    SOLO_FOLLOW_MAX_ZOOM,
  )

  const resumedMode = transitionSoloCameraMode(
    SOLO_CAMERA_MODES.FREE,
    SOLO_CAMERA_EVENTS.RESUME_FOLLOW,
  )
  assert.equal(resumedMode, SOLO_CAMERA_MODES.FOLLOW)
  assert.equal(
    createSoloFollowCameraOptions(navigationFrame, { followZoom }).zoom,
    SOLO_FOLLOW_MAX_ZOOM,
  )

  followZoom = transitionSoloFollowZoom(followZoom, {
    type: SOLO_FOLLOW_ZOOM_EVENTS.USER_ZOOMED,
    zoom: 10,
  })
  assert.equal(followZoom, SOLO_FOLLOW_MIN_ZOOM)

  followZoom = transitionSoloFollowZoom(followZoom, {
    type: SOLO_FOLLOW_ZOOM_EVENTS.ROUTE_PREPARED,
  })
  assert.equal(followZoom, null)
  assert.equal(
    createSoloFollowCameraOptions(navigationFrame, { followZoom }).zoom,
    DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE.zoom,
  )
})

test('FREE exploration retains the normal map zoom range', () => {
  const freeExplorationZoom = 20
  const zoomEvent = { type: 'wheel', originalEvent: { type: 'wheel' } }
  const cameraMode = applyCameraInteraction(
    SOLO_CAMERA_MODES.FREE,
    zoomEvent,
  )

  assert.equal(cameraMode, SOLO_CAMERA_MODES.FREE)
  assert.ok(freeExplorationZoom > SOLO_FOLLOW_MAX_ZOOM)
  assert.equal(freeExplorationZoom, 20)
})

test('default FOLLOW profile is closer than OVERVIEW and looks farther ahead', () => {
  const playerLatitude = 28.6
  const lookAheadLatitude = 28.61
  const options = createSoloFollowCameraOptions({
    position: { lat: playerLatitude, lon: 77.2 },
    lookAheadPosition: { lat: lookAheadLatitude, lon: 77.2 },
    bearingDegrees: 0,
    timestampMs: 100,
  })

  assert.ok(options.zoom > SOLO_OVERVIEW_MAX_ZOOM)
  assert.equal(options.zoom, 17.5)
  assert.equal(options.pitch, 55)
  assert.ok(
    options.center[1] >
      playerLatitude + (lookAheadLatitude - playerLatitude) * 0.5,
  )

  const highSpeedOptions = createSoloFollowCameraOptions({
    position: { lat: playerLatitude, lon: 77.2 },
    lookAheadPosition: { lat: 28.62, lon: 77.2 },
    bearingDegrees: 0,
    speedMetersPerSecond: 700,
    timestampMs: 100,
  })
  assert.equal(highSpeedOptions.zoom, options.zoom)
})
