import { useState } from 'react'

const INITIAL_PLAYER_POSITION = {
  lat: 28.550584664849566,
  lon: 77.26885829983426,
}

export function usePlayerState() {
  const [playerPosition] = useState(INITIAL_PLAYER_POSITION)
  const [pendingDestination, setPendingDestination] = useState(null)

  function clearPendingDestination() {
    setPendingDestination(null)
  }

  function confirmPendingMove() {
    if (!pendingDestination) {
      return
    }

    console.log('Move requested:', {
      source: playerPosition,
      destination: pendingDestination,
    })

    clearPendingDestination()
  }

  return {
    playerPosition,
    pendingDestination,
    setPendingDestination,
    clearPendingDestination,
    confirmPendingMove,
  }
}
