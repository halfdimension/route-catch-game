import { useCallback, useEffect, useState } from 'react'
import {
  getLatestRoundResult,
  getRoundResult,
} from '../api/multiplayerRoundResultClient'
import { createMultiplayerRoundResultController } from './multiplayerRoundResultState'

export function useMultiplayerRoundResult(context) {
  const {
    connectionStatus,
    gameState,
    roomCode,
    roomEvent,
    token,
  } = context
  const [state, setState] = useState({
    error: null,
    isFinalizing: false,
    isLoading: false,
    isOpen: false,
    result: null,
  })

  const [controller] = useState(() => (
    createMultiplayerRoundResultController({
      getExactResult: getRoundResult,
      getLatestResult: getLatestRoundResult,
      onStateChange: setState,
    })
  ))

  useEffect(() => {
    controller.updateContext({
      connectionStatus,
      gameState,
      roomCode,
      roomEvent,
      token,
    })
  }, [
    connectionStatus,
    controller,
    gameState,
    roomCode,
    roomEvent,
    token,
  ])

  useEffect(() => () => controller.destroy(), [controller])

  return {
    ...state,
    clear: useCallback(() => controller.clear(), [controller]),
    close: useCallback(() => controller.close(), [controller]),
    open: useCallback(() => controller.open(), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
  }
}
