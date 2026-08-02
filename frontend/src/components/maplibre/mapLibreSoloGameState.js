import { getTargetMarkerViewModel } from '../targetMarkerViewModel.js'
import {
  INITIAL_MAP_CENTER,
  INITIAL_MAP_ZOOM,
} from '../../config/mapConfig.js'
import {
  fromMapLibreLngLat,
  toMapLibreCoordinate,
  toMapLibreLngLat,
} from './mapLibreCoordinates.js'

export const SOLO_RECENTER_MIN_ZOOM = 11

export const SOLO_MAP_INTERACTION_PROPS = Object.freeze({
  interactive: true,
  cooperativeGestures: false,
  boxZoom: true,
  doubleClickZoom: true,
  dragPan: true,
  dragRotate: true,
  keyboard: true,
  pitchWithRotate: true,
  scrollZoom: true,
  touchPitch: true,
  touchZoomRotate: true,
})

function getDisplayName(playerName) {
  const displayName = String(playerName ?? '').trim()

  return displayName || 'Guest'
}

export function createSoloInitialViewState(playerPosition) {
  const center =
    toMapLibreLngLat(playerPosition) ||
    toMapLibreCoordinate(INITIAL_MAP_CENTER)

  return {
    longitude: center[0],
    latitude: center[1],
    zoom: INITIAL_MAP_ZOOM,
    pitch: 40,
    bearing: 0,
  }
}

export function recenterSoloMap(map, playerPosition) {
  const center = toMapLibreLngLat(playerPosition)

  if (!map || !center) {
    return false
  }

  const currentZoom = Number(map.getZoom?.())
  const zoom =
    Number.isFinite(currentZoom) &&
    currentZoom >= SOLO_RECENTER_MIN_ZOOM
      ? currentZoom
      : Math.max(INITIAL_MAP_ZOOM, SOLO_RECENTER_MIN_ZOOM)

  map.easeTo({
    center,
    zoom,
    duration: 450,
    essential: true,
  })

  return true
}

export function getSoloPlayerMarkerViewState(
  playerPosition,
  playerName,
  avatarUrl = '',
) {
  const mapPosition = toMapLibreLngLat(playerPosition)

  if (!mapPosition) {
    return null
  }

  const displayName = getDisplayName(playerName)

  return {
    mapPosition,
    displayName,
    initial: displayName.charAt(0).toUpperCase() || 'G',
    avatarUrl: String(avatarUrl || ''),
    title: `${displayName}, local player`,
  }
}

export function getSoloDestinationMarkerViewState(pendingDestination) {
  const mapPosition = toMapLibreLngLat(pendingDestination)

  return mapPosition
    ? {
        mapPosition,
        title: 'Pending destination',
      }
    : null
}

export function getSoloTargetMarkerViewState(
  target,
  chasedTargetId,
  routingTargetId,
  now = Date.now(),
) {
  const mapPosition = toMapLibreLngLat(target)

  if (!mapPosition) {
    return null
  }

  const viewModel = getTargetMarkerViewModel(target, {
    isChased: target?.id === chasedTargetId,
    isRouting: target?.id === routingTargetId,
    now,
  })

  return {
    ...viewModel,
    mapPosition,
    className:
      `maplibre-solo-target ${viewModel.rarityClassName}` +
      viewModel.chaseClassName,
  }
}

export function getCaughtTargetEffectViewState(caughtTarget) {
  const mapPosition = toMapLibreLngLat(caughtTarget)

  if (!mapPosition) {
    return null
  }

  const score = Number(caughtTarget?.score)
  const rarityClassName = getTargetMarkerViewModel(caughtTarget)
    .rarityClassName

  return {
    mapPosition,
    score: Number.isFinite(score) ? score : 0,
    className: `maplibre-solo-catch-effect ${rarityClassName}`,
  }
}

export function createSoloDestinationFromMapClick(lngLat) {
  return fromMapLibreLngLat(lngLat)
}

export function createSoloDestinationFromMapEvent(event) {
  return event?.type === 'click'
    ? createSoloDestinationFromMapClick(event.lngLat)
    : null
}

export function handleSoloTargetMarkerClick(
  event,
  target,
  onTargetClick,
) {
  event?.stopPropagation?.()
  onTargetClick(target)
}
