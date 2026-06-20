import { API_BASE_URL } from '../config/apiConfig'

async function requestGameSession(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)

  if (!response.ok) {
    let message = 'Game session request failed'

    try {
      const errorResponse = await response.json()
      message = errorResponse.message || message
    } catch {
      // Keep the safe fallback when the response does not contain JSON.
    }

    throw new Error(message)
  }

  return response.json()
}

export function createGameSession(durationSeconds, playerName, token) {
  const headers = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return requestGameSession('/api/game/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ durationSeconds, playerName }),
  })
}

export function getGameSession(sessionId) {
  return requestGameSession(`/api/game/sessions/${sessionId}`)
}

export function listGameSessions(limit = 20) {
  const query = new URLSearchParams({ limit: String(limit) })
  return requestGameSession(`/api/game/sessions?${query}`)
}

export function listSessionCatches(sessionId) {
  return requestGameSession(`/api/game/sessions/${sessionId}/catches`)
}

export function getLeaderboard(limit = 10) {
  const query = new URLSearchParams({ limit: String(limit) })
  return requestGameSession(`/api/game/leaderboard?${query}`)
}

export function getPlayerStats(playerName) {
  const normalizedPlayerName = playerName?.trim() || 'Guest'
  return requestGameSession(
    `/api/game/players/${encodeURIComponent(normalizedPlayerName)}/stats`,
  )
}

export function startGameSession(sessionId) {
  return requestGameSession(`/api/game/sessions/${sessionId}/start`, {
    method: 'POST',
  })
}

export function endGameSession(sessionId) {
  return requestGameSession(`/api/game/sessions/${sessionId}/end`, {
    method: 'POST',
  })
}

export function submitCatch(sessionId, creatureId) {
  return requestGameSession(`/api/game/sessions/${sessionId}/catches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ creatureId }),
  })
}
