import { useCallback, useRef, useState } from 'react'
import { fetchRoute } from '../api/osrmClient'
import { useRouteAnimation } from './useRouteAnimation'

const DEFAULT_SIMULATION_SPEED = 80
const INITIAL_PLAYER_POSITION = {
  lat: 28.550584664849566,
  lon: 77.26885829983426,
}

export function usePlayerState() {
  const [playerPosition, setPlayerPosition] = useState(INITIAL_PLAYER_POSITION)
  const [simulationSpeed, setSimulationSpeed] = useState(
    DEFAULT_SIMULATION_SPEED,
  )
  const [pendingDestination, setPendingDestination] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const routeRequestIdRef = useRef(0)
  const { isMoving, startAnimation, cancelAnimation } = useRouteAnimation({
    speedMetersPerSecond: simulationSpeed,
    onPositionChange: setPlayerPosition,
  })

  function clearPendingDestination() {
    setPendingDestination(null)
  }

  function handlePendingDestinationChange(destination) {
    setPendingDestination(destination)
    setRouteError('')
  }

  async function moveToDestination(destination) {
    if (!destination) {
      return
    }

    setIsRouteLoading(true)
    setRouteError('')
    cancelAnimation()
    const routeRequestId = routeRequestIdRef.current + 1
    routeRequestIdRef.current = routeRequestId

    try {
      const route = await fetchRoute(playerPosition, destination)
      const nextRouteCoordinates = route.coordinates

      if (routeRequestId !== routeRequestIdRef.current) {
        return false
      }

      setRouteCoordinates(nextRouteCoordinates)
      startAnimation(nextRouteCoordinates)
      return true
    } catch (error) {
      if (routeRequestId !== routeRequestIdRef.current) {
        return false
      }

      console.error('Route fetch failed:', error)
      setRouteError('Could not fetch route. Is OSRM running on localhost:5000?')
      return false
    } finally {
      if (routeRequestId === routeRequestIdRef.current) {
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
    cancelAnimation()
    setPlayerPosition(INITIAL_PLAYER_POSITION)
    setPendingDestination(null)
    setRouteCoordinates([])
    setIsRouteLoading(false)
    setRouteError('')
  }

  const stopPlayerMovement = useCallback(() => {
    routeRequestIdRef.current += 1
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
    clearPendingDestination,
    confirmPendingMove,
    moveToDestination,
    resetPlayerState,
    stopPlayerMovement,
  }
}
