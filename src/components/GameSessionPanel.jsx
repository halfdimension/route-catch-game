function GameSessionPanel({
  gameState,
  selectedRoundSeconds,
  roundDurationOptions,
  onRoundDurationChange,
  onStartGame,
  onEndGame,
  onRestartGame,
}) {
  function handleDurationChange(event) {
    onRoundDurationChange(Number(event.target.value))
  }

  const canChooseDuration = gameState !== 'running'

  return (
    <section className="game-session-panel" aria-label="Game session">
      {canChooseDuration && (
        <label className="round-duration-control">
          <span>Duration</span>
          <select value={selectedRoundSeconds} onChange={handleDurationChange}>
            {roundDurationOptions.map((durationSeconds) => (
              <option key={durationSeconds} value={durationSeconds}>
                {durationSeconds}s
              </option>
            ))}
          </select>
        </label>
      )}

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
