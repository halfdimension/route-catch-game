import { useEffect, useState } from 'react'

const DEFAULT_ROUND_SECONDS = 60

export function useGameSession(roundDurationSeconds = DEFAULT_ROUND_SECONDS) {
  const [gameState, setGameState] = useState('ready')
  const [remainingSeconds, setRemainingSeconds] = useState(roundDurationSeconds)

  useEffect(() => {
    if (gameState !== 'running') {
      return undefined
    }

    const timerId = setInterval(() => {
      setRemainingSeconds((currentSeconds) => {
        if (currentSeconds <= 1) {
          setGameState('ended')
          return 0
        }

        return currentSeconds - 1
      })
    }, 1000)

    return () => clearInterval(timerId)
  }, [gameState])

  function startGame() {
    setGameState('running')
  }

  function endGame() {
    setGameState('ended')
    setRemainingSeconds(0)
  }

  function restartGame() {
    setRemainingSeconds(roundDurationSeconds)
    setGameState('running')
  }

  function resetGameSession() {
    setRemainingSeconds(roundDurationSeconds)
    setGameState('ready')
  }

  return {
    gameState,
    remainingSeconds,
    startGame,
    endGame,
    restartGame,
    resetGameSession,
  }
}
