import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPreparedMovementRoute,
  calculateServerClockOffsetMs,
  createServerClockOffsetEstimator,
  decodePolyline6,
  getMovementPlanPosition,
  interpolateRoutePosition,
} from '../src/utils/movementPlanTimeline.js'

const STARTED_AT = '2026-07-18T08:00:00Z'
const STARTED_AT_MS = Date.parse(STARTED_AT)
const STRAIGHT_ROUTE_POLYLINE6 = '???o}@?o}@'

function assertCoordinate(actual, expected, tolerance = 0.0000001) {
  assert.equal(actual.length, 2)
  assert.ok(Math.abs(actual[0] - expected[0]) <= tolerance)
  assert.ok(Math.abs(actual[1] - expected[1]) <= tolerance)
}

function createMovingPlan(overrides = {}) {
  return {
    encodedPolyline6: STRAIGHT_ROUTE_POLYLINE6,
    totalDistanceMeters: 200,
    simulationSpeedMps: 10,
    startedAt: STARTED_AT,
    status: 'MOVING',
    currentPosition: { latitude: 0, longitude: 0 },
    ...overrides,
  }
}

test('decodes known polyline6 geometry into Leaflet coordinate order', () => {
  assert.deepEqual(
    decodePolyline6('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI'),
    [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ],
  )
})

test('precomputes cumulative haversine distances and keeps backend distance', () => {
  const route = buildPreparedMovementRoute(createMovingPlan())

  assert.deepEqual(route.coordinates, [
    [0, 0],
    [0, 0.001],
    [0, 0.002],
  ])
  assert.equal(route.cumulativeDistancesMeters[0], 0)
  assert.ok(Math.abs(route.cumulativeDistancesMeters[1] - 111.194927) < 0.001)
  assert.ok(Math.abs(route.cumulativeDistancesMeters[2] - 222.389853) < 0.001)
  assert.ok(Math.abs(route.measuredTotalDistanceMeters - 222.389853) < 0.001)
  assert.equal(route.backendRouteDistanceMeters, 200)
})

test('interpolates moving plans at start, middle, end, and after completion', () => {
  const plan = createMovingPlan()
  const route = buildPreparedMovementRoute(plan)

  assertCoordinate(
    getMovementPlanPosition(plan, route, STARTED_AT_MS),
    [0, 0],
  )
  assertCoordinate(
    getMovementPlanPosition(plan, route, STARTED_AT_MS + 10000),
    [0, 0.001],
  )
  assertCoordinate(
    getMovementPlanPosition(plan, route, STARTED_AT_MS + 20000),
    [0, 0.002],
  )
  assertCoordinate(
    getMovementPlanPosition(plan, route, STARTED_AT_MS + 120000),
    [0, 0.002],
  )
})

test('a calculation after a hidden 30-second interval jumps to timeline position', () => {
  const plan = createMovingPlan({ totalDistanceMeters: 600 })
  const route = buildPreparedMovementRoute(plan)

  assertCoordinate(
    getMovementPlanPosition(plan, route, STARTED_AT_MS),
    [0, 0],
  )

  // No animation ticks or stored prior-frame position are supplied here.
  assertCoordinate(
    getMovementPlanPosition(plan, route, STARTED_AT_MS + 30000),
    [0, 0.001],
  )
})

test('distance interpolation maps backend route progress onto measured geometry', () => {
  const route = buildPreparedMovementRoute(createMovingPlan({
    totalDistanceMeters: 1000,
  }))

  assertCoordinate(interpolateRoutePosition(route, 250), [0, 0.0005])
  assertCoordinate(interpolateRoutePosition(route, 750), [0, 0.0015])
  assertCoordinate(interpolateRoutePosition(route, 5000), [0, 0.002])
})

test('cancelled movement uses its authoritative final currentPosition', () => {
  const plan = createMovingPlan({
    status: 'CANCELLED',
    currentPosition: { latitude: 12.34, longitude: 56.78 },
  })
  const route = buildPreparedMovementRoute(plan)

  assert.deepEqual(
    getMovementPlanPosition(plan, route, STARTED_AT_MS + 120000),
    [12.34, 56.78],
  )
})

test('completed movement uses the final decoded route coordinate', () => {
  const plan = createMovingPlan({
    status: 'COMPLETED',
    currentPosition: { latitude: 1, longitude: 1 },
  })
  const route = buildPreparedMovementRoute(plan)

  assert.deepEqual(
    getMovementPlanPosition(plan, route, STARTED_AT_MS),
    [0, 0.002],
  )
})

test('calculates and smoothly estimates server clock offset', () => {
  const receiveTimeMs = Date.parse('2026-07-18T08:00:00Z')

  assert.equal(
    calculateServerClockOffsetMs(
      '2026-07-18T08:00:05.000000Z',
      receiveTimeMs,
    ),
    5000,
  )

  const estimator = createServerClockOffsetEstimator({
    smoothingFactor: 0.25,
    maximumAdjustmentMs: 100,
  })

  assert.equal(
    estimator.observe('2026-07-18T08:00:05Z', receiveTimeMs),
    5000,
  )
  assert.equal(estimator.estimateServerNow(receiveTimeMs), receiveTimeMs + 5000)

  // A newer, noisier sample is bounded to a 100 ms adjustment.
  assert.equal(
    estimator.observe(
      '2026-07-18T08:00:07Z',
      receiveTimeMs + 1000,
    ),
    5100,
  )

  // A duplicate delivery with the same server timestamp is ignored rather
  // than interpreted as a new, more delayed clock sample.
  assert.equal(
    estimator.observe(
      '2026-07-18T08:00:07Z',
      receiveTimeMs + 20000,
    ),
    5100,
  )

  // A delayed older timestamp cannot move the estimate backwards.
  assert.equal(
    estimator.observe(
      '2026-07-18T08:00:06Z',
      receiveTimeMs + 10000,
    ),
    5100,
  )
})
