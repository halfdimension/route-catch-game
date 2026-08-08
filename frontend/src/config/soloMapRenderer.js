export const SOLO_MAP_RENDERERS = Object.freeze({
  LEAFLET: 'leaflet',
  MAPLIBRE: 'maplibre',
})

export const MAPLIBRE_SOLO_ROUTE_PRELUDE_MS = 400

export function resolveSoloMapRenderer(configuredRenderer) {
  const normalizedRenderer =
    typeof configuredRenderer === 'string'
      ? configuredRenderer.trim()
      : ''

  return normalizedRenderer === SOLO_MAP_RENDERERS.MAPLIBRE
    ? SOLO_MAP_RENDERERS.MAPLIBRE
    : SOLO_MAP_RENDERERS.LEAFLET
}

export const SOLO_MAP_RENDERER = resolveSoloMapRenderer(
  import.meta.env?.VITE_SOLO_MAP_RENDERER,
)

export function getSoloRouteAnimationStartDelay(renderer) {
  return renderer === SOLO_MAP_RENDERERS.MAPLIBRE
    ? MAPLIBRE_SOLO_ROUTE_PRELUDE_MS
    : 0
}
