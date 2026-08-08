import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRoute, isRouteUnavailableError } from '../api/osrmClient'
import {
  DEFAULT_SIMULATION_SPEED,
  INITIAL_PLAYER_POSITION,
} from '../config/gameConfig'
import { API_BASE_URL } from '../config/apiConfig'
import { useRouteAnimation } from './useRouteAnimation'
import { createNavigationFrameChannel } from './navigationFrameChannel.js'

const ROUTE_UNAVAILABLE_MESSAGE = 'Could not find a route to this target.'

function isAbortError(error) {
  return error?.name === 'AbortError'
}

export function usePlayerState({ routeAnimationStartDelayMs = 0 } = {}) {
  const [playerPosition, setPlayerPosition] = useState(INITIAL_PLAYER_POSITION)
  const [simulationSpeed, setSimulationSpeed] = useState(
    DEFAULT_SIMULATION_SPEED,
  )
  const [pendingDestination, setPendingDestination] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const routeRequestIdRef = useRef(0)
  const routeAbortControllerRef = useRef(null)
  const playerPositionRef = useRef(INITIAL_PLAYER_POSITION)
  const navigationFrameChannelRef = useRef(null)

  if (navigationFrameChannelRef.current == null) {
    navigationFrameChannelRef.current = createNavigationFrameChannel()
  }

  const publishNavigationFrame = useCallback((navigationFrame) => {
    navigationFrameChannelRef.current.publish(navigationFrame)
  }, [])
  const { isMoving, startAnimation, cancelAnimation } = useRouteAnimation({
    speedMetersPerSecond: simulationSpeed,
    startDelayMs: routeAnimationStartDelayMs,
    onPositionChange: (nextPosition) => {
      playerPositionRef.current = nextPosition
      setPlayerPosition(nextPosition)
    },
    onNavigationFrame: publishNavigationFrame,
  })

  const subscribeToNavigationFrames = useCallback(
    (listener) => navigationFrameChannelRef.current.subscribe(listener),
    [],
  )

  useEffect(() => {
    const channel = navigationFrameChannelRef.current

    return () => {
      channel.clear()
    }
  }, [])

  function clearPendingDestination() {
    setPendingDestination(null)
  }

  function handlePendingDestinationChange(destination) {
    setPendingDestination(destination)
    setRouteError('')
  }

  function showRouteMessage(message) {
    setRouteError(message)
  }

  async function moveToDestination(destination, options = {}) {
    if (!destination) {
      return
    }

    const sourcePosition = options.sourcePosition || playerPositionRef.current
    routeAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    routeAbortControllerRef.current = abortController
    setIsRouteLoading(true)
    setRouteError('')
    cancelAnimation()
    playerPositionRef.current = sourcePosition
    setPlayerPosition(sourcePosition)
    setRouteCoordinates([])
    const routeRequestId = routeRequestIdRef.current + 1
    routeRequestIdRef.current = routeRequestId

    try {
      const route = await fetchRoute(sourcePosition, destination, {
        signal: abortController.signal,
      })
      const nextRouteCoordinates = route.coordinates

      if (routeRequestId !== routeRequestIdRef.current) {
        return false
      }

      if (options.shouldStart?.() === false) {
        if (options.blockedMessage) {
          setRouteError(options.blockedMessage)
        }

        return false
      }

      setRouteCoordinates(nextRouteCoordinates)
      startAnimation(nextRouteCoordinates, options.onComplete)
      return true
    } catch (error) {
      if (routeRequestId !== routeRequestIdRef.current) {
        return false
      }

      if (isAbortError(error)) {
        return false
      }

      console.error('Route fetch failed:', error)
      setRouteError(
        isRouteUnavailableError(error)
          ? ROUTE_UNAVAILABLE_MESSAGE
          : `Could not fetch route. Is the API running at ${API_BASE_URL}?`,
      )
      return false
    } finally {
      if (routeRequestId === routeRequestIdRef.current) {
        if (routeAbortControllerRef.current === abortController) {
          routeAbortControllerRef.current = null
        }
        setIsRouteLoading(false)
      }
    }
  }

  async function confirmPendingMove() {
    const didStartMoving = await moveToDestination(pendingDestination)

    if (didStartMoving) {
      clearPendingDestination()
    }
  }

  function resetPlayerState() {
    routeRequestIdRef.current += 1
    routeAbortControllerRef.current?.abort()
    routeAbortControllerRef.current = null
    cancelAnimation()
    playerPositionRef.current = INITIAL_PLAYER_POSITION
    setPlayerPosition(INITIAL_PLAYER_POSITION)
    setPendingDestination(null)
    setRouteCoordinates([])
    setIsRouteLoading(false)
    setRouteError('')
  }

  const stopPlayerMovement = useCallback(() => {
    routeRequestIdRef.current += 1
    routeAbortControllerRef.current?.abort()
    routeAbortControllerRef.current = null
    cancelAnimation()
    setPendingDestination(null)
    setRouteCoordinates([])
    setIsRouteLoading(false)
    setRouteError('')
  }, [cancelAnimation])

  return {
    playerPosition,
    pendingDestination,
    routeCoordinates,
    isRouteLoading,
    isMoving,
    simulationSpeed,
    routeError,
    setSimulationSpeed,
    setPendingDestination: handlePendingDestinationChange,
    showRouteMessage,
    clearPendingDestination,
    confirmPendingMove,
    moveToDestination,
    resetPlayerState,
    stopPlayerMovement,
    subscribeToNavigationFrames,
  }
}
