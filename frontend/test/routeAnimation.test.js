import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calculateAnchoredRouteDistanceMeters,
  createRouteMovementAnchor,
  createRouteAnimationPlan,
  createRouteNavigationFrame,
  DEFAULT_ROUTE_NAVIGATION_FRAME_PROFILE,
  getRouteDistanceMeters,
  getRouteLookAheadDistanceMeters,
  reanchorRouteMovement,
  reconstructAnchoredRouteMovement,
  sampleRoutePosition,
} from '../src/hooks/useRouteAnimation.js'
import { SOLO_NAVIGATION_START_KINDS } from '../src/hooks/navigationFrameChannel.js'

const NORTH_ROUTE = [
  [28.6, 77.2],
  [28.6005, 77.2],
  [28.601, 77.2],
]

test('route preprocessing measures cumulative non-zero segments once', () => {
  const plan = createRouteAnimationPlan(NORTH_ROUTE, 7)
  const firstDistance = getRouteDistanceMeters(NORTH_ROUTE[0], NORTH_ROUTE[1])
  const secondDistance = getRouteDistanceMeters(NORTH_ROUTE[1], NORTH_ROUTE[2])

  assert.equal(plan.routeRevision, 7)
  assert.equal(plan.segments.length, 2)
  assert.equal(plan.segments[0].startDistanceMeters, 0)
  assert.ok(Math.abs(plan.segments[0].endDistanceMeters - firstDistance) < 0.001)
  assert.ok(Math.abs(plan.totalDistanceMeters - firstDistance - secondDistance) < 0.001)
})

test('navigation frames expose consistent progress and distance totals', () => {
  const plan = createRouteAnimationPlan(NORTH_ROUTE, 3)
  const traveled = plan.totalDistanceMeters * 0.4
  const frame = createRouteNavigationFrame(plan, traveled, {
    isMoving: true,
    speedMetersPerSecond: 80,
    timestampMs: 1234,
  })

  assert.equal(frame.routeRevision, 3)
  assert.ok(Math.abs(frame.progress - 0.4) < 1e-10)
  assert.ok(Math.abs(frame.distanceTraveledMeters - traveled) < 1e-10)
  assert.ok(
    Math.abs(
      frame.distanceRemainingMeters - plan.totalDistanceMeters * 0.6,
    ) < 1e-10,
  )
  assert.equal(frame.totalDistanceMeters, plan.totalDistanceMeters)
  assert.equal(frame.isMoving, true)
  assert.equal(
    frame.navigationStartKind,
    SOLO_NAVIGATION_START_KINDS.FRESH,
  )
  assert.equal(frame.timestampMs, 1234)
})

test('duplicate coordinates are ignored without corrupting sampling', () => {
  const plan = createRouteAnimationPlan([
    NORTH_ROUTE[0],
    NORTH_ROUTE[0],
    NORTH_ROUTE[1],
    NORTH_ROUTE[1],
    NORTH_ROUTE[2],
  ])
  const midpoint = sampleRoutePosition(plan, plan.totalDistanceMeters / 2)

  assert.equal(plan.segments.length, 2)
  assert.ok(Number.isFinite(midpoint.lat))
  assert.ok(Number.isFinite(midpoint.lon))
})

test('one-point and all-duplicate routes complete at their final position', () => {
  for (const coordinates of [
    [[28.6, 77.2]],
    [[28.6, 77.2], [28.6, 77.2]],
  ]) {
    const plan = createRouteAnimationPlan(coordinates, 2)
    const frame = createRouteNavigationFrame(plan, 100, {
      isMoving: true,
      timestampMs: 50,
    })

    assert.equal(plan.totalDistanceMeters, 0)
    assert.deepEqual(frame.position, { lat: 28.6, lon: 77.2 })
    assert.equal(frame.progress, 1)
    assert.equal(frame.distanceTraveledMeters, 0)
    assert.equal(frame.distanceRemainingMeters, 0)
    assert.equal(frame.isMoving, false)
  }
})

test('invalid and empty route geometry is rejected safely', () => {
  assert.equal(createRouteAnimationPlan([]), null)
  assert.equal(createRouteAnimationPlan([[Number.NaN, 77.2]]), null)
  assert.equal(createRouteAnimationPlan([[91, 77.2]]), null)
  assert.equal(createRouteAnimationPlan([[28.6, 181]]), null)
})

test('route completion clamps position, progress, and remaining distance', () => {
  const plan = createRouteAnimationPlan(NORTH_ROUTE)
  const frame = createRouteNavigationFrame(
    plan,
    plan.totalDistanceMeters * 2,
    { isMoving: true },
  )

  assert.deepEqual(frame.position, plan.finalPosition)
  assert.equal(frame.progress, 1)
  assert.equal(frame.distanceTraveledMeters, plan.totalDistanceMeters)
  assert.equal(frame.distanceRemainingMeters, 0)
  assert.equal(frame.isMoving, false)
})

test('replacement plans carry distinct route revisions', () => {
  const first = createRouteAnimationPlan(NORTH_ROUTE, 11)
  const replacement = createRouteAnimationPlan(
    [NORTH_ROUTE[0], [28.6, 77.201]],
    12,
  )

  assert.equal(
    createRouteNavigationFrame(first, 0).routeRevision,
    11,
  )
  assert.equal(
    createRouteNavigationFrame(replacement, 0).routeRevision,
    12,
  )
})

test('look-ahead bearing spans tiny segments instead of using frame delta', () => {
  const tinyNorthboundSegments = Array.from({ length: 31 }, (_, index) => [
    28.6 + index * 0.00001,
    77.2 + (index % 2 === 0 ? 0 : 0.0000001),
  ])
  const plan = createRouteAnimationPlan(tinyNorthboundSegments)
  const frame = createRouteNavigationFrame(
    plan,
    plan.totalDistanceMeters * 0.45,
    { isMoving: true, speedMetersPerSecond: 10 },
  )

  assert.ok(frame.lookAheadPosition.lat > frame.position.lat)
  assert.ok(frame.bearingDegrees < 1 || frame.bearingDegrees > 359)
})

test('speed-aware route look-ahead is stable and bounded', () => {
  const profile = DEFAULT_ROUTE_NAVIGATION_FRAME_PROFILE

  assert.equal(
    getRouteLookAheadDistanceMeters(0),
    profile.minLookAheadMeters,
  )
  assert.equal(
    getRouteLookAheadDistanceMeters(10),
    profile.minLookAheadMeters,
  )
  assert.equal(getRouteLookAheadDistanceMeters(80), 36)
  assert.equal(
    getRouteLookAheadDistanceMeters(1000),
    profile.maxLookAheadMeters,
  )
})

test('short routes cap look-ahead at the destination', () => {
  const shortPlan = createRouteAnimationPlan([
    [28.6, 77.2],
    [28.6, 77.20005],
  ])
  const frame = createRouteNavigationFrame(shortPlan, 0, {
    isMoving: true,
    speedMetersPerSecond: 700,
  })

  assert.equal(frame.lookAheadDistanceMeters, shortPlan.totalDistanceMeters)
  assert.deepEqual(frame.lookAheadPosition, shortPlan.finalPosition)
  assert.ok(
    frame.lookAheadDistanceMeters <
      DEFAULT_ROUTE_NAVIGATION_FRAME_PROFILE.minLookAheadMeters,
  )
})

test('final navigation frame retains a useful look-behind heading', () => {
  const eastboundPlan = createRouteAnimationPlan([
    [28.6, 77.2],
    [28.6, 77.201],
    [28.6, 77.202],
  ])
  const frame = createRouteNavigationFrame(
    eastboundPlan,
    eastboundPlan.totalDistanceMeters,
  )

  assert.ok(Math.abs(frame.bearingDegrees - 90) < 0.1)
  assert.equal(frame.lookAheadDistanceMeters, 0)
  assert.deepEqual(frame.lookAheadPosition, eastboundPlan.finalPosition)
})

test('epoch anchor advances low and high speed across reload time', () => {
  const totalDistanceMeters = 10_000
  const anchor = createRouteMovementAnchor({
    anchorDistanceMeters: 300,
    anchorTimeEpochMs: 1_000_000,
    speedMetersPerSecond: 10,
  })

  assert.equal(
    calculateAnchoredRouteDistanceMeters(anchor, 1_005_000, totalDistanceMeters),
    350,
  )

  const highSpeedAnchor = createRouteMovementAnchor({
    ...anchor,
    speedMetersPerSecond: 700,
  })
  assert.equal(
    calculateAnchoredRouteDistanceMeters(
      highSpeedAnchor,
      1_005_000,
      totalDistanceMeters,
    ),
    3_800,
  )
})

test('epoch anchor clamps route distance and reconstructs completion', () => {
  const plan = createRouteAnimationPlan(NORTH_ROUTE)
  const anchor = createRouteMovementAnchor({
    anchorDistanceMeters: plan.totalDistanceMeters - 1,
    anchorTimeEpochMs: 10_000,
    speedMetersPerSecond: 80,
  })
  const movement = reconstructAnchoredRouteMovement(plan, anchor, 11_000)

  assert.equal(movement.distanceTraveledMeters, plan.totalDistanceMeters)
  assert.equal(movement.isComplete, true)
  assert.deepEqual(movement.position, plan.finalPosition)
})

test('speed change re-anchors at authoritative current distance', () => {
  const plan = createRouteAnimationPlan([
    [28.6, 77.2],
    [28.7, 77.2],
  ])
  const anchor = createRouteMovementAnchor({
    anchorDistanceMeters: 100,
    anchorTimeEpochMs: 20_000,
    speedMetersPerSecond: 10,
  })
  const reanchored = reanchorRouteMovement(plan, anchor, 80, 25_000)

  assert.equal(reanchored.anchorDistanceMeters, 150)
  assert.equal(reanchored.anchorTimeEpochMs, 25_000)
  assert.equal(reanchored.speedMetersPerSecond, 80)
  assert.equal(
    calculateAnchoredRouteDistanceMeters(reanchored, 26_000, plan.totalDistanceMeters),
    230,
  )
})

test('backward wall clock does not move backward or add distance', () => {
  const anchor = createRouteMovementAnchor({
    anchorDistanceMeters: 250,
    anchorTimeEpochMs: 50_000,
    speedMetersPerSecond: 80,
  })

  assert.equal(
    calculateAnchoredRouteDistanceMeters(anchor, 45_000, 1_000),
    250,
  )
  assert.equal(
    calculateAnchoredRouteDistanceMeters(anchor, 55_000, 1_000, {
      minimumDistanceMeters: 800,
    }),
    800,
  )
})

test('future prelude anchor remains in the future after speed change', () => {
  const plan = createRouteAnimationPlan(NORTH_ROUTE)
  const anchor = createRouteMovementAnchor({
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: 100_400,
    speedMetersPerSecond: 80,
  })
  const reanchored = reanchorRouteMovement(plan, anchor, 120, 100_100)

  assert.equal(reanchored.anchorDistanceMeters, 0)
  assert.equal(reanchored.anchorTimeEpochMs, 100_400)
  assert.equal(
    calculateAnchoredRouteDistanceMeters(reanchored, 100_300, plan.totalDistanceMeters),
    0,
  )
})

test('anchored reconstruction retains duplicate and zero-length compatibility', () => {
  const plan = createRouteAnimationPlan([
    NORTH_ROUTE[0],
    NORTH_ROUTE[0],
    NORTH_ROUTE[1],
    NORTH_ROUTE[1],
  ])
  const anchor = createRouteMovementAnchor({
    anchorDistanceMeters: 0,
    anchorTimeEpochMs: 0,
    speedMetersPerSecond: 10,
  })
  const movement = reconstructAnchoredRouteMovement(plan, anchor, 1_000)

  assert.equal(plan.segments.length, 1)
  assert.ok(Number.isFinite(movement.position.lat))
  assert.ok(Number.isFinite(movement.position.lon))
})

test('animation cleanup cancels frame id zero, prelude timers, and stale revisions', () => {
  const animationSource = readFileSync(
    new URL('../src/hooks/useRouteAnimation.js', import.meta.url),
    'utf8',
  )

  assert.match(animationSource, /frameIdRef\.current !== null/)
  assert.match(animationSource, /window\.clearTimeout\(startTimerIdRef\.current\)/)
  assert.match(animationSource, /plan\.routeRevision !== routeRevision/)
  assert.match(animationSource, /mountedRef\.current = false/)
  assert.match(animationSource, /routeRevisionRef\.current \+= 1/)
  assert.match(animationSource, /getEpochTimeMs/)
  assert.match(animationSource, /performance\.now\(\)/)
  assert.doesNotMatch(
    animationSource,
    /distanceTraveledMeters\s*\+=/,
  )
})
