import { useState } from 'react'
import { MAX_SIMULATION_SPEED } from '../config/gameConfig'

function GameControlsPanel({
  isSpawningPaused,
  simulationSpeed,
  onToggleSpawning,
  onClearTargets,
  onResetScore,
  onResetPlayer,
  onResetGame,
  onSimulationSpeedChange,
  maxSimulationSpeed = MAX_SIMULATION_SPEED,
}) {
  const [isOpen, setIsOpen] = useState(false)

  function handleSpeedChange(event) {
    const nextSpeed = Number(event.target.value)
    onSimulationSpeedChange(
      Math.min(maxSimulationSpeed, Math.max(10, nextSpeed)),
    )
  }

  return (
    <section
      className="game-controls-panel"
      aria-label="Game controls"
    >
      <button
        type="button"
        className="game-controls-toggle"
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
      >
        <span>Controls</span>
      </button>

      {isOpen && (
        <div className="controls-overlay" role="presentation">
          <div className="controls-dialog" role="dialog" aria-modal="true">
            <div className="controls-dialog-header">
              <p>Controls</p>
              <button type="button" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>

            <label className="speed-control">
              <span>Speed: {simulationSpeed} m/s</span>
              <div className="speed-control-inputs">
                <input
                  type="range"
                  min="10"
                  max={maxSimulationSpeed}
                  step="10"
                  value={simulationSpeed}
                  onChange={handleSpeedChange}
                />
                <input
                  type="number"
                  min="10"
                  max={maxSimulationSpeed}
                  step="10"
                  value={simulationSpeed}
                  onChange={handleSpeedChange}
                />
              </div>
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
              <button
                type="button"
                className="primary-button"
                onClick={onResetGame}
              >
                Reset game
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default GameControlsPanel
