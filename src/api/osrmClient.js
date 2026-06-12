import polyline from '@mapbox/polyline'

const OSRM_BASE_URL = 'http://localhost:5000'

export async function fetchRoute(source, destination) {
  const url = new URL(
    `/route/v1/driving/${source.lon},${source.lat};${destination.lon},${destination.lat}`,
    OSRM_BASE_URL,
  )

  url.searchParams.set('overview', 'full')
  url.searchParams.set('geometries', 'polyline6')
  url.searchParams.set('steps', 'true')

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`OSRM request failed with status ${response.status}`)
  }

  const data = await response.json()
  const route = data.routes?.[0]

  if (!route?.geometry) {
    throw new Error('OSRM did not return a route geometry')
  }

  return {
    coordinates: polyline.decode(route.geometry, 6),
    distanceMeters: route.distance ?? null,
    durationSeconds: route.duration ?? null,
  }
}

export async function fetchNearestRoadPoint(point) {
  const url = new URL(
    `/nearest/v1/driving/${point.lon},${point.lat}`,
    OSRM_BASE_URL,
  )

  url.searchParams.set('number', '1')

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`OSRM nearest request failed with status ${response.status}`)
  }

  const data = await response.json()
  const location = data.waypoints?.[0]?.location

  if (!location) {
    throw new Error('OSRM did not return a nearest road point')
  }

  return {
    lat: location[1],
    lon: location[0],
  }
}
