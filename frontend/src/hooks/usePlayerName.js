import { useCallback, useState } from 'react'
import { mockUserProfile } from '../data/mockUserProfile'

const PLAYER_NAME_STORAGE_KEY = 'routeCatchPlayerName'

function getInitialPlayerName() {
  try {
    const storedPlayerName =
      localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ||
      mockUserProfile.displayName ||
      'Guest'

    return storedPlayerName.slice(0, 80)
  } catch {
    return (mockUserProfile.displayName || 'Guest').slice(0, 80)
  }
}

export function usePlayerName() {
  const [playerName, setPlayerNameState] = useState(getInitialPlayerName)

  const setPlayerName = useCallback((nextPlayerName) => {
    const boundedPlayerName = nextPlayerName.slice(0, 80)
    setPlayerNameState(boundedPlayerName)

    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, boundedPlayerName)
    } catch {
      // Storage can be unavailable without blocking local gameplay.
    }
  }, [])

  return {
    playerName,
    setPlayerName,
  }
}
