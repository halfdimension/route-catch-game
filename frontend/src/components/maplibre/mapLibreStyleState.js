export const MAP_STYLE_STATUS = Object.freeze({
  LOADING: 'loading',
  LOADED: 'loaded',
  LOADED_WITHOUT_BUILDINGS: 'loaded-without-buildings',
  FATAL: 'fatal',
})

const STYLE_STATUS_LABELS = Object.freeze({
  [MAP_STYLE_STATUS.LOADING]: 'Loading style',
  [MAP_STYLE_STATUS.LOADED]: 'Style loaded',
  [MAP_STYLE_STATUS.LOADED_WITHOUT_BUILDINGS]:
    'Style loaded without compatible 3D buildings',
  [MAP_STYLE_STATUS.FATAL]: 'Fatal map/worker initialization error',
})

function createStyleState(status, errorMessage = '') {
  return {
    status,
    label: STYLE_STATUS_LABELS[status],
    errorMessage,
  }
}

export function createLoadingStyleState() {
  return createStyleState(MAP_STYLE_STATUS.LOADING)
}

export function createLoadedStyleState(hasCompatibleBuildings) {
  return createStyleState(
    hasCompatibleBuildings
      ? MAP_STYLE_STATUS.LOADED
      : MAP_STYLE_STATUS.LOADED_WITHOUT_BUILDINGS,
  )
}

export function createFatalStyleState(error) {
  return createStyleState(
    MAP_STYLE_STATUS.FATAL,
    error?.message || 'MapLibre could not initialize its renderer.',
  )
}

export function isWorkerInitializationError(error) {
  return /(?:web\s*worker|worker(?:\s+script)?)/i.test(error?.message || '')
}

export function transitionStyleStateForError(currentState, error) {
  if (
    currentState.status === MAP_STYLE_STATUS.LOADING ||
    isWorkerInitializationError(error)
  ) {
    return createFatalStyleState(error)
  }

  return currentState
}

export function isRouteEligible(styleState, routeCoordinates) {
  const isStyleLoaded = [
    MAP_STYLE_STATUS.LOADED,
    MAP_STYLE_STATUS.LOADED_WITHOUT_BUILDINGS,
  ].includes(styleState?.status)

  return (
    isStyleLoaded &&
    Array.isArray(routeCoordinates) &&
    routeCoordinates.length >= 2
  )
}
