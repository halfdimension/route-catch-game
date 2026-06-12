import { API_BASE_URL } from '../config/apiConfig'

export async function fetchRoute(source, destination) {
  const response = await fetch(`${API_BASE_URL}/api/routes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceLat: source.lat,
      sourceLon: source.lon,
      destinationLat: destination.lat,
      destinationLon: destination.lon,
    }),
  })

  if (!response.ok) {
    throw new Error(`Route request failed with status ${response.status}`)
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
