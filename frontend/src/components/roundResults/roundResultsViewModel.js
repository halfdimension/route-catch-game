export function createRoundResultsViewModel(result) {
  const publicResult = result?.publicResult || null
  const personalResult = result?.personalResult || null

  return {
    caughtCreatures: Array.isArray(personalResult?.caughtCreatures)
      ? personalResult.caughtCreatures
      : [],
    leaderboard: Array.isArray(publicResult?.leaderboard)
      ? publicResult.leaderboard
      : [],
    personalResult,
    publicResult,
    rarityCounts: personalResult?.rarityCounts || {},
  }
}

export function isCurrentRoundPlayer(entry, currentPlayerId) {
  return String(entry?.playerId) === String(currentPlayerId)
}

export function getRoundResultsActions({
  error,
  isHost,
  isOpen,
  result,
  canPlayAgain,
}) {
  return {
    showPlayAgain: Boolean(isHost && canPlayAgain),
    showReopen: Boolean(!isOpen && (result || error)),
    showWaitingForHost: Boolean(!isHost && result),
  }
}

export async function playAgainAndClear({ onPlayAgain, clearResult }) {
  const didStart = await onPlayAgain()

  if (didStart) {
    clearResult()
  }

  return didStart
}

export function returnToRoundLobby(onReturnToLobby) {
  return onReturnToLobby()
}
