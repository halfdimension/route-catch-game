import { useEffect, useState } from 'react'
import {
  DEFAULT_ROUND_SECONDS,
  ROUND_DURATION_OPTIONS_SECONDS,
} from '../config/gameConfig'

export function useGameSession() {
  const [gameState, setGameState] = useState('ready')
  const [selectedRoundSeconds, setSelectedRoundSecondsState] =
    useState(DEFAULT_ROUND_SECONDS)
  const [remainingSeconds, setRemainingSeconds] = useState(
    DEFAULT_ROUND_SECONDS,
  )

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

  function setSelectedRoundSeconds(nextDurationSeconds) {
    if (gameState === 'running') {
      return
    }

    setSelectedRoundSecondsState(nextDurationSeconds)
    setRemainingSeconds(nextDurationSeconds)
  }

  function startGame() {
    setRemainingSeconds(selectedRoundSeconds)
    setGameState('running')
  }

  function endGame() {
    setGameState('ended')
    setRemainingSeconds(0)
  }

  function restartGame() {
    setRemainingSeconds(selectedRoundSeconds)
    setGameState('running')
  }

  function resetGameSession() {
    setRemainingSeconds(selectedRoundSeconds)
    setGameState('ready')
  }

  return {
    gameState,
    remainingSeconds,
    selectedRoundSeconds,
    roundDurationOptions: ROUND_DURATION_OPTIONS_SECONDS,
    setSelectedRoundSeconds,
    startGame,
    endGame,
    restartGame,
    resetGameSession,
  }
}
