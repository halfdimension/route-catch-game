import { useState } from 'react'
import { fetchRoute } from '../api/osrmClient'
import { useRouteAnimation } from './useRouteAnimation'

const INITIAL_PLAYER_POSITION = {
  lat: 28.550584664849566,
  lon: 77.26885829983426,
}

export function usePlayerState() {
  const [playerPosition, setPlayerPosition] = useState(INITIAL_PLAYER_POSITION)
  const [pendingDestination, setPendingDestination] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const {
    isMoving,
    simulationSpeed,
    startAnimation,
    cancelAnimation,
  } = useRouteAnimation({
    onPositionChange: setPlayerPosition,
  })

  function clearPendingDestination() {
    setPendingDestination(null)
  }

  function handlePendingDestinationChange(destination) {
    setPendingDestination(destination)
    setRouteError('')
  }

  async function confirmPendingMove() {
    if (!pendingDestination) {
      return
    }

    setIsRouteLoading(true)
    setRouteError('')
    cancelAnimation()

    try {
      const nextRouteCoordinates = await fetchRoute(
        playerPosition,
        pendingDestination,
      )

      setRouteCoordinates(nextRouteCoordinates)
      clearPendingDestination()
      startAnimation(nextRouteCoordinates)
    } catch (error) {
      console.error('Route fetch failed:', error)
      setRouteError('Could not fetch route. Is OSRM running on localhost:5000?')
    } finally {
      setIsRouteLoading(false)
    }
  }

  return {
    playerPosition,
    pendingDestination,
    routeCoordinates,
    isRouteLoading,
    isMoving,
    simulationSpeed,
    routeError,
    setPendingDestination: handlePendingDestinationChange,
    clearPendingDestination,
    confirmPendingMove,
  }
}
