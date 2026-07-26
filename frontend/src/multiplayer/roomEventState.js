const MAX_TRACKED_EVENT_IDS = 100

export function roomEventsTopic(roomCode) {
  return `/topic/rooms/${roomCode}/events`
}

export function replaceRoomEventSubscription({
  client,
  currentSubscription,
  onMessage,
  roomCode,
}) {
  if (currentSubscription && client.connected) {
    currentSubscription.unsubscribe()
  }

  return client.subscribe(roomEventsTopic(roomCode), onMessage)
}

function normalizeIdentifier(value) {
  if (value === undefined || value === null) {
    return null
  }

  const identifier = String(value)
  return identifier ? identifier : null
}

function normalizeSequence(value) {
  const sequence = Number(value)
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null
}

export function createRoomEventState({ roomCode = '' } = {}) {
  return {
    roomCode: normalizeIdentifier(roomCode) || '',
    roomSequence: 0,
    seenEventIds: [],
  }
}

export function applyRoomEvent(state, event) {
  const eventId = normalizeIdentifier(event?.eventId)
  const roomCode = normalizeIdentifier(event?.roomCode)
  const roomSequence = normalizeSequence(event?.roomSequence)
  const eventType = normalizeIdentifier(event?.eventType)

  if (!eventId || !roomCode || roomSequence === null || !eventType) {
    return { accepted: false, reason: 'invalid-event', state }
  }

  if (state.roomCode && roomCode !== state.roomCode) {
    return { accepted: false, reason: 'wrong-room', state }
  }

  if (state.seenEventIds.includes(eventId)) {
    return { accepted: false, reason: 'duplicate-event', state }
  }

  if (roomSequence <= state.roomSequence) {
    return { accepted: false, reason: 'stale-event', state }
  }

  return {
    accepted: true,
    reason: 'accepted',
    state: {
      roomCode,
      roomSequence,
      seenEventIds: [...state.seenEventIds, eventId].slice(
        -MAX_TRACKED_EVENT_IDS,
      ),
    },
  }
}
