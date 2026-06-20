import { API_BASE_URL } from '../config/apiConfig'

export const AUTH_TOKEN_STORAGE_KEY = 'routeCatchAuthToken'

async function requestAuth(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)

  if (!response.ok) {
    let message = 'Authentication request failed'

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

export function register({ username, email, displayName, password }) {
  const payload = {
    username,
    displayName,
    password,
  }

  if (email?.trim()) {
    payload.email = email.trim()
  }

  return requestAuth('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function login({ usernameOrEmail, password }) {
  return requestAuth('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ usernameOrEmail, password }),
  })
}

export function getCurrentUser(token) {
  return requestAuth('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}
