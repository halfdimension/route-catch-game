import TravelModeSelector from '../TravelModeSelector'

function MapLibreSessionControls({ gameplay }) {
  function handleDurationChange(event) {
    gameplay.setSelectedRoundSeconds(Number(event.target.value))
  }

  function handlePlayerNameChange(event) {
    gameplay.setPlayerName(event.target.value)
  }

  return (
    <section
      className={`maplibre-hud-panel maplibre-session-controls maplibre-hud-interactive is-${gameplay.gameState}`}
      aria-label="Round controls"
    >
      {gameplay.gameState !== 'running' && (
        <>
          <div className="maplibre-session-heading">
            <span className="maplibre-hud-eyebrow">Solo expedition</span>
            <strong>Round setup</strong>
          </div>
          <div className="maplibre-session-fields">
            {!gameplay.isAuthenticated && (
              <label>
                <span>Player name</span>
                <input
                  type="text"
                  value={gameplay.playerName}
                  onChange={handlePlayerNameChange}
                  maxLength={80}
                  disabled={gameplay.isSessionPending}
                />
              </label>
            )}
            <label>
              <span>Duration</span>
              <select
                value={gameplay.selectedRoundSeconds}
                onChange={handleDurationChange}
                disabled={gameplay.isSessionPending}
              >
                {gameplay.roundDurationOptions.map((durationSeconds) => (
                  <option key={durationSeconds} value={durationSeconds}>
                    {durationSeconds}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          {gameplay.gameState === 'ready' && (
            <button
              type="button"
              className="maplibre-session-start"
              onClick={gameplay.handleStartGame}
              disabled={gameplay.isSessionPending}
            >
              {gameplay.isSessionPending ? 'Starting…' : 'Start round'}
            </button>
          )}
        </>
      )}

      <TravelModeSelector
        selectedTravelMode={gameplay.selectedTravelMode}
        isTravelModeSelectionLocked={
          gameplay.isTravelModeSelectionLocked
        }
        onSelectedTravelModeChange={gameplay.setSelectedTravelMode}
        disabled={gameplay.isSessionPending}
        className="is-maplibre"
      />

      {gameplay.gameState === 'running' && (
        <button
          type="button"
          className="maplibre-session-end"
          onClick={gameplay.handleEndGame}
          disabled={gameplay.isSessionPending}
        >
          {gameplay.isSessionPending ? 'Ending round…' : 'End round'}
        </button>
      )}

      {gameplay.sessionNotice && (
        <p className={`maplibre-session-notice is-${gameplay.sessionNotice.tone}`} role="status">
          {gameplay.sessionNotice.message}
        </p>
      )}
      {gameplay.catchSubmissionWarning && (
        <p className="maplibre-session-notice is-warning" role="status">
          {gameplay.catchSubmissionWarning}
        </p>
      )}
    </section>
  )
}

export default MapLibreSessionControls
