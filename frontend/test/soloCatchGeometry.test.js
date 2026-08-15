import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouteAnimationPlan } from '../src/hooks/useRouteAnimation.js'
import {
  findEarliestSoloRouteCatchDistance,
  getSoloCatchDistanceMeters,
  isSoloTargetCatchableAt,
} from '../src/utils/soloCatchGeometry.js'

const METERS_PER_LATITUDE_DEGREE = 111_195
const PRECISE_METERS_PER_LATITUDE_DEGREE = 111_194.92664455874

function targetAt(lat, lon, expiresAt = 10_000) {
  return { lat, lon, expiresAt }
}

test('shared live predicate is inclusive at 25 m and expiry wins an exact tie', () => {
  const target = targetAt(25 / METERS_PER_LATITUDE_DEGREE, 0)
  const player = { lat: 0, lon: 0 }

  assert.equal(getSoloCatchDistanceMeters(player, target) <= 25.01, true)
  assert.equal(isSoloTargetCatchableAt(player, target, 9_999), true)
  assert.equal(isSoloTargetCatchableAt(player, target, 10_000), false)
})

test('route catch geometry finds a target directly on a route', () => {
  const plan = createRouteAnimationPlan([[0, 0], [0, 0.002]])
  const distance = findEarliestSoloRouteCatchDistance(
    plan,
    targetAt(0, 0.001),
  )

  assert.ok(distance > 80 && distance < 90)
})

test('route catch geometry detects endpoints outside with a middle crossing', () => {
  const plan = createRouteAnimationPlan([[0, -0.001], [0, 0.001]])
  const target = targetAt(0, 0)

  assert.equal(
    getSoloCatchDistanceMeters({ lat: 0, lon: -0.001 }, target) > 25,
    true,
  )
  assert.equal(
    getSoloCatchDistanceMeters({ lat: 0, lon: 0.001 }, target) > 25,
    true,
  )
  assert.notEqual(findEarliestSoloRouteCatchDistance(plan, target), null)
})

test('route catch geometry resolves tangent, start, end, miss, and duplicate points', () => {
  const tangentLatitude = 25 / METERS_PER_LATITUDE_DEGREE
  const duplicatePlan = createRouteAnimationPlan([
    [0, 0],
    [0, 0],
    [0, 0.002],
    [0, 0.002],
  ])
  const tangent = findEarliestSoloRouteCatchDistance(
    duplicatePlan,
    targetAt(tangentLatitude, 0.001),
  )
  const nearStart = findEarliestSoloRouteCatchDistance(
    duplicatePlan,
    targetAt(0, 0.00001),
  )
  const nearEnd = findEarliestSoloRouteCatchDistance(
    duplicatePlan,
    targetAt(0, 0.00199),
  )
  const miss = findEarliestSoloRouteCatchDistance(
    duplicatePlan,
    targetAt(0.001, 0.001),
  )

  assert.notEqual(tangent, null)
  assert.equal(nearStart, 0)
  assert.ok(nearEnd > duplicatePlan.totalDistanceMeters - 30)
  assert.equal(miss, null)
})

test('route catch geometry distinguishes a very-near tangent inside/outside pair', () => {
  const plan = createRouteAnimationPlan([[0, 0], [0, 0.002]])
  const inside = targetAt(
    25.0005 / PRECISE_METERS_PER_LATITUDE_DEGREE,
    0.001,
  )
  const outside = targetAt(
    25.002 / PRECISE_METERS_PER_LATITUDE_DEGREE,
    0.001,
  )

  assert.notEqual(findEarliestSoloRouteCatchDistance(plan, inside), null)
  assert.equal(findEarliestSoloRouteCatchDistance(plan, outside), null)
})

test('route catch search honors replay start and end distances', () => {
  const plan = createRouteAnimationPlan([[0, 0], [0, 0.003]])
  const target = targetAt(0, 0.001)
  const firstEntry = findEarliestSoloRouteCatchDistance(plan, target)

  assert.equal(findEarliestSoloRouteCatchDistance(plan, target, {
    startDistanceMeters: firstEntry + 60,
  }), null)
  assert.equal(findEarliestSoloRouteCatchDistance(plan, target, {
    endDistanceMeters: firstEntry - 1,
  }), null)
})
