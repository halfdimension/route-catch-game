import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMovementPositions,
  prepareMovementPlans,
} from '../src/hooks/useMovementPlanRenderer.js'

const STARTED_AT_MS = Date.parse('2026-07-18T08:00:00Z')

test('mid-route replacement renders only the newest player plan', () => {
  const plans = [
    {
      movementId: 'replacement',
      playerId: 'player-1',
      version: 2,
      encodedPolyline6: '???o}@',
      totalDistanceMeters: 100,
      simulationSpeedMps: 10,
      startedAt: '2026-07-18T08:00:00Z',
      status: 'MOVING',
      currentPosition: { latitude: 0, longitude: 0 },
    },
  ]
  const prepared = prepareMovementPlans(plans)
  const positions = calculateMovementPositions(
    prepared,
    STARTED_AT_MS + 5000,
  )

  assert.equal(prepared.size, 1)
  assert.ok(Math.abs(positions.get('player-1').lon - 0.0005) < 0.0000001)
})

test('reuses decoded geometry across unrelated updates and terminal events', () => {
  const routeCache = new Map()
  const movingPlan = {
    movementId: 'movement-1',
    playerId: 'player-1',
    version: 1,
    encodedPolyline6: '???o}@',
    totalDistanceMeters: 100,
    simulationSpeedMps: 10,
    startedAt: '2026-07-18T08:00:00Z',
    status: 'MOVING',
    currentPosition: { latitude: 0, longitude: 0 },
  }
  const first = prepareMovementPlans([movingPlan], routeCache)
  const completed = prepareMovementPlans(
    [{ ...movingPlan, status: 'COMPLETED' }],
    routeCache,
  )

  assert.strictEqual(
    completed.get('player-1').route,
    first.get('player-1').route,
  )
  assert.equal(routeCache.size, 1)
})
