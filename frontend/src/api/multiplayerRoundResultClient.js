import {
  requestAuthenticatedMultiplayerJson,
  requireRequestText,
} from './multiplayerAuthenticatedClient.js'

function requestRoundResult(path, token, signal) {
  return requestAuthenticatedMultiplayerJson({
    path,
    token,
    signal,
    requestName: 'Round result request',
  })
}

export function getRoundResult({
  token,
  roomCode,
  roundId,
  signal,
}) {
  const requiredToken = requireRequestText(token, 'token')
  const encodedRoomCode = encodeURIComponent(
    requireRequestText(roomCode, 'roomCode'),
  )
  const encodedRoundId = encodeURIComponent(
    requireRequestText(roundId, 'roundId'),
  )

  return requestRoundResult(
    `/api/multiplayer/rooms/${encodedRoomCode}/rounds/${encodedRoundId}/result`,
    requiredToken,
    signal,
  )
}

export function getLatestRoundResult({ token, roomCode, signal }) {
  const requiredToken = requireRequestText(token, 'token')
  const encodedRoomCode = encodeURIComponent(
    requireRequestText(roomCode, 'roomCode'),
  )

  return requestRoundResult(
    `/api/multiplayer/rooms/${encodedRoomCode}/rounds/latest/result`,
    requiredToken,
    signal,
  )
}
