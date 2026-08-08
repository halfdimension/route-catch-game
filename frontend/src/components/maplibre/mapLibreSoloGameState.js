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
export const DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE = Object.freeze({
  minZoom: 16.5,
  zoom: 17.5,
  maxZoom: 18.3,
  pitch: 55,
  lookAheadFocusFraction: 0.62,
})
export const SOLO_FOLLOW_MIN_ZOOM =
  DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE.minZoom
export const SOLO_FOLLOW_ZOOM = DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE.zoom
export const SOLO_FOLLOW_MAX_ZOOM =
  DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE.maxZoom
export const SOLO_FOLLOW_PITCH = DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE.pitch
export const SOLO_OVERVIEW_MAX_ZOOM = 15.75
export const SOLO_OVERVIEW_PITCH = 24
export const SOLO_CAMERA_PROGRAMMATIC_EVENT = 'solo-navigation-camera'

export const SOLO_CAMERA_MODES = Object.freeze({
  OVERVIEW: 'OVERVIEW',
  FOLLOW: 'FOLLOW',
  FREE: 'FREE',
})

export const SOLO_CAMERA_EVENTS = Object.freeze({
  ROUTE_PREPARED: 'ROUTE_PREPARED',
  MOVEMENT_STARTED: 'MOVEMENT_STARTED',
  MOVEMENT_STOPPED: 'MOVEMENT_STOPPED',
  USER_INTERACTION: 'USER_INTERACTION',
  RESUME_FOLLOW: 'RESUME_FOLLOW',
})

export const SOLO_NAVIGATION_DESTINATION_EVENTS = Object.freeze({
  ROUTE_PREPARED: 'ROUTE_PREPARED',
  NAVIGATION_FRAME: 'NAVIGATION_FRAME',
  ROUTE_CLEARED: 'ROUTE_CLEARED',
})

export const SOLO_CAMERA_INTERACTION_TYPES = Object.freeze({
  PROGRAMMATIC: 'PROGRAMMATIC',
  ZOOM: 'ZOOM',
  DETACH: 'DETACH',
  DEFER: 'DEFER',
})

export const SOLO_FOLLOW_ZOOM_EVENTS = Object.freeze({
  ROUTE_PREPARED: 'ROUTE_PREPARED',
  USER_ZOOMED: 'USER_ZOOMED',
})

export const SOLO_TARGET_ANIMATION_CLASS_NAMES = Object.freeze({
  COMMON: 'animation-common',
  RARE: 'animation-rare',
  LEGENDARY: 'animation-legendary',
  UNKNOWN: 'animation-common',
})

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
    essential: false,
  })

  return true
}

export function transitionSoloCameraMode(currentMode, eventType) {
  switch (eventType) {
    case SOLO_CAMERA_EVENTS.ROUTE_PREPARED:
    case SOLO_CAMERA_EVENTS.MOVEMENT_STOPPED:
      return SOLO_CAMERA_MODES.OVERVIEW
    case SOLO_CAMERA_EVENTS.MOVEMENT_STARTED:
      return currentMode === SOLO_CAMERA_MODES.FREE
        ? SOLO_CAMERA_MODES.FREE
        : SOLO_CAMERA_MODES.FOLLOW
    case SOLO_CAMERA_EVENTS.USER_INTERACTION:
      return SOLO_CAMERA_MODES.FREE
    case SOLO_CAMERA_EVENTS.RESUME_FOLLOW:
      return SOLO_CAMERA_MODES.FOLLOW
    default:
      return currentMode
  }
}

export function normalizeSoloCameraBearing(bearingDegrees) {
  const bearing = Number(bearingDegrees)

  if (!Number.isFinite(bearing)) {
    return 0
  }

  return ((bearing % 360) + 360) % 360
}

export function getShortestSoloCameraBearingDelta(
  currentBearingDegrees,
  targetBearingDegrees,
) {
  const current = normalizeSoloCameraBearing(currentBearingDegrees)
  const target = normalizeSoloCameraBearing(targetBearingDegrees)
  return ((target - current + 540) % 360) - 180
}

export function smoothSoloCameraBearing(
  currentBearingDegrees,
  targetBearingDegrees,
  elapsedMs,
  smoothingTimeConstantMs = 260,
) {
  const delta = getShortestSoloCameraBearingDelta(
    currentBearingDegrees,
    targetBearingDegrees,
  )

  if (Math.abs(delta) < 0.2) {
    return normalizeSoloCameraBearing(targetBearingDegrees)
  }

  const safeElapsedMs = Math.max(0, Number(elapsedMs) || 0)
  const safeTimeConstantMs = Math.max(
    1,
    Number(smoothingTimeConstantMs) || 1,
  )
  const smoothing = 1 - Math.exp(-safeElapsedMs / safeTimeConstantMs)

  return normalizeSoloCameraBearing(
    normalizeSoloCameraBearing(currentBearingDegrees) + delta * smoothing,
  )
}

export function isSoloCameraUserInteraction(event) {
  if (event?.originalEvent) {
    return true
  }

  if (event?.soloCameraOperation === SOLO_CAMERA_PROGRAMMATIC_EVENT) {
    return false
  }

  return false
}

function isZoomKeyboardEvent(originalEvent) {
  return (
    originalEvent?.type === 'keydown' &&
    ['+', '=', '-', '_'].includes(originalEvent.key)
  )
}

export function getSoloCameraInteractionType(event) {
  if (!event?.originalEvent) {
    return SOLO_CAMERA_INTERACTION_TYPES.PROGRAMMATIC
  }

  if (
    event.type === 'wheel' ||
    event.type === 'zoomstart' ||
    event.type === 'zoom' ||
    event.type === 'zoomend'
  ) {
    return SOLO_CAMERA_INTERACTION_TYPES.ZOOM
  }

  if (event.type === 'movestart') {
    const originalEventType = String(event.originalEvent.type || '')

    if (
      ['wheel', 'dblclick', 'click'].includes(originalEventType) ||
      isZoomKeyboardEvent(event.originalEvent)
    ) {
      return SOLO_CAMERA_INTERACTION_TYPES.ZOOM
    }

    if (
      originalEventType.startsWith('mouse') ||
      originalEventType.startsWith('pointer') ||
      originalEventType.startsWith('touch')
    ) {
      return SOLO_CAMERA_INTERACTION_TYPES.DEFER
    }
  }

  return SOLO_CAMERA_INTERACTION_TYPES.DETACH
}

export function transitionSoloFollowZoom(currentZoom, event) {
  switch (event?.type) {
    case SOLO_FOLLOW_ZOOM_EVENTS.ROUTE_PREPARED:
      return null
    case SOLO_FOLLOW_ZOOM_EVENTS.USER_ZOOMED:
      return Number.isFinite(event.zoom)
        ? clampSoloFollowZoom(event.zoom, event.cameraProfile)
        : currentZoom
    default:
      return currentZoom
  }
}

export function clampSoloFollowZoom(
  zoom,
  cameraProfile = DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE,
) {
  const numericZoom = Number(zoom)

  if (!Number.isFinite(numericZoom)) {
    return cameraProfile.zoom
  }

  return Math.min(
    cameraProfile.maxZoom,
    Math.max(cameraProfile.minZoom, numericZoom),
  )
}

export function getSoloReducedMotionCameraPolicy(
  prefersReducedMotion,
  cameraProfile = DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE,
) {
  if (prefersReducedMotion) {
    return {
      overviewDurationMs: 0,
      followEntryDurationMs: 0,
      resumeDurationMs: 0,
      followPitch: 0,
      overviewPitch: 0,
      tracksBearing: false,
    }
  }

  return {
    overviewDurationMs: 240,
    followEntryDurationMs: 120,
    resumeDurationMs: 260,
    followPitch: cameraProfile.pitch,
    overviewPitch: SOLO_OVERVIEW_PITCH,
    tracksBearing: true,
  }
}

export function getSoloRouteDestination(routeCoordinates) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
    return null
  }

  const finalCoordinate = routeCoordinates[routeCoordinates.length - 1]

  if (
    !Array.isArray(finalCoordinate) ||
    finalCoordinate.length < 2 ||
    !Number.isFinite(finalCoordinate[0]) ||
    !Number.isFinite(finalCoordinate[1])
  ) {
    return null
  }

  return {
    lat: finalCoordinate[0],
    lon: finalCoordinate[1],
  }
}

export function transitionSoloNavigationDestination(
  currentDestination,
  event,
) {
  switch (event?.type) {
    case SOLO_NAVIGATION_DESTINATION_EVENTS.ROUTE_PREPARED:
      return (
        event.pendingDestination ||
        getSoloRouteDestination(event.routeCoordinates)
      )
    case SOLO_NAVIGATION_DESTINATION_EVENTS.NAVIGATION_FRAME:
      if (
        event.navigationFrame?.progress >= 1 ||
        (event.previousFrame?.isMoving &&
          !event.navigationFrame?.isMoving)
      ) {
        return null
      }

      return currentDestination
    case SOLO_NAVIGATION_DESTINATION_EVENTS.ROUTE_CLEARED:
      return null
    default:
      return currentDestination
  }
}

function unwrapLongitude(longitude, referenceLongitude) {
  let unwrappedLongitude = longitude

  while (unwrappedLongitude - referenceLongitude > 180) {
    unwrappedLongitude -= 360
  }

  while (unwrappedLongitude - referenceLongitude < -180) {
    unwrappedLongitude += 360
  }

  return unwrappedLongitude
}

export function createSoloOverviewBounds({
  playerPosition,
  destination,
  routeCoordinates,
}) {
  const mapCoordinates = []
  const playerCoordinate = toMapLibreLngLat(playerPosition)
  const destinationCoordinate = toMapLibreLngLat(destination)

  if (playerCoordinate) {
    mapCoordinates.push(playerCoordinate)
  }

  if (Array.isArray(routeCoordinates)) {
    routeCoordinates.forEach((coordinate) => {
      const mapCoordinate = toMapLibreCoordinate(coordinate)

      if (mapCoordinate) {
        mapCoordinates.push(mapCoordinate)
      }
    })
  }

  if (destinationCoordinate) {
    mapCoordinates.push(destinationCoordinate)
  }

  if (mapCoordinates.length === 0) {
    return null
  }

  const referenceLongitude = mapCoordinates[0][0]
  const normalizedCoordinates = mapCoordinates.map(([longitude, latitude]) => [
    unwrapLongitude(longitude, referenceLongitude),
    latitude,
  ])
  const longitudes = normalizedCoordinates.map(([longitude]) => longitude)
  const latitudes = normalizedCoordinates.map(([, latitude]) => latitude)

  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ]
}

export function createSoloFollowCameraOptions(
  navigationFrame,
  {
    currentBearingDegrees = 0,
    previousTimestampMs = navigationFrame?.timestampMs,
    prefersReducedMotion = false,
    followZoom = null,
    cameraProfile = DEFAULT_SOLO_NAVIGATION_CAMERA_PROFILE,
  } = {},
) {
  const player = toMapLibreLngLat(navigationFrame?.position)
  const lookAhead = toMapLibreLngLat(navigationFrame?.lookAheadPosition)

  if (!player) {
    return null
  }

  const focusFraction = cameraProfile.lookAheadFocusFraction
  const center = lookAhead
    ? [
        player[0] + (lookAhead[0] - player[0]) * focusFraction,
        player[1] + (lookAhead[1] - player[1]) * focusFraction,
      ]
    : player
  const policy = getSoloReducedMotionCameraPolicy(
    prefersReducedMotion,
    cameraProfile,
  )
  const elapsedMs = Math.max(
    0,
    Number(navigationFrame.timestampMs) - Number(previousTimestampMs),
  )
  const targetBearing = Number.isFinite(navigationFrame.bearingDegrees)
    ? navigationFrame.bearingDegrees
    : currentBearingDegrees
  const bearing = policy.tracksBearing
    ? smoothSoloCameraBearing(
        currentBearingDegrees,
        targetBearing,
        elapsedMs || 16,
      )
    : 0

  return {
    center,
    zoom: clampSoloFollowZoom(
      Number.isFinite(followZoom) ? followZoom : cameraProfile.zoom,
      cameraProfile,
    ),
    pitch: policy.followPitch,
    bearing,
  }
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
  const animationClassName =
    SOLO_TARGET_ANIMATION_CLASS_NAMES[
      String(target?.rarity ?? '').trim().toUpperCase()
    ] || SOLO_TARGET_ANIMATION_CLASS_NAMES.UNKNOWN

  return {
    ...viewModel,
    mapPosition,
    animationClassName,
    className:
      `maplibre-solo-target ${viewModel.rarityClassName} ${animationClassName}` +
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
