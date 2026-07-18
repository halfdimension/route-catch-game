const MOVEMENT_EVENT_STATUSES = Object.freeze({
  MOVEMENT_STARTED: 'MOVING',
  MOVEMENT_CANCELLED: 'CANCELLED',
  MOVEMENT_COMPLETED: 'COMPLETED',
})

const MAX_TRACKED_EVENT_IDS = 256

function normalizeRoomCode(roomCode) {
  if (roomCode === undefined || roomCode === null) {
    return null
  }

  const normalizedRoomCode = String(roomCode).trim().toUpperCase()
  return normalizedRoomCode.length > 0 ? normalizedRoomCode : null
}

function normalizeIdentifier(identifier) {
  if (identifier === undefined || identifier === null) {
    return null
  }

  const normalizedIdentifier = String(identifier)
  return normalizedIdentifier.length > 0 ? normalizedIdentifier : null
}

function normalizeSequence(sequence) {
  const normalizedSequence = Number(sequence)
  return Number.isSafeInteger(normalizedSequence) && normalizedSequence >= 0
    ? normalizedSequence
    : null
}

function normalizeMovementPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return null
  }

  const playerId = normalizeIdentifier(plan.playerId)
  const movementId = normalizeIdentifier(plan.movementId)
  const version = normalizeSequence(plan.version)

  if (playerId === null || movementId === null || version === null) {
    return null
  }

  return {
    ...plan,
    movementId,
    playerId,
    version,
  }
}

function rememberEventId(eventIds, eventId) {
  if (eventIds.includes(eventId)) {
    return eventIds
  }

  return [...eventIds, eventId].slice(-MAX_TRACKED_EVENT_IDS)
}

function rejectEvent(state, reason, { needsSnapshot = false } = {}) {
  const nextState = needsSnapshot && !state.needsSnapshot
    ? { ...state, needsSnapshot: true }
    : state

  return {
    accepted: false,
    needsSnapshot: nextState.needsSnapshot,
    reason,
    sequenceGap: false,
    state: nextState,
  }
}

function canApplySameVersionEvent(currentPlan, incomingPlan, eventType) {
  return (
    currentPlan.movementId === incomingPlan.movementId &&
    currentPlan.status === 'MOVING' &&
    incomingPlan.status === MOVEMENT_EVENT_STATUSES[eventType] &&
    (eventType === 'MOVEMENT_CANCELLED' ||
      eventType === 'MOVEMENT_COMPLETED')
  )
}

export function createMovementPlanState({ roomCode = null } = {}) {
  return {
    hasSnapshot: false,
    needsSnapshot: false,
    plansByPlayerId: {},
    roomCode: normalizeRoomCode(roomCode),
    roomSequence: 0,
    seenEventIds: [],
  }
}

/**
 * Reconciles a complete backend snapshot without allowing a late snapshot to
 * roll state back. An equal-sequence snapshot is accepted because it can fill
 * players omitted from events received while the initial request was in flight.
 */
export function reconcileMovementSnapshot(state, snapshot) {
  const roomCode = normalizeRoomCode(snapshot?.roomCode)
  const roomSequence = normalizeSequence(snapshot?.roomSequence)

  if (
    roomCode === null ||
    roomSequence === null ||
    !Array.isArray(snapshot?.movements)
  ) {
    return {
      accepted: false,
      acceptedPlayerIds: [],
      needsSnapshot: state.needsSnapshot,
      reason: 'invalid-snapshot',
      rejectedPlayerIds: [],
      state,
    }
  }

  if (state.roomCode !== null && state.roomCode !== roomCode) {
    return {
      accepted: false,
      acceptedPlayerIds: [],
      needsSnapshot: state.needsSnapshot,
      reason: 'room-mismatch',
      rejectedPlayerIds: [],
      state,
    }
  }

  if (roomSequence < state.roomSequence) {
    return {
      accepted: false,
      acceptedPlayerIds: [],
      needsSnapshot: state.needsSnapshot,
      reason: 'stale-snapshot',
      rejectedPlayerIds: [],
      state,
    }
  }

  const acceptedPlayerIds = []
  const rejectedPlayerIds = []
  const plansByPlayerId = {}

  for (const rawPlan of snapshot.movements) {
    const plan = normalizeMovementPlan(rawPlan)

    if (plan === null) {
      rejectedPlayerIds.push(normalizeIdentifier(rawPlan?.playerId))
      continue
    }

    const currentPlan = state.plansByPlayerId[plan.playerId]
    const alreadyReconciledPlan = plansByPlayerId[plan.playerId]
    const newestKnownPlan = alreadyReconciledPlan ?? currentPlan
    const isOlder = newestKnownPlan && plan.version < newestKnownPlan.version
    const conflictsAtSameVersion = (
      newestKnownPlan &&
      plan.version === newestKnownPlan.version &&
      plan.movementId !== newestKnownPlan.movementId
    )

    if (isOlder || conflictsAtSameVersion) {
      plansByPlayerId[plan.playerId] = newestKnownPlan
      rejectedPlayerIds.push(plan.playerId)
      continue
    }

    plansByPlayerId[plan.playerId] = plan
    acceptedPlayerIds.push(plan.playerId)
  }

  const nextState = {
    ...state,
    hasSnapshot: true,
    needsSnapshot: false,
    plansByPlayerId,
    roomCode,
    roomSequence,
  }

  return {
    accepted: true,
    acceptedPlayerIds,
    needsSnapshot: false,
    reason: null,
    rejectedPlayerIds,
    state: nextState,
  }
}

/**
 * Applies one room movement envelope. Sequence gaps do not make the full event
 * unusable: its payload is a complete plan, so it is applied immediately while
 * `needsSnapshot` remains set until a snapshot repairs any missed players.
 */
export function applyMovementEvent(state, event) {
  const eventId = normalizeIdentifier(event?.eventId)
  const eventRoomCode = normalizeRoomCode(event?.roomCode)
  const roomSequence = normalizeSequence(event?.roomSequence)
  const expectedStatus = MOVEMENT_EVENT_STATUSES[event?.eventType]
  const incomingPlan = normalizeMovementPlan(event?.payload)

  if (
    eventId === null ||
    eventRoomCode === null ||
    roomSequence === null ||
    expectedStatus === undefined ||
    incomingPlan === null ||
    incomingPlan.status !== expectedStatus
  ) {
    return rejectEvent(state, 'invalid-event')
  }

  if (state.seenEventIds.includes(eventId)) {
    return rejectEvent(state, 'duplicate-event-id')
  }

  if (
    (state.roomCode !== null && state.roomCode !== eventRoomCode) ||
    normalizeRoomCode(incomingPlan.roomCode) !== eventRoomCode
  ) {
    return rejectEvent(state, 'room-mismatch')
  }

  if (roomSequence <= state.roomSequence) {
    return rejectEvent(state, 'stale-room-sequence')
  }

  const currentPlan = state.plansByPlayerId[incomingPlan.playerId]

  if (currentPlan && incomingPlan.version < currentPlan.version) {
    return rejectEvent(state, 'stale-movement-version', {
      needsSnapshot: true,
    })
  }

  if (
    currentPlan &&
    incomingPlan.version === currentPlan.version &&
    !canApplySameVersionEvent(currentPlan, incomingPlan, event.eventType)
  ) {
    return rejectEvent(state, 'stale-movement-version', {
      needsSnapshot: true,
    })
  }

  const sequenceGap = roomSequence > state.roomSequence + 1
  const nextState = {
    ...state,
    needsSnapshot: state.needsSnapshot || sequenceGap,
    plansByPlayerId: {
      ...state.plansByPlayerId,
      [incomingPlan.playerId]: incomingPlan,
    },
    roomCode: state.roomCode ?? eventRoomCode,
    roomSequence,
    seenEventIds: rememberEventId(state.seenEventIds, eventId),
  }

  return {
    accepted: true,
    needsSnapshot: nextState.needsSnapshot,
    reason: null,
    sequenceGap,
    state: nextState,
  }
}

export function getMovementPlanForPlayer(state, playerId) {
  const normalizedPlayerId = normalizeIdentifier(playerId)
  return normalizedPlayerId === null
    ? null
    : state.plansByPlayerId[normalizedPlayerId] ?? null
}

/**
 * Guards async subscription callbacks across room changes and reconnects.
 * Both connection and subscription generations are checked because an old
 * callback can otherwise arrive from the same STOMP client object.
 */
export function isCurrentMovementSubscription({
  client,
  connectionGeneration,
  currentClient,
  currentConnectionGeneration,
  currentRoomCode,
  currentSubscriptionGeneration,
  roomCode,
  subscriptionGeneration,
}) {
  const normalizedRoomCode = normalizeRoomCode(roomCode)

  return (
    client !== null &&
    client !== undefined &&
    client === currentClient &&
    connectionGeneration === currentConnectionGeneration &&
    subscriptionGeneration === currentSubscriptionGeneration &&
    normalizedRoomCode !== null &&
    normalizedRoomCode === normalizeRoomCode(currentRoomCode)
  )
}
