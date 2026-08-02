import {
  MAX_SIMULATION_SPEED,
  MIN_SIMULATION_SPEED,
} from '../../config/gameConfig'

function MapLibreDevelopmentControls({ gameplay }) {
  const maxSimulationSpeed = MAX_SIMULATION_SPEED + gameplay.speedBonus

  function handleSpeedChange(event) {
    const nextSpeed = Number(event.target.value)
    gameplay.setSimulationSpeed(
      Math.min(
        maxSimulationSpeed,
        Math.max(MIN_SIMULATION_SPEED, nextSpeed),
      ),
    )
  }

  return (
    <details className="maplibre-development-controls maplibre-hud-interactive">
      <summary>Development Controls</summary>
      <div className="maplibre-development-controls-content">
        <label>
          <span>Speed override: {gameplay.simulationSpeed} m/s</span>
          <div>
            <input
              type="range"
              min={MIN_SIMULATION_SPEED}
              max={maxSimulationSpeed}
              step="10"
              value={gameplay.simulationSpeed}
              onChange={handleSpeedChange}
            />
            <input
              type="number"
              min={MIN_SIMULATION_SPEED}
              max={maxSimulationSpeed}
              step="10"
              value={gameplay.simulationSpeed}
              onChange={handleSpeedChange}
            />
          </div>
        </label>
        <div className="maplibre-development-actions">
          <button type="button" onClick={gameplay.toggleSpawning}>
            {gameplay.isSpawningPaused ? 'Resume spawning' : 'Pause spawning'}
          </button>
          <button type="button" onClick={gameplay.clearTargets}>
            Clear targets
          </button>
          <button type="button" onClick={gameplay.resetScore}>
            Reset score
          </button>
          <button type="button" onClick={gameplay.resetPlayer}>
            Reset player
          </button>
          <button type="button" onClick={gameplay.resetGame}>
            Reset game
          </button>
        </div>
        <details className="maplibre-technical-status">
          <summary>Technical session status</summary>
          {gameplay.backendSession ? (
            <dl>
              <div>
                <dt>API session</dt>
                <dd>{gameplay.backendSession.sessionId}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{gameplay.backendSession.status}</dd>
              </div>
              <div>
                <dt>Backend totals</dt>
                <dd>
                  {gameplay.backendScore} pts · {gameplay.backendCaughtCount} caught
                </dd>
              </div>
            </dl>
          ) : (
            <p>No backend session</p>
          )}
        </details>
      </div>
    </details>
  )
}

export default MapLibreDevelopmentControls
