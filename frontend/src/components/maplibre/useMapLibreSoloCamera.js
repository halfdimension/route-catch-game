import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  createSoloFollowCameraOptions,
  createSoloOverviewBounds,
  getSoloCameraInteractionType,
  getSoloReducedMotionCameraPolicy,
  getSoloRouteDestination,
  isSoloCameraUserInteraction,
  SOLO_CAMERA_EVENTS,
  SOLO_CAMERA_INTERACTION_TYPES,
  SOLO_CAMERA_MODES,
  SOLO_CAMERA_PROGRAMMATIC_EVENT,
  SOLO_NAVIGATION_DESTINATION_EVENTS,
  SOLO_FOLLOW_ZOOM_EVENTS,
  SOLO_OVERVIEW_MAX_ZOOM,
  transitionSoloFollowZoom,
  transitionSoloNavigationDestination,
  transitionSoloCameraMode,
} from './mapLibreSoloGameState.js'

const CAMERA_PADDING_PROPERTIES = Object.freeze({
  top: '--ml-camera-padding-top',
  right: '--ml-camera-padding-right',
  bottom: '--ml-camera-padding-bottom',
  left: '--ml-camera-padding-left',
})

const DEFAULT_CAMERA_PADDING = Object.freeze({
  top: 96,
  right: 326,
  bottom: 64,
  left: 48,
})

function getCameraPadding(map) {
  const mapContainer = map?.getContainer?.()
  const gameShell = mapContainer?.closest?.('.is-maplibre-experience')

  if (!gameShell || typeof window.getComputedStyle !== 'function') {
    return DEFAULT_CAMERA_PADDING
  }

  const computedStyle = window.getComputedStyle(gameShell)

  return Object.fromEntries(
    Object.entries(CAMERA_PADDING_PROPERTIES).map(([side, propertyName]) => {
      const parsedValue = Number.parseFloat(
        computedStyle.getPropertyValue(propertyName),
      )

      return [
        side,
        Number.isFinite(parsedValue)
          ? Math.max(0, parsedValue)
          : DEFAULT_CAMERA_PADDING[side],
      ]
    }),
  )
}

function getMapInstance(mapRef) {
  const map = mapRef.current

  if (!map || typeof map.jumpTo !== 'function') {
    return null
  }

  return map
}

export function createSoloCameraWorkManager({
  scheduleTimer = (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer = (timerId) => window.clearTimeout(timerId),
  getMap = () => null,
} = {}) {
  let operationRevision = 0
  const timerIds = new Set()

  function clearTimers() {
    timerIds.forEach((timerId) => clearTimer(timerId))
    timerIds.clear()
  }

  return {
    getRevision() {
      return operationRevision
    },
    schedule(callback, delayMs, expectedRevision = operationRevision) {
      const timerId = scheduleTimer(() => {
        timerIds.delete(timerId)

        if (expectedRevision !== operationRevision) {
          return
        }

        callback()
      }, Math.max(0, delayMs))

      timerIds.add(timerId)
      return timerId
    },
    invalidate({ stopMap = false } = {}) {
      operationRevision += 1
      clearTimers()

      if (stopMap) {
        getMap()?.stop?.()
      }

      return operationRevision
    },
  }
}

export function useMapLibreSoloCamera({
  mapRef,
  playerPosition,
  pendingDestination,
  routeCoordinates,
  isMoving,
  subscribeToNavigationFrames,
}) {
  const [cameraMode, setCameraMode] = useState(
    SOLO_CAMERA_MODES.OVERVIEW,
  )
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [activeNavigationDestination, setActiveNavigationDestination] =
    useState(null)
  const mountedRef = useRef(true)
  const mapReadyRef = useRef(false)
  const cameraModeRef = useRef(SOLO_CAMERA_MODES.OVERVIEW)
  const prefersReducedMotionRef = useRef(false)
  const latestNavigationFrameRef = useRef(null)
  const activeRouteRevisionRef = useRef(0)
  const lastCameraBearingRef = useRef(0)
  const lastCameraTimestampRef = useRef(0)
  const automaticTransitionRef = useRef(false)
  const followZoomRef = useRef(null)
  const userZoomInteractionRef = useRef(false)
  const playerPositionRef = useRef(playerPosition)
  const pendingDestinationRef = useRef(pendingDestination)
  const routeCoordinatesRef = useRef(routeCoordinates)
  const cameraWorkManagerRef = useRef(null)

  if (cameraWorkManagerRef.current == null) {
    cameraWorkManagerRef.current = createSoloCameraWorkManager({
      getMap: () => getMapInstance(mapRef),
    })
  }

  useEffect(() => {
    playerPositionRef.current = playerPosition
  }, [playerPosition])

  useEffect(() => {
    pendingDestinationRef.current = pendingDestination
  }, [pendingDestination])

  useEffect(() => {
    routeCoordinatesRef.current = routeCoordinates
  }, [routeCoordinates])

  const updateCameraMode = useCallback((eventType) => {
    const currentMode = cameraModeRef.current
    const nextMode = transitionSoloCameraMode(currentMode, eventType)

    if (nextMode === currentMode) {
      return currentMode
    }

    cameraModeRef.current = nextMode

    if (mountedRef.current) {
      setCameraMode(nextMode)
    }

    return nextMode
  }, [])

  const updateNavigationDestination = useCallback((event) => {
    if (!mountedRef.current) {
      return
    }

    setActiveNavigationDestination((currentDestination) =>
      transitionSoloNavigationDestination(currentDestination, event),
    )
  }, [])

  const scheduleCameraWork = useCallback((callback, delayMs, revision) => {
    return cameraWorkManagerRef.current.schedule(
      callback,
      delayMs,
      revision,
    )
  }, [])

  const cancelCameraTransitions = useCallback(
    ({ stopMap = false } = {}) => {
      automaticTransitionRef.current = false
      return cameraWorkManagerRef.current.invalidate({ stopMap })
    },
    [],
  )

  const applyFollowFrame = useCallback(
    (navigationFrame, transitionDurationMs = 0) => {
      const map = getMapInstance(mapRef)

      if (!mapReadyRef.current || !map || !navigationFrame) {
        return false
      }

      const options = createSoloFollowCameraOptions(navigationFrame, {
        currentBearingDegrees: lastCameraBearingRef.current,
        previousTimestampMs: lastCameraTimestampRef.current,
        prefersReducedMotion: prefersReducedMotionRef.current,
        followZoom: followZoomRef.current,
      })

      if (!options) {
        return false
      }

      lastCameraBearingRef.current = options.bearing
      lastCameraTimestampRef.current = navigationFrame.timestampMs
      const eventData = {
        soloCameraOperation: SOLO_CAMERA_PROGRAMMATIC_EVENT,
      }

      if (transitionDurationMs > 0) {
        map.easeTo(
          {
            ...options,
            duration: transitionDurationMs,
            essential: false,
          },
          eventData,
        )
      } else {
        map.jumpTo(options, eventData)
      }

      return true
    },
    [mapRef],
  )

  const fitOverview = useCallback(() => {
    const map = getMapInstance(mapRef)
    const route = routeCoordinatesRef.current
    const navigationFrame = latestNavigationFrameRef.current

    if (
      !mapReadyRef.current ||
      !map ||
      !Array.isArray(route) ||
      route.length < 2 ||
      (navigationFrame?.routeRevision === activeRouteRevisionRef.current &&
        navigationFrame.progress >= 1) ||
      cameraModeRef.current === SOLO_CAMERA_MODES.FREE
    ) {
      return false
    }

    cancelCameraTransitions({ stopMap: true })
    updateCameraMode(SOLO_CAMERA_EVENTS.ROUTE_PREPARED)
    const destination =
      pendingDestinationRef.current || getSoloRouteDestination(route)
    const bounds = createSoloOverviewBounds({
      playerPosition: playerPositionRef.current,
      destination,
      routeCoordinates: route,
    })

    if (!bounds) {
      return false
    }

    const policy = getSoloReducedMotionCameraPolicy(
      prefersReducedMotionRef.current,
    )
    const operationRevision = cameraWorkManagerRef.current.getRevision()
    automaticTransitionRef.current = true
    map.fitBounds(
      bounds,
      {
        padding: getCameraPadding(map),
        maxZoom: SOLO_OVERVIEW_MAX_ZOOM,
        bearing: 0,
        pitch: policy.overviewPitch,
        duration: policy.overviewDurationMs,
        linear: true,
        essential: false,
      },
      { soloCameraOperation: SOLO_CAMERA_PROGRAMMATIC_EVENT },
    )

    scheduleCameraWork(() => {
      if (
        operationRevision !== cameraWorkManagerRef.current.getRevision() ||
        cameraModeRef.current === SOLO_CAMERA_MODES.FREE
      ) {
        return
      }

      const navigationFrame = latestNavigationFrameRef.current

      if (
        navigationFrame &&
        navigationFrame.routeRevision === activeRouteRevisionRef.current
      ) {
        applyFollowFrame(
          navigationFrame,
          policy.followEntryDurationMs,
        )
      }
    }, policy.overviewDurationMs, operationRevision)

    return true
  }, [
    applyFollowFrame,
    cancelCameraTransitions,
    mapRef,
    scheduleCameraWork,
    updateCameraMode,
  ])

  const handleNavigationFrame = useCallback(
    (navigationFrame) => {
      if (!navigationFrame) {
        return
      }

      const currentRevision = activeRouteRevisionRef.current

      if (navigationFrame.routeRevision < currentRevision) {
        return
      }

      if (navigationFrame.routeRevision > currentRevision) {
        cancelCameraTransitions({ stopMap: true })
        followZoomRef.current = transitionSoloFollowZoom(
          followZoomRef.current,
          { type: SOLO_FOLLOW_ZOOM_EVENTS.ROUTE_PREPARED },
        )
        userZoomInteractionRef.current = false
        activeRouteRevisionRef.current = navigationFrame.routeRevision
        latestNavigationFrameRef.current = navigationFrame
        lastCameraTimestampRef.current = navigationFrame.timestampMs
        const map = getMapInstance(mapRef)
        lastCameraBearingRef.current = Number(map?.getBearing?.()) || 0
        updateNavigationDestination({
          type: SOLO_NAVIGATION_DESTINATION_EVENTS.NAVIGATION_FRAME,
          navigationFrame,
          previousFrame: null,
        })
        updateCameraMode(SOLO_CAMERA_EVENTS.ROUTE_PREPARED)
        return
      }

      const previousFrame = latestNavigationFrameRef.current
      latestNavigationFrameRef.current = navigationFrame
      updateNavigationDestination({
        type: SOLO_NAVIGATION_DESTINATION_EVENTS.NAVIGATION_FRAME,
        navigationFrame,
        previousFrame,
      })

      if (navigationFrame.isMoving) {
        if (
          cameraModeRef.current === SOLO_CAMERA_MODES.FREE ||
          userZoomInteractionRef.current
        ) {
          return
        }

        if (
          cameraModeRef.current === SOLO_CAMERA_MODES.FOLLOW &&
          automaticTransitionRef.current
        ) {
          return
        }

        updateCameraMode(SOLO_CAMERA_EVENTS.MOVEMENT_STARTED)
        automaticTransitionRef.current = false
        applyFollowFrame(navigationFrame)
        return
      }

      if (previousFrame?.isMoving) {
        cancelCameraTransitions()
        updateCameraMode(SOLO_CAMERA_EVENTS.MOVEMENT_STOPPED)
      }
    }, [
      applyFollowFrame,
      cancelCameraTransitions,
      mapRef,
      updateCameraMode,
      updateNavigationDestination,
    ],
  )

  useEffect(() => {
    if (typeof subscribeToNavigationFrames !== 'function') {
      return undefined
    }

    return subscribeToNavigationFrames(handleNavigationFrame)
  }, [handleNavigationFrame, subscribeToNavigationFrames])

  useLayoutEffect(() => {
    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      cancelCameraTransitions({ stopMap: true })
      followZoomRef.current = null
      userZoomInteractionRef.current = false
      latestNavigationFrameRef.current = null
      lastCameraTimestampRef.current = 0
      updateNavigationDestination({
        type: SOLO_NAVIGATION_DESTINATION_EVENTS.ROUTE_CLEARED,
      })
      updateCameraMode(SOLO_CAMERA_EVENTS.MOVEMENT_STOPPED)
      return
    }

    const navigationFrame = latestNavigationFrameRef.current

    if (
      navigationFrame?.routeRevision === activeRouteRevisionRef.current &&
      navigationFrame.progress >= 1
    ) {
      updateNavigationDestination({
        type: SOLO_NAVIGATION_DESTINATION_EVENTS.NAVIGATION_FRAME,
        navigationFrame,
        previousFrame: navigationFrame,
      })
      return
    }

    updateNavigationDestination({
      type: SOLO_NAVIGATION_DESTINATION_EVENTS.ROUTE_PREPARED,
      pendingDestination: pendingDestinationRef.current,
      routeCoordinates,
    })

    fitOverview()
  }, [
    cancelCameraTransitions,
    fitOverview,
    routeCoordinates,
    updateCameraMode,
    updateNavigationDestination,
  ])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handlePreferenceChange = (event) => {
      const nextValue = Boolean(event.matches)
      prefersReducedMotionRef.current = nextValue
      if (mountedRef.current) {
        setPrefersReducedMotion(nextValue)
      }

      if (
        cameraModeRef.current === SOLO_CAMERA_MODES.FOLLOW &&
        latestNavigationFrameRef.current?.isMoving
      ) {
        applyFollowFrame(latestNavigationFrameRef.current)
      }
    }

    handlePreferenceChange(mediaQuery)
    mediaQuery.addEventListener?.('change', handlePreferenceChange)

    return () => {
      mediaQuery.removeEventListener?.('change', handlePreferenceChange)
    }
  }, [applyFollowFrame])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      mapReadyRef.current = false
      cancelCameraTransitions({ stopMap: true })
    }
  }, [cancelCameraTransitions])

  const handleMapLoad = useCallback(() => {
    mapReadyRef.current = true
    const map = getMapInstance(mapRef)
    lastCameraBearingRef.current = Number(map?.getBearing?.()) || 0

    if (latestNavigationFrameRef.current?.isMoving) {
      updateCameraMode(SOLO_CAMERA_EVENTS.MOVEMENT_STARTED)
      applyFollowFrame(latestNavigationFrameRef.current)
    } else {
      fitOverview()
    }
  }, [applyFollowFrame, fitOverview, mapRef, updateCameraMode])

  const handleCameraInteraction = useCallback(
    (event) => {
      if (
        !isSoloCameraUserInteraction(event) ||
        getSoloCameraInteractionType(event) !==
          SOLO_CAMERA_INTERACTION_TYPES.DETACH
      ) {
        return
      }

      if (
        cameraModeRef.current !== SOLO_CAMERA_MODES.FOLLOW &&
        !automaticTransitionRef.current
      ) {
        return
      }

      cancelCameraTransitions({ stopMap: true })
      userZoomInteractionRef.current = false
      updateCameraMode(SOLO_CAMERA_EVENTS.USER_INTERACTION)
    },
    [cancelCameraTransitions, updateCameraMode],
  )

  const handleFollowZoomStart = useCallback(
    (event) => {
      if (
        getSoloCameraInteractionType(event) !==
          SOLO_CAMERA_INTERACTION_TYPES.ZOOM ||
        cameraModeRef.current !== SOLO_CAMERA_MODES.FOLLOW
      ) {
        return
      }

      userZoomInteractionRef.current = true
      cancelCameraTransitions()
    },
    [cancelCameraTransitions],
  )

  const handleFollowZoomEnd = useCallback(
    (event) => {
      const wasUserZooming = userZoomInteractionRef.current

      if (
        !wasUserZooming &&
        getSoloCameraInteractionType(event) !==
          SOLO_CAMERA_INTERACTION_TYPES.ZOOM
      ) {
        return
      }

      userZoomInteractionRef.current = false

      if (cameraModeRef.current !== SOLO_CAMERA_MODES.FOLLOW) {
        return
      }

      const map = getMapInstance(mapRef)
      followZoomRef.current = transitionSoloFollowZoom(
        followZoomRef.current,
        {
          type: SOLO_FOLLOW_ZOOM_EVENTS.USER_ZOOMED,
          zoom: Number(map?.getZoom?.()),
        },
      )

      if (latestNavigationFrameRef.current?.isMoving) {
        applyFollowFrame(latestNavigationFrameRef.current)
      }
    },
    [applyFollowFrame, mapRef],
  )

  const resumeFollow = useCallback(() => {
    const navigationFrame = latestNavigationFrameRef.current

    if (!navigationFrame?.isMoving) {
      return false
    }

    cancelCameraTransitions({ stopMap: true })
    userZoomInteractionRef.current = false
    updateCameraMode(SOLO_CAMERA_EVENTS.RESUME_FOLLOW)
    const policy = getSoloReducedMotionCameraPolicy(
      prefersReducedMotionRef.current,
    )
    const operationRevision = cameraWorkManagerRef.current.getRevision()
    automaticTransitionRef.current = true
    applyFollowFrame(navigationFrame, policy.resumeDurationMs)
    scheduleCameraWork(() => {
      if (
        operationRevision !== cameraWorkManagerRef.current.getRevision() ||
        cameraModeRef.current !== SOLO_CAMERA_MODES.FOLLOW
      ) {
        return
      }

      automaticTransitionRef.current = false
      applyFollowFrame(latestNavigationFrameRef.current)
    }, policy.resumeDurationMs, operationRevision)

    return true
  }, [
    applyFollowFrame,
    cancelCameraTransitions,
    scheduleCameraWork,
    updateCameraMode,
  ])

  return {
    cameraMode,
    prefersReducedMotion,
    activeNavigationDestination,
    canResumeFollow:
      cameraMode === SOLO_CAMERA_MODES.FREE && Boolean(isMoving),
    handleMapLoad,
    handleCameraInteraction,
    handleFollowZoomEnd,
    handleFollowZoomStart,
    resumeFollow,
  }
}
