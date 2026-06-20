function GameSessionPanel({
  gameState,
  selectedRoundSeconds,
  roundDurationOptions,
  onRoundDurationChange,
  playerName,
  onPlayerNameChange,
  onStartGame,
  onEndGame,
  backendSession,
  backendScore,
  backendCaughtCount,
  sessionNotice,
  catchSubmissionWarning,
  isSessionPending,
  isAuthenticated,
  authenticatedDisplayName,
}) {
  function handleDurationChange(event) {
    onRoundDurationChange(Number(event.target.value))
  }

  function handlePlayerNameChange(event) {
    onPlayerNameChange(event.target.value)
  }

  const canChooseDuration = gameState !== 'running'

  return (
    <section className="game-session-panel" aria-label="Game session">
      {canChooseDuration && (
        <div
          className={`game-session-setup-fields${
            isAuthenticated ? ' is-authenticated' : ''
          }`}
        >
          {!isAuthenticated && (
            <label className="player-name-control">
              <span>Guest player name</span>
              <input
                type="text"
                value={playerName}
                onChange={handlePlayerNameChange}
                maxLength={80}
                disabled={isSessionPending}
              />
            </label>
          )}
          <label className="round-duration-control">
            <span>Duration</span>
            <select
              value={selectedRoundSeconds}
              onChange={handleDurationChange}
              disabled={isSessionPending}
            >
              {roundDurationOptions.map((durationSeconds) => (
                <option key={durationSeconds} value={durationSeconds}>
                  {durationSeconds}s
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {isAuthenticated && (
        <p className="authenticated-session-note">
          Signed in as {authenticatedDisplayName}.
        </p>
      )}

      {gameState === 'ready' && (
        <button
          type="button"
          className="primary-button"
          onClick={onStartGame}
          disabled={isSessionPending}
        >
          {isSessionPending ? 'Starting...' : 'Start Game'}
        </button>
      )}

      {gameState === 'running' && (
        <button
          type="button"
          onClick={onEndGame}
          disabled={isSessionPending}
        >
          {isSessionPending ? 'Ending...' : 'End Game'}
        </button>
      )}

      {backendSession && (
        <>
          <div
            className="backend-session-status"
            title={backendSession.sessionId}
          >
            <span>API {backendSession.sessionId.slice(0, 8)}</span>
            <strong>{backendSession.status}</strong>
          </div>
          <div className="backend-session-totals">
            Backend: {backendScore} pts · {backendCaughtCount} caught
          </div>
        </>
      )}

      {sessionNotice && (
        <p
          className={`backend-session-notice is-${sessionNotice.tone}`}
          role="status"
        >
          {sessionNotice.message}
        </p>
      )}

      {catchSubmissionWarning && (
        <p className="backend-session-notice is-warning" role="status">
          {catchSubmissionWarning}
        </p>
      )}

    </section>
  )
}

export default GameSessionPanel
