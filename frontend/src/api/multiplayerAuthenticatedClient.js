import { API_BASE_URL } from '../config/apiConfig.js'

export function requireRequestText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`)
  }

  return value.trim()
}

export async function requestAuthenticatedMultiplayerJson({
  path,
  token,
  signal,
  requestName = 'Multiplayer request',
}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${requireRequestText(token, 'token')}`,
    },
    signal,
  })

  if (!response.ok) {
    let message = `${requestName} failed (${response.status})`
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
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error
      }

      // Never expose an HTML or otherwise unstructured response body.
    }

    const requestError = new Error(message)
    requestError.status = response.status
    requestError.errorCode = errorCode
    throw requestError
  }

  try {
    return await response.json()
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error
    }

    throw new Error(`${requestName} returned an invalid response`, {
      cause: error,
    })
  }
}
