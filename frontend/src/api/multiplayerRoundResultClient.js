import { API_BASE_URL } from '../config/apiConfig.js'

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`)
  }

  return value.trim()
}

async function requestRoundResult(path, token, signal) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${requireText(token, 'token')}`,
    },
    signal,
  })

  if (!response.ok) {
    let message = `Round result request failed (${response.status})`
    let errorCode = ''

    try {
      const errorResponse = await response.json()

      if (
        errorResponse &&
        typeof errorResponse === 'object' &&
        typeof errorResponse.message === 'string' &&
        errorResponse.message.trim()
      ) {
        message = errorResponse.message.trim()
      }

      if (
        errorResponse &&
        typeof errorResponse === 'object' &&
        typeof errorResponse.errorCode === 'string'
      ) {
        errorCode = errorResponse.errorCode
      }
    } catch {
      // Never expose an HTML or otherwise unstructured response body.
    }

    const requestError = new Error(message)
    requestError.status = response.status
    requestError.errorCode = errorCode
    throw requestError
  }

  return response.json()
}

export function getRoundResult({
  token,
  roomCode,
  roundId,
  signal,
}) {
  const requiredToken = requireText(token, 'token')
  const encodedRoomCode = encodeURIComponent(requireText(roomCode, 'roomCode'))
  const encodedRoundId = encodeURIComponent(requireText(roundId, 'roundId'))

  return requestRoundResult(
    `/api/multiplayer/rooms/${encodedRoomCode}/rounds/${encodedRoundId}/result`,
    requiredToken,
    signal,
  )
}

export function getLatestRoundResult({ token, roomCode, signal }) {
  const requiredToken = requireText(token, 'token')
  const encodedRoomCode = encodeURIComponent(requireText(roomCode, 'roomCode'))

  return requestRoundResult(
    `/api/multiplayer/rooms/${encodedRoomCode}/rounds/latest/result`,
    requiredToken,
    signal,
  )
}
