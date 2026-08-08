import assert from 'node:assert/strict'
import test from 'node:test'
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
import { createSoloCameraWorkManager } from '../src/components/maplibre/useMapLibreSoloCamera.js'
import { createNavigationFrameChannel } from '../src/hooks/navigationFrameChannel.js'

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
    schedule(callback) {
      const timerId = nextTimerId
      nextTimerId += 1
      timers.set(timerId, { callback, cancelled: false })
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

test('navigation frame subscribers receive latest and stop after unsubscribe', () => {
  const channel = createNavigationFrameChannel()
  const receivedRevisions = []

  channel.publish({ routeRevision: 4 })
  const unsubscribe = channel.subscribe((frame) => {
    receivedRevisions.push(frame.routeRevision)
  })
  channel.publish({ routeRevision: 5 })
  unsubscribe()
  channel.publish({ routeRevision: 6 })

  assert.deepEqual(receivedRevisions, [4, 5])
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
