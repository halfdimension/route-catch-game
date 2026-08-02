export const SOLO_MAP_RENDERERS = Object.freeze({
  LEAFLET: 'leaflet',
  MAPLIBRE: 'maplibre',
})

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
