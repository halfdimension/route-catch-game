function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isLatitude(value) {
  return isFiniteCoordinate(value) && value >= -90 && value <= 90
}

function isLongitude(value) {
  return isFiniteCoordinate(value) && value >= -180 && value <= 180
}

export function toMapLibreLngLat(position) {
  if (
    !position ||
    !isLatitude(position.lat) ||
    !isLongitude(position.lon)
  ) {
    return null
  }

  return [position.lon, position.lat]
}

export function toMapLibreCoordinate(coordinate) {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length < 2 ||
    !isLatitude(coordinate[0]) ||
    !isLongitude(coordinate[1])
  ) {
    return null
  }

  return [coordinate[1], coordinate[0]]
}

export function fromMapLibreLngLat(lngLat) {
  if (!lngLat || !isLongitude(lngLat.lng) || !isLatitude(lngLat.lat)) {
    return null
  }

  return {
    lat: lngLat.lat,
    lon: lngLat.lng,
  }
}

export function toRouteGeoJson(routeCoordinates) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    return null
  }

  const coordinates = routeCoordinates.map(toMapLibreCoordinate)

  if (coordinates.some((coordinate) => coordinate === null)) {
    return null
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates,
    },
  }
}
