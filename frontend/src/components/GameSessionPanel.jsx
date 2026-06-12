function GameSessionPanel({
  gameState,
  selectedRoundSeconds,
  roundDurationOptions,
  onRoundDurationChange,
  onStartGame,
  onEndGame,
  backendSession,
  backendScore,
  backendCaughtCount,
  sessionNotice,
  catchSubmissionWarning,
  isSessionPending,
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
