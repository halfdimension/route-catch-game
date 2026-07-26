import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSharedCreatureMovementIntent,
  MOVEMENT_ARCHITECTURE,
  startMovementForArchitecture,
} from '../src/utils/movementArchitecture.js'

test('solo remains on the existing local route path', () => {
  const calls = []
  const result = startMovementForArchitecture({
    architecture: MOVEMENT_ARCHITECTURE.SOLO,
    startAuthoritativePlan: () => calls.push('authoritative'),
    startLocalRoute: () => {
      calls.push('local-route')
      return 'solo-result'
    },
  })

  assert.equal(result, 'solo-result')
  assert.deepEqual(calls, ['local-route'])
})

test('multiplayer selects the authoritative plan path', () => {
  const calls = []
  const result = startMovementForArchitecture({
    architecture: MOVEMENT_ARCHITECTURE.MULTIPLAYER,
    startAuthoritativePlan: () => {
      calls.push('authoritative')
      return 'room-result'
    },
    startLocalRoute: () => calls.push('local-route'),
  })

  assert.equal(result, 'room-result')
  assert.deepEqual(calls, ['authoritative'])
})

test('shared creature click creates backend intent without browser coordinates', () => {
  assert.deepEqual(
    createSharedCreatureMovementIntent('creature-1', 12),
    {
      requestedSpeedMps: 12,
      destinationType: 'CREATURE',
      targetCreatureInstanceId: 'creature-1',
    },
  )
})
