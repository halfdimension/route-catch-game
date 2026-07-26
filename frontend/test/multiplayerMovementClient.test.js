import assert from 'node:assert/strict'
import test from 'node:test'
import {
  movementCancelDestination,
  movementStartDestination,
  movementTopic,
  publishMovementCancel,
  publishMovementStart,
} from '../src/api/multiplayerMovementClient.js'

test('uses the exact Phase A1 destinations', () => {
  assert.equal(
    movementStartDestination('ABC123'),
    '/app/rooms/ABC123/movements/start',
  )
  assert.equal(
    movementCancelDestination('ABC123'),
    '/app/rooms/ABC123/movements/cancel',
  )
  assert.equal(
    movementTopic('ABC123'),
    '/topic/rooms/ABC123/movements',
  )
})

test('creature movement publishes identity intent without coordinates', () => {
  const publications = []
  const client = {
    connected: true,
    publish(publication) {
      publications.push(publication)
    },
  }

  publishMovementStart(client, 'ABC123', {
    requestedSpeedMps: 12,
    destinationType: 'CREATURE',
    targetCreatureInstanceId: 'creature-1',
    clientCommandId: 'command-1',
    expectedMovementVersion: 4,
  })

  assert.equal(publications.length, 1)
  const payload = JSON.parse(publications[0].body)
  assert.equal(publications[0].destination, '/app/rooms/ABC123/movements/start')
  assert.deepEqual(payload, {
    requestedSpeedMps: 12,
    destinationType: 'CREATURE',
    targetCreatureInstanceId: 'creature-1',
    clientCommandId: 'command-1',
    expectedMovementVersion: 4,
  })
  assert.equal('playerId' in payload, false)
  assert.equal('sourceLat' in payload, false)
  assert.equal('encodedPolyline6' in payload, false)
  assert.equal('destinationLat' in payload, false)
  assert.equal('destinationLon' in payload, false)
})

test('map movement retains client-selected destination coordinates', () => {
  const publications = []
  const client = {
    connected: true,
    publish(publication) {
      publications.push(publication)
    },
  }

  publishMovementStart(client, 'ABC123', {
    destinationLat: 28.61,
    destinationLon: 77.21,
    requestedSpeedMps: 12,
    destinationType: 'MAP',
    clientCommandId: 'command-2',
    expectedMovementVersion: 0,
  })

  assert.deepEqual(JSON.parse(publications[0].body), {
    requestedSpeedMps: 12,
    destinationType: 'MAP',
    targetCreatureInstanceId: null,
    clientCommandId: 'command-2',
    expectedMovementVersion: 0,
    destinationLat: 28.61,
    destinationLon: 77.21,
  })
})

test('movement cancellation uses authoritative movement identity and version', () => {
  const publications = []
  const client = {
    connected: true,
    publish(publication) {
      publications.push(publication)
    },
  }

  publishMovementCancel(
    client,
    'ABC123',
    { movementId: 'movement-1', version: 7 },
    { clientCommandId: 'cancel-1' },
  )

  assert.equal(publications[0].destination, '/app/rooms/ABC123/movements/cancel')
  assert.deepEqual(JSON.parse(publications[0].body), {
    movementId: 'movement-1',
    movementVersion: 7,
    clientCommandId: 'cancel-1',
  })
})
