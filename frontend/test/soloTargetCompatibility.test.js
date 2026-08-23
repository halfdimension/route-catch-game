import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SOLO_TARGET_ROUTE_ENDPOINT_TOLERANCE_METERS,
  SOLO_TARGET_SPAWN_MAX_ATTEMPTS,
  SoloTargetSpawnError,
  SoloTargetSpawnStaleError,
  createSoloTarget,
} from '../src/hooks/useTargetSpawner.js'
import { getRouteDistanceMeters } from '../src/hooks/useRouteAnimation.js'
import { TRAVEL_MODES } from '../src/config/travelMode.js'

const PLAYER = Object.freeze({ lat: 28.55, lon: 77.26 })
const SNAPPED = Object.freeze({ lat: 28.551, lon: 77.271 })

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function usableRoute(destination = SNAPPED) {
  return {
    coordinates: [
      [PLAYER.lat, PLAYER.lon],
      [destination.lat, destination.lon],
    ],
    distanceMeters: 1400,
    durationSeconds: 240,
  }
}

function targetOptions(overrides = {}) {
  return {
    travelMode: TRAVEL_MODES.CAR,
    maxAttempts: 1,
    nearestRoadPoint: async () => SNAPPED,
    routeBetween: async (_source, destination) => usableRoute(destination),
    ...overrides,
  }
}

async function createTarget(options) {
  return createSoloTarget(PLAYER, 80, 1, () => 10_000, options)
}

test('raw candidate is snapped and published only after a usable route succeeds', async () => {
  let rawCandidate
  let routedSource
  let routedDestination
  const target = await createTarget(targetOptions({
    travelMode: TRAVEL_MODES.WALKING,
    nearestRoadPoint: async (rawPoint, options) => {
      rawCandidate = rawPoint
      assert.equal(options.travelMode, TRAVEL_MODES.WALKING)
      return SNAPPED
    },
    routeBetween: async (source, destination, options) => {
      routedSource = source
      routedDestination = destination
      assert.equal(options.travelMode, TRAVEL_MODES.WALKING)
      return usableRoute(destination)
    },
  }))

  assert.notDeepEqual(rawCandidate, SNAPPED)
  assert.deepEqual(routedSource, PLAYER)
  assert.deepEqual(routedDestination, SNAPPED)
  assert.deepEqual({ lat: target.lat, lon: target.lon }, SNAPPED)
  assert.deepEqual(
    { lat: target.rawLat, lon: target.rawLon },
    rawCandidate,
  )
  assert.equal(target.snappedToRoad, true)
  assert.equal(target.routeDistanceMeters, 1400)
})

test('nearest failure never returns or publishes the raw candidate', async () => {
  let routeCalls = 0
  const published = []
  await assert.rejects(
    createTarget(targetOptions({
      nearestRoadPoint: async () => {
        throw new Error('nearest unavailable')
      },
      routeBetween: async () => {
        routeCalls += 1
        return usableRoute()
      },
    })).then((target) => published.push(target)),
    SoloTargetSpawnError,
  )
  assert.deepEqual(published, [])
  assert.equal(routeCalls, 0)
})

test('route failure never returns or publishes the snapped candidate', async () => {
  const published = []
  await assert.rejects(
    createTarget(targetOptions({
      routeBetween: async () => {
        throw new Error('route unavailable')
      },
    })).then((target) => published.push(target)),
    SoloTargetSpawnError,
  )
  assert.deepEqual(published, [])
})

test('malformed route never returns or publishes the snapped candidate', async () => {
  const published = []
  await assert.rejects(
    createTarget(targetOptions({
      routeBetween: async () => ({
        coordinates: [[PLAYER.lat, PLAYER.lon]],
        distanceMeters: 1400,
      }),
    })).then((target) => published.push(target)),
    SoloTargetSpawnError,
  )
  assert.deepEqual(published, [])
})

test('route ending far from the snapped candidate cannot publish it', async () => {
  const published = []
  await assert.rejects(
    createTarget(targetOptions({
      routeBetween: async () => ({
        coordinates: [
          [PLAYER.lat, PLAYER.lon],
          [SNAPPED.lat + 0.01, SNAPPED.lon],
        ],
        distanceMeters: 1400,
        durationSeconds: 240,
      }),
    })).then((target) => published.push(target)),
    SoloTargetSpawnError,
  )
  assert.deepEqual(published, [])
})

test('route endpoint within the provider-neutral tolerance publishes the snapped candidate', async () => {
  const endpoint = [SNAPPED.lat + 0.0001, SNAPPED.lon]
  const target = await createTarget(targetOptions({
    routeBetween: async () => ({
      coordinates: [
        [PLAYER.lat, PLAYER.lon],
        endpoint,
      ],
      distanceMeters: 1400,
      durationSeconds: 240,
    }),
  }))

  assert.ok(
    getRouteDistanceMeters(endpoint, [SNAPPED.lat, SNAPPED.lon]) <=
      SOLO_TARGET_ROUTE_ENDPOINT_TOLERANCE_METERS,
  )
  assert.deepEqual({ lat: target.lat, lon: target.lon }, SNAPPED)
})

test('positive route metadata cannot hide zero-length measured geometry', async () => {
  const published = []
  await assert.rejects(
    createTarget(targetOptions({
      routeBetween: async () => ({
        coordinates: [
          [SNAPPED.lat, SNAPPED.lon],
          [SNAPPED.lat, SNAPPED.lon],
        ],
        distanceMeters: 1400,
        durationSeconds: 240,
      }),
    })).then((target) => published.push(target)),
    SoloTargetSpawnError,
  )
  assert.deepEqual(published, [])
})

for (const travelMode of Object.values(TRAVEL_MODES)) {
  test(`${travelMode} is captured once and shared by nearest and route`, async () => {
    const calls = []
    await createTarget(targetOptions({
      travelMode,
      nearestRoadPoint: async (_point, options) => {
        calls.push(['nearest', options.travelMode])
        return SNAPPED
      },
      routeBetween: async (_source, destination, options) => {
        calls.push(['route', options.travelMode])
        return usableRoute(destination)
      },
    }))
    assert.deepEqual(calls, [
      ['nearest', travelMode],
      ['route', travelMode],
    ])
  })
}

test('stale nearest response stops before route and cannot return a target', async () => {
  const nearest = deferred()
  let current = true
  let routeCalls = 0
  const targetPromise = createTarget(targetOptions({
    isCurrent: () => current,
    nearestRoadPoint: () => nearest.promise,
    routeBetween: async () => {
      routeCalls += 1
      return usableRoute()
    },
  }))

  current = false
  nearest.resolve(SNAPPED)
  await assert.rejects(targetPromise, SoloTargetSpawnStaleError)
  assert.equal(routeCalls, 0)
})

test('stale route response cannot return a target', async () => {
  const route = deferred()
  let current = true
  const targetPromise = createTarget(targetOptions({
    isCurrent: () => current,
    routeBetween: () => route.promise,
  }))

  await Promise.resolve()
  current = false
  route.resolve(usableRoute())
  await assert.rejects(targetPromise, SoloTargetSpawnStaleError)
})

test('bounded retry exhaustion publishes nothing and stops at three attempts', async () => {
  let nearestCalls = 0
  const published = []
  const targetPromise = createTarget(targetOptions({
    maxAttempts: SOLO_TARGET_SPAWN_MAX_ATTEMPTS,
    nearestRoadPoint: async () => {
      nearestCalls += 1
      throw new Error('candidate incompatible')
    },
  })).then((target) => published.push(target))

  await assert.rejects(targetPromise, (error) => {
    assert.ok(error instanceof SoloTargetSpawnError)
    assert.equal(error.attempts, SOLO_TARGET_SPAWN_MAX_ATTEMPTS)
    return true
  })
  assert.equal(nearestCalls, SOLO_TARGET_SPAWN_MAX_ATTEMPTS)
  assert.deepEqual(published, [])
})
