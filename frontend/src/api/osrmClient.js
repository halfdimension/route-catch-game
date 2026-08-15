import { API_BASE_URL } from '../config/apiConfig.js'

export class RouteRequestError extends Error {
  constructor(message, { status, errorCode, responseMessage } = {}) {
    super(message)
    this.name = 'RouteRequestError'
    this.status = status
    this.errorCode = errorCode
    this.responseMessage = responseMessage
  }
}

export function isRouteUnavailableError(error) {
  return (
    error instanceof RouteRequestError &&
    (
      error.status === 400 ||
      ['NoRoute', 'NoSegment', 'ROUTE_NOT_FOUND', 'ROUTE_UNAVAILABLE']
        .includes(error.errorCode)
    )
  )
}

async function routeRequestError(response, fallbackMessage) {
  let errorBody = null

  try {
    errorBody = await response.json()
  } catch {
    // Keep the original HTTP status when the backend returns a non-JSON error.
  }

  return new RouteRequestError(
    errorBody?.message || fallbackMessage,
    {
      status: response.status,
      errorCode: errorBody?.errorCode || errorBody?.code,
      responseMessage: errorBody?.message,
    },
  )
}

export async function fetchRoute(source, destination, options = {}) {
  const response = await fetch(`${API_BASE_URL}/api/routes`, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify({
      sourceLat: source.lat,
      sourceLon: source.lon,
      destinationLat: destination.lat,
      destinationLon: destination.lon,
    }),
  })

  if (!response.ok) {
    throw await routeRequestError(
      response,
      `Route request failed with status ${response.status}`,
    )
  }

  const data = await response.json()

  if (!Array.isArray(data.coordinates)) {
    throw new Error('Route response did not include coordinates')
  }

  return {
    coordinates: data.coordinates.map((coordinate) => [
      coordinate.lat,
      coordinate.lon,
    ]),
    distanceMeters: data.distanceMeters ?? null,
    durationSeconds: data.durationSeconds ?? null,
  }
}

export async function fetchNearestRoadPoint(point) {
  const response = await fetch(`${API_BASE_URL}/api/nearest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lat: point.lat,
      lon: point.lon,
    }),
  })

  if (!response.ok) {
    throw new Error(`Nearest request failed with status ${response.status}`)
  }

  const data = await response.json()

  if (!data.snappedPoint) {
    throw new Error('Nearest response did not include a snapped point')
  }

  return data.snappedPoint
}
