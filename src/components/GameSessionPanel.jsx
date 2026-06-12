function GameSessionPanel({
  gameState,
  remainingSeconds,
  onStartGame,
  onEndGame,
  onRestartGame,
}) {
  return (
    <section className="game-session-panel" aria-label="Game session">
      <p>Session</p>
      <span>State: {gameState}</span>
      <strong>{remainingSeconds}s</strong>

      {gameState === 'ready' && (
        <button type="button" className="primary-button" onClick={onStartGame}>
          Start Game
        </button>
      )}

      {gameState === 'running' && (
        <button type="button" onClick={onEndGame}>
          End Game
        </button>
      )}

      {gameState === 'ended' && (
        <button
          type="button"
          className="primary-button"
          onClick={onRestartGame}
        >
          Restart Game
        </button>
      )}
    </section>
  )
}

export default GameSessionPanel
