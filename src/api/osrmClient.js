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

  return polyline.decode(route.geometry, 6)
}
