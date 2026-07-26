import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRoomEvent,
  createRoomEventState,
  replaceRoomEventSubscription,
  roomEventsTopic,
} from '../src/multiplayer/roomEventState.js'
import {
  createMovementPlanState,
  reconcileMovementSnapshot,
} from '../src/multiplayer/movementPlanState.js'

function roomEvent(overrides = {}) {
  return {
    eventId: '41ee5bdc-baa9-4f07-b082-7b07caaf13a6',
    roomCode: 'ABC123',
    roomSequence: 2,
    eventType: 'GAME_ENDED',
    serverTimestamp: '2026-07-26T11:35:27.798904444Z',
    payload: {
      roundId: 'a85f97bb-db9d-4d0c-8014-bb05f512f86c',
      roomCode: 'ABC123',
      startedAt: '2026-07-26T11:34:57.797683387Z',
      endedAt: '2026-07-26T11:35:27.797683387Z',
      endReason: 'TIME_EXPIRED',
      playerCount: 2,
      leaderboard: [],
    },
    ...overrides,
  }
}

test('accepts the actual backend GAME_ENDED envelope shape', () => {
  const event = roomEvent()
  const result = applyRoomEvent(
    createRoomEventState({ roomCode: 'ABC123' }),
    event,
  )

  assert.equal('type' in event, false)
  assert.equal(event.eventType, 'GAME_ENDED')
  assert.equal(event.payload.roundId, 'a85f97bb-db9d-4d0c-8014-bb05f512f86c')
  assert.equal(result.accepted, true)
  assert.equal(result.state.roomSequence, 2)
  assert.deepEqual(result.state.seenEventIds, [
    '41ee5bdc-baa9-4f07-b082-7b07caaf13a6',
  ])
})

test('rejects duplicate, stale, malformed, and wrong-room events', () => {
  const initial = createRoomEventState({ roomCode: 'ABC123' })
  const accepted = applyRoomEvent(initial, roomEvent()).state

  assert.equal(applyRoomEvent(accepted, roomEvent()).reason, 'duplicate-event')
  assert.equal(
    applyRoomEvent(
      accepted,
      roomEvent({ eventId: 'event-2', roomSequence: 1 }),
    ).reason,
    'stale-event',
  )
  assert.equal(
    applyRoomEvent(
      accepted,
      roomEvent({ eventId: 'event-3', roomCode: 'OTHER', roomSequence: 3 }),
    ).reason,
    'wrong-room',
  )
  assert.equal(
    applyRoomEvent(accepted, roomEvent({ eventId: '', roomSequence: 3 })).reason,
    'invalid-event',
  )
})

test('movement sequence state cannot reject a lifecycle event', () => {
  const movementState = reconcileMovementSnapshot(
    createMovementPlanState({ roomCode: 'ABC123' }),
    { movements: [], roomCode: 'ABC123', roomSequence: 99 },
  ).state
  const lifecycleResult = applyRoomEvent(
    createRoomEventState({ roomCode: 'ABC123' }),
    roomEvent({ roomSequence: 1 }),
  )

  assert.equal(movementState.roomSequence, 99)
  assert.equal(lifecycleResult.accepted, true)
  assert.equal(lifecycleResult.state.roomSequence, 1)
})

test('a new subscription generation replaces the prior room-event subscription', () => {
  let activeSubscriptions = 0
  const destinations = []
  const unsubscribeCounts = []
  const client = {
    connected: true,
    subscribe(destination) {
      const index = unsubscribeCounts.length
      let active = true
      activeSubscriptions += 1
      destinations.push(destination)
      unsubscribeCounts.push(0)

      return {
        unsubscribe() {
          if (!active) {
            return
          }
          active = false
          activeSubscriptions -= 1
          unsubscribeCounts[index] += 1
        },
      }
    },
  }

  const firstGeneration = replaceRoomEventSubscription({
    client,
    currentSubscription: null,
    onMessage: () => {},
    roomCode: 'ABC123',
  })
  replaceRoomEventSubscription({
    client,
    currentSubscription: firstGeneration,
    onMessage: () => {},
    roomCode: 'ABC123',
  })

  assert.deepEqual(destinations, [
    roomEventsTopic('ABC123'),
    roomEventsTopic('ABC123'),
  ])
  assert.deepEqual(unsubscribeCounts, [1, 0])
  assert.equal(activeSubscriptions, 1)
})
