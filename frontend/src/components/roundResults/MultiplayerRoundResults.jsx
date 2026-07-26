import { useCallback } from 'react'
import { useMultiplayerRoundResult } from '../../hooks/useMultiplayerRoundResult'
import RoundResultsModal from './RoundResultsModal'
import {
  getRoundResultsActions,
  playAgainAndClear,
} from './roundResultsViewModel'

function MultiplayerRoundResults({
  roomCode,
  token,
  gameState,
  roomEvent,
  connectionStatus,
  isHost,
  canPlayAgain,
  isActionPending,
  onReturnToLobby,
  onPlayAgain,
}) {
  const resultState = useMultiplayerRoundResult({
    roomCode,
    token,
    gameState,
    roomEvent,
    connectionStatus,
  })
  const clearResult = resultState.clear

  const handlePlayAgain = useCallback(async () => {
    return playAgainAndClear({ onPlayAgain, clearResult })
  }, [clearResult, onPlayAgain])

  const actions = getRoundResultsActions({
    error: resultState.error,
    isHost,
    isOpen: resultState.isOpen,
    result: resultState.result,
    canPlayAgain,
  })

  return (
    <>
      {actions.showReopen && (
        <button
          type="button"
          className="round-results-reopen"
          onClick={resultState.open}
        >
          View Results
        </button>
      )}

      {resultState.isOpen && (
        <RoundResultsModal
          result={resultState.result}
          error={resultState.error}
          isLoading={resultState.isLoading}
          isFinalizing={resultState.isFinalizing}
          isHost={isHost}
          canPlayAgain={canPlayAgain}
          isActionPending={isActionPending}
          onClose={resultState.close}
          onRetry={resultState.retry}
          onReturnToLobby={onReturnToLobby}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </>
  )
}

export default MultiplayerRoundResults
