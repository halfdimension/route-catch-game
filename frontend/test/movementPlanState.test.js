import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyMovementEvent,
  createMovementPlanState,
  getMovementPlanForPlayer,
  isCurrentMovementSubscription,
  reconcileMovementSnapshot,
} from '../src/multiplayer/movementPlanState.js'

function movementPlan({
  movementId = 'movement-1',
  playerId = 'player-1',
  roomCode = 'ROOM-1',
  status = 'MOVING',
  version = 1,
} = {}) {
  return {
    movementId,
    roomCode,
    playerId,
    version,
    encodedPolyline6: 'polyline6',
    totalDistanceMeters: 100,
    simulationSpeedMps: 10,
    startedAt: '2026-07-18T10:00:00Z',
    expectedEndAt: '2026-07-18T10:00:10Z',
    source: { latitude: 28.6, longitude: 77.2 },
    destination: { latitude: 28.61, longitude: 77.21 },
    currentPosition: { latitude: 28.6, longitude: 77.2 },
    destinationType: 'MAP',
    targetCreatureInstanceId: null,
    status,
    createdAt: '2026-07-18T10:00:00Z',
    updatedAt: '2026-07-18T10:00:00Z',
  }
}

function movementEvent({
  eventId = 'event-1',
  eventType = 'MOVEMENT_STARTED',
  plan = movementPlan(),
  roomCode = 'ROOM-1',
  roomSequence = 1,
} = {}) {
  return {
    eventId,
    roomCode,
    roomSequence,
    eventType,
    serverTimestamp: '2026-07-18T10:00:00Z',
    payload: plan,
  }
}

function snapshot({ movements = [], roomSequence = 0 } = {}) {
  return {
    roomCode: 'ROOM-1',
    roomSequence,
    serverTimestamp: '2026-07-18T10:00:00Z',
    movements,
  }
}

test('snapshot reconciliation replaces the roster and accepts equal sequence', () => {
  const initialSnapshot = reconcileMovementSnapshot(
    createMovementPlanState({ roomCode: 'room-1' }),
    snapshot({
      roomSequence: 4,
      movements: [
        movementPlan(),
        movementPlan({ movementId: 'movement-2', playerId: 'player-2' }),
      ],
    }),
  )

  assert.equal(initialSnapshot.accepted, true)
  assert.equal(initialSnapshot.state.hasSnapshot, true)
  assert.equal(initialSnapshot.state.roomSequence, 4)
  assert.deepEqual(initialSnapshot.acceptedPlayerIds, ['player-1', 'player-2'])

  const equalSequenceSnapshot = reconcileMovementSnapshot(
    initialSnapshot.state,
    snapshot({ roomSequence: 4, movements: [movementPlan()] }),
  )

  assert.equal(equalSequenceSnapshot.accepted, true)
  assert.equal(getMovementPlanForPlayer(equalSequenceSnapshot.state, 'player-1').version, 1)
  assert.equal(getMovementPlanForPlayer(equalSequenceSnapshot.state, 'player-2'), null)
})

test('a late snapshot cannot roll newer event state back', () => {
  const current = reconcileMovementSnapshot(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    snapshot({ roomSequence: 8, movements: [movementPlan({ version: 2 })] }),
  ).state
  const result = reconcileMovementSnapshot(
    current,
    snapshot({ roomSequence: 7, movements: [movementPlan({ version: 1 })] }),
  )

  assert.equal(result.accepted, false)
  assert.equal(result.reason, 'stale-snapshot')
  assert.equal(getMovementPlanForPlayer(result.state, 'player-1').version, 2)
})

test('duplicate event ids are ignored', () => {
  const first = applyMovementEvent(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    movementEvent(),
  )
  const duplicate = applyMovementEvent(
    first.state,
    movementEvent({ roomSequence: 2 }),
  )

  assert.equal(first.accepted, true)
  assert.equal(duplicate.accepted, false)
  assert.equal(duplicate.reason, 'duplicate-event-id')
  assert.equal(duplicate.state.roomSequence, 1)
})

test('older and equal room sequences are rejected', () => {
  const current = reconcileMovementSnapshot(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    snapshot({ roomSequence: 5, movements: [movementPlan()] }),
  ).state

  for (const roomSequence of [4, 5]) {
    const result = applyMovementEvent(
      current,
      movementEvent({ eventId: `event-${roomSequence}`, roomSequence }),
    )
    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'stale-room-sequence')
    assert.equal(result.state.roomSequence, 5)
  }
})

test('a room sequence gap applies the full plan and requests a snapshot', () => {
  const current = reconcileMovementSnapshot(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    snapshot({ roomSequence: 2, movements: [] }),
  ).state
  const result = applyMovementEvent(
    current,
    movementEvent({ roomSequence: 5 }),
  )

  assert.equal(result.accepted, true)
  assert.equal(result.sequenceGap, true)
  assert.equal(result.needsSnapshot, true)
  assert.equal(result.state.needsSnapshot, true)
  assert.equal(result.state.roomSequence, 5)
  assert.equal(getMovementPlanForPlayer(result.state, 'player-1').movementId, 'movement-1')

  const repaired = reconcileMovementSnapshot(
    result.state,
    snapshot({ roomSequence: 5, movements: [movementPlan()] }),
  )
  assert.equal(repaired.state.needsSnapshot, false)
})

test('older and replayed start movement versions cannot restore a route', () => {
  const currentPlan = movementPlan({ movementId: 'movement-2', version: 2 })
  const current = reconcileMovementSnapshot(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    snapshot({ roomSequence: 10, movements: [currentPlan] }),
  ).state

  for (const plan of [
    movementPlan({ movementId: 'movement-1', version: 1 }),
    movementPlan({ movementId: 'movement-2', version: 2 }),
  ]) {
    const result = applyMovementEvent(
      current,
      movementEvent({ eventId: `event-${plan.version}`, plan, roomSequence: 11 }),
    )
    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'stale-movement-version')
    assert.equal(result.needsSnapshot, true)
    assert.equal(getMovementPlanForPlayer(result.state, 'player-1').movementId, 'movement-2')
  }
})

test('same-version terminal events advance the status of their movement', () => {
  const movingState = applyMovementEvent(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    movementEvent(),
  ).state
  const cancelledPlan = movementPlan({ status: 'CANCELLED' })
  const result = applyMovementEvent(
    movingState,
    movementEvent({
      eventId: 'event-2',
      eventType: 'MOVEMENT_CANCELLED',
      plan: cancelledPlan,
      roomSequence: 2,
    }),
  )

  assert.equal(result.accepted, true)
  assert.equal(getMovementPlanForPlayer(result.state, 'player-1').status, 'CANCELLED')
})

test('a newer movement version replaces a route mid-movement', () => {
  const first = applyMovementEvent(
    createMovementPlanState({ roomCode: 'ROOM-1' }),
    movementEvent(),
  ).state
  const replacementPlan = movementPlan({
    movementId: 'movement-2',
    version: 2,
  })
  const replacement = applyMovementEvent(
    first,
    movementEvent({
      eventId: 'event-2',
      plan: replacementPlan,
      roomSequence: 2,
    }),
  )

  assert.equal(replacement.accepted, true)
  assert.equal(getMovementPlanForPlayer(replacement.state, 'player-1').movementId, 'movement-2')
  assert.equal(getMovementPlanForPlayer(replacement.state, 'player-1').version, 2)
})

test('only the current room connection and subscription generations can update state', () => {
  const currentClient = {}
  const current = {
    client: currentClient,
    connectionGeneration: 3,
    currentClient,
    currentConnectionGeneration: 3,
    currentRoomCode: 'ROOM-1',
    currentSubscriptionGeneration: 7,
    roomCode: 'room-1',
    subscriptionGeneration: 7,
  }

  assert.equal(isCurrentMovementSubscription(current), true)
  assert.equal(isCurrentMovementSubscription({
    ...current,
    connectionGeneration: 2,
  }), false)
  assert.equal(isCurrentMovementSubscription({
    ...current,
    subscriptionGeneration: 6,
  }), false)
  assert.equal(isCurrentMovementSubscription({
    ...current,
    roomCode: 'ROOM-2',
  }), false)
  assert.equal(isCurrentMovementSubscription({
    ...current,
    client: {},
  }), false)
})
