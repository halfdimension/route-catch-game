import { useMemo } from 'react'
import { Layer, Source } from '@vis.gl/react-maplibre'
import { toRouteGeoJson } from './mapLibreCoordinates'
import { getRouteLayerConfigurations } from './mapLibreStyleConfig'

function MapLibreRouteLayer({
  coordinates,
  isChaseActive,
  sourceId = 'prototype-route',
}) {
  const routeGeoJson = useMemo(
    () => toRouteGeoJson(coordinates),
    [coordinates],
  )
  const layerConfigurations = getRouteLayerConfigurations(
    isChaseActive,
    sourceId,
  )

  if (!routeGeoJson) {
    return null
  }

  return (
    <Source id={sourceId} type="geojson" data={routeGeoJson}>
      <Layer {...layerConfigurations.halo} />
      <Layer {...layerConfigurations.core} />
    </Source>
  )
}

export default MapLibreRouteLayer
