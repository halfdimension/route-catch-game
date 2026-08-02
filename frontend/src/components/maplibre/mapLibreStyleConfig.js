export const DEFAULT_MAPLIBRE_STYLE_URL =
  'https://tiles.openfreemap.org/styles/bright'

const configuredStyleUrl =
  import.meta.env?.VITE_MAPLIBRE_STYLE_URL?.trim()

export const MAPLIBRE_STYLE_URL =
  configuredStyleUrl || DEFAULT_MAPLIBRE_STYLE_URL

const ROUTE_LAYOUT = Object.freeze({
  'line-cap': 'round',
  'line-join': 'round',
})

function createRouteLayerConfigurations(sourceId) {
  return Object.freeze({
    standard: Object.freeze({
      halo: Object.freeze({
        id: `${sourceId}-halo`,
        type: 'line',
        layout: ROUTE_LAYOUT,
        paint: Object.freeze({
          'line-color': '#111827',
          'line-opacity': 0.58,
          'line-width': 10,
          'line-blur': 1,
        }),
      }),
      core: Object.freeze({
        id: `${sourceId}-core`,
        type: 'line',
        layout: ROUTE_LAYOUT,
        paint: Object.freeze({
          'line-color': '#2563eb',
          'line-opacity': 0.96,
          'line-width': 5,
        }),
      }),
    }),
    chase: Object.freeze({
      halo: Object.freeze({
        id: `${sourceId}-halo`,
        type: 'line',
        layout: ROUTE_LAYOUT,
        paint: Object.freeze({
          'line-color': '#321568',
          'line-opacity': 0.74,
          'line-width': 14,
          'line-blur': 1.8,
        }),
      }),
      core: Object.freeze({
        id: `${sourceId}-core`,
        type: 'line',
        layout: ROUTE_LAYOUT,
        paint: Object.freeze({
          'line-color': '#a78bfa',
          'line-opacity': 1,
          'line-width': 7,
        }),
      }),
    }),
  })
}

const ROUTE_LAYER_CONFIGURATIONS = Object.freeze({
  'prototype-route': createRouteLayerConfigurations('prototype-route'),
  'solo-route': createRouteLayerConfigurations('solo-route'),
})

export function getRouteLayerConfigurations(
  isChaseActive = false,
  sourceId = 'prototype-route',
) {
  const configurations =
    ROUTE_LAYER_CONFIGURATIONS[sourceId] ||
    ROUTE_LAYER_CONFIGURATIONS['prototype-route']

  return isChaseActive ? configurations.chase : configurations.standard
}

function isCompatibleBuildingLayer(layer, sources) {
  const sourceName = layer?.source
  const sourceLayer = layer?.['source-layer']

  return (
    typeof sourceName === 'string' &&
    typeof sourceLayer === 'string' &&
    sources?.[sourceName]?.type === 'vector' &&
    /building/i.test(`${layer.id} ${sourceLayer}`)
  )
}

export function findBuildingSource(style) {
  const layers = Array.isArray(style?.layers) ? style.layers : []
  const compatibleLayer = layers.find((layer) =>
    isCompatibleBuildingLayer(layer, style?.sources),
  )

  if (!compatibleLayer) {
    return null
  }

  return {
    source: compatibleLayer.source,
    sourceLayer: compatibleLayer['source-layer'],
    beforeId: layers.find((layer) => layer.type === 'symbol')?.id,
  }
}

export function createBuildingExtrusionLayer(buildingSource) {
  if (!buildingSource) {
    return null
  }

  return {
    id: 'maplibre-3d-buildings',
    type: 'fill-extrusion',
    source: buildingSource.source,
    'source-layer': buildingSource.sourceLayer,
    minzoom: 15,
    paint: {
      'fill-extrusion-color': '#d4cbe6',
      'fill-extrusion-height': [
        'coalesce',
        ['to-number', ['get', 'render_height']],
        ['to-number', ['get', 'height']],
        ['*', ['to-number', ['get', 'levels']], 2.6],
        7,
      ],
      'fill-extrusion-base': [
        'coalesce',
        ['to-number', ['get', 'render_min_height']],
        ['to-number', ['get', 'min_height']],
        0,
      ],
      'fill-extrusion-opacity': 0.42,
    },
  }
}
