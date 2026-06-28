import { API_BASE_URL } from '../config/apiConfig'

async function requestMultiplayerRoom(path, token, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    let message = 'Multiplayer room request failed'
    let errorCode = ''

    try {
      const errorResponse = await response.json()
      message = errorResponse.message || message
      errorCode = errorResponse.errorCode || ''
    } catch {
      // Keep the safe fallback when the response does not contain JSON.
    }

    const requestError = new Error(message)
    requestError.status = response.status
    requestError.errorCode = errorCode
    throw requestError
  }

  return response.json()
}

export function createRoom({ roomName }, token) {
  return requestMultiplayerRoom('/api/multiplayer/rooms', token, {
    method: 'POST',
    body: JSON.stringify({ roomName }),
  })
}

export function joinRoom(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/join`,
    token,
    { method: 'POST' },
  )
}

export function leaveRoom(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/leave`,
    token,
    { method: 'POST' },
  )
}

export function getRoom(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}`,
    token,
  )
}

export function listMyRooms(token) {
  return requestMultiplayerRoom('/api/multiplayer/rooms/me', token)
}

export function closeRoom(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/close`,
    token,
    { method: 'POST' },
  )
}

export function startRoomGame(roomCode, { durationSeconds }, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/game/start`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ durationSeconds }),
    },
  )
}

export function getRoomGame(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/game`,
    token,
  )
}

export function endRoomGame(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/game/end`,
    token,
    { method: 'POST' },
  )
}

export function spawnRoomCreatures(roomCode, request, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/creatures/spawn`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  )
}

export function listRoomCreatures(roomCode, token) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/creatures`,
    token,
  )
}

export function catchRoomCreature(
  roomCode,
  instanceId,
  { playerLat, playerLon },
  token,
) {
  return requestMultiplayerRoom(
    `/api/multiplayer/rooms/${encodeURIComponent(
      roomCode,
    )}/creatures/${encodeURIComponent(instanceId)}/catch`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ playerLat, playerLon }),
    },
  )
}
