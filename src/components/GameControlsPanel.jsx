function GameControlsPanel({
  isSpawningPaused,
  simulationSpeed,
  onToggleSpawning,
  onClearTargets,
  onResetScore,
  onResetPlayer,
  onResetGame,
  onSimulationSpeedChange,
}) {
  function handleSpeedChange(event) {
    onSimulationSpeedChange(Number(event.target.value))
  }

  return (
    <section className="game-controls-panel" aria-label="Game controls">
      <p>Controls</p>

      <label className="speed-control">
        <span>Speed: {simulationSpeed} m/s</span>
        <input
          type="range"
          min="10"
          max="240"
          step="10"
          value={simulationSpeed}
          onChange={handleSpeedChange}
        />
      </label>

      <div className="game-control-actions">
        <button type="button" onClick={onToggleSpawning}>
          {isSpawningPaused ? 'Resume spawning' : 'Pause spawning'}
        </button>
        <button type="button" onClick={onClearTargets}>
          Clear targets
        </button>
        <button type="button" onClick={onResetScore}>
          Reset score
        </button>
        <button type="button" onClick={onResetPlayer}>
          Reset player
        </button>
        <button type="button" className="primary-button" onClick={onResetGame}>
          Reset game
        </button>
      </div>
    </section>
  )
}

export default GameControlsPanel
