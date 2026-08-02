import { fromMapLibreLngLat } from './mapLibreCoordinates.js'

export const SAMPLE_CREATURES = Object.freeze([
  Object.freeze({
    id: 'sample-common',
    name: 'Metro Mite',
    rarity: 'Common',
    symbol: 'M',
    lat: 28.6162,
    lon: 77.2118,
  }),
  Object.freeze({
    id: 'sample-rare',
    name: 'Azure Jackal',
    rarity: 'Rare',
    symbol: 'J',
    lat: 28.6107,
    lon: 77.2057,
  }),
  Object.freeze({
    id: 'sample-legendary',
    name: 'Violet Garuda',
    rarity: 'Legendary',
    symbol: 'G',
    lat: 28.619,
    lon: 77.2064,
  }),
])

export function getCreatureMarkerViewState(
  creature,
  selectedCreatureId,
  routingCreatureId,
) {
  const isSelected = creature.id === selectedCreatureId
  const isRouting = creature.id === routingCreatureId
  const rarityClassName = String(creature.rarity || 'Common').toLowerCase()
  const stateClassName = [
    isSelected ? 'is-selected' : '',
    isRouting ? 'is-routing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    isSelected,
    isRouting,
    className: [
      'maplibre-prototype-creature',
      `rarity-${rarityClassName}`,
      stateClassName,
    ]
      .filter(Boolean)
      .join(' '),
    statusLabel: isRouting
      ? 'Routing'
      : isSelected
        ? 'Chasing'
        : creature.rarity,
  }
}

export function createDestinationFromMapClick(lngLat) {
  return fromMapLibreLngLat(lngLat)
}
