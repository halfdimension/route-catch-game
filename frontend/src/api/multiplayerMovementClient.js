import { API_BASE_URL } from '../config/apiConfig.js'

export const MOVEMENT_EVENT_TYPES = new Set([
  'MOVEMENT_STARTED',
  'MOVEMENT_CANCELLED',
  'MOVEMENT_COMPLETED',
])

export function movementStartDestination(roomCode) {
  return `/app/rooms/${encodeURIComponent(roomCode)}/movements/start`
}

export function movementCancelDestination(roomCode) {
  return `/app/rooms/${encodeURIComponent(roomCode)}/movements/cancel`
}

export function movementTopic(roomCode) {
  return `/topic/rooms/${encodeURIComponent(roomCode)}/movements`
}

export function createMovementCommandId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  throw new Error('This browser cannot create movement command identifiers')
}

export function publishMovementStart(client, roomCode, intent) {
  if (!client?.connected) {
    return false
  }

  const payload = {
    requestedSpeedMps: Number(intent.requestedSpeedMps),
    destinationType: intent.destinationType,
    targetCreatureInstanceId: intent.targetCreatureInstanceId ?? null,
    clientCommandId: intent.clientCommandId || createMovementCommandId(),
    expectedMovementVersion:
      intent.expectedMovementVersion === undefined
        ? null
        : intent.expectedMovementVersion,
  }

  if (intent.destinationType === 'MAP') {
    payload.destinationLat = Number(intent.destinationLat)
    payload.destinationLon = Number(intent.destinationLon)
  }

  client.publish({
    destination: movementStartDestination(roomCode),
    body: JSON.stringify(payload),
  })
  return payload.clientCommandId
}

export function publishMovementCancel(client, roomCode, movementPlan, options = {}) {
  if (!client?.connected || !movementPlan?.movementId) {
    return false
  }

  const payload = {
    movementId: movementPlan.movementId,
    movementVersion: movementPlan.version,
    clientCommandId: options.clientCommandId || createMovementCommandId(),
  }

  client.publish({
    destination: movementCancelDestination(roomCode),
    body: JSON.stringify(payload),
  })
  return payload.clientCommandId
}

export async function fetchMovementSnapshot(roomCode, token, options = {}) {
  const response = await fetch(
    `${API_BASE_URL}/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/movements`,
    {
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  if (!response.ok) {
    let message = 'Could not recover authoritative movement state'
    let errorCode = ''

    try {
      const body = await response.json()
      message = body.message || message
      errorCode = body.errorCode || ''
    } catch {
      // Keep the safe fallback for non-JSON errors.
    }

    const error = new Error(message)
    error.status = response.status
    error.errorCode = errorCode
    throw error
  }

  return response.json()
}
