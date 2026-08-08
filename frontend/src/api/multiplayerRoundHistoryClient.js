import {
  requestAuthenticatedMultiplayerJson,
  requireRequestText,
} from './multiplayerAuthenticatedClient.js'

function requireInteger(value, name, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be an integer of at least ${minimum}`)
  }

  return value
}

function isHistoryEntry(entry) {
  return Boolean(
    entry &&
    typeof entry === 'object' &&
    typeof entry.roundId === 'string' &&
    entry.roundId.trim() &&
    typeof entry.roomCode === 'string' &&
    entry.roomCode.trim() &&
    typeof entry.startedAt === 'string' &&
    typeof entry.endedAt === 'string' &&
    typeof entry.endReason === 'string' &&
    Number.isInteger(entry.durationSeconds) &&
    Number.isInteger(entry.participantCount) &&
    Number.isInteger(entry.rank) &&
    Number.isInteger(entry.score) &&
    Number.isInteger(entry.creaturesCaught),
  )
}

function validateHistoryResponse(response, requestedPage, requestedSize) {
  const isValid = Boolean(
    response &&
    typeof response === 'object' &&
    Array.isArray(response.content) &&
    response.content.every(isHistoryEntry) &&
    Number.isInteger(response.page) &&
    response.page === requestedPage &&
    Number.isInteger(response.size) &&
    response.size === requestedSize &&
    response.content.length <= requestedSize &&
    Number.isInteger(response.totalElements) &&
    response.totalElements >= 0 &&
    Number.isInteger(response.totalPages) &&
    response.totalPages >= 0 &&
    response.totalPages === (
      response.totalElements === 0
        ? 0
        : Math.ceil(response.totalElements / requestedSize)
    ) &&
    !(
      response.totalPages === 0 &&
      (response.totalElements !== 0 || response.content.length !== 0)
    ) &&
    !(
      response.totalPages > 0 &&
      requestedPage >= response.totalPages &&
      response.content.length !== 0
    ),
  )

  if (!isValid) {
    throw new Error('Multiplayer round history returned an invalid response')
  }

  return response
}

export async function listMultiplayerRoundHistory({
  token,
  page = 0,
  size = 10,
  signal,
}) {
  const requiredToken = requireRequestText(token, 'token')
  const requiredPage = requireInteger(page, 'page', 0)
  const requiredSize = requireInteger(size, 'size', 1)
  const query = new URLSearchParams({
    page: String(requiredPage),
    size: String(requiredSize),
  })
  const response = await requestAuthenticatedMultiplayerJson({
    path: `/api/multiplayer/me/rounds?${query}`,
    token: requiredToken,
    signal,
    requestName: 'Multiplayer round history request',
  })

  return validateHistoryResponse(response, requiredPage, requiredSize)
}
