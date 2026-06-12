function getBestCatch(caughtTargets) {
  return caughtTargets.reduce((bestCatch, target) => {
    if (!bestCatch || target.score > bestCatch.score) {
      return target
    }

    return bestCatch
  }, null)
}

function RoundSummaryPanel({
  score,
  caughtTargets,
  level,
  onRestartGame,
  isRestarting = false,
}) {
  const bestCatch = getBestCatch(caughtTargets)

  return (
    <section className="round-summary-panel" aria-label="Round summary">
      <p>Round Complete</p>

      <div className="round-summary-stats">
        <span>
          Score <strong>{score}</strong>
        </span>
        <span>
          Caught <strong>{caughtTargets.length}</strong>
        </span>
        <span>
          Level <strong>{level}</strong>
        </span>
      </div>

      {bestCatch ? (
        <div className="round-summary-best">
          Best catch: {bestCatch.symbol} {bestCatch.name} +{bestCatch.score}
        </div>
      ) : (
        <div className="round-summary-empty">
          No creatures caught this round
        </div>
      )}

      <button
        type="button"
        className="primary-button"
        onClick={onRestartGame}
        disabled={isRestarting}
      >
        {isRestarting ? 'Restarting...' : 'Restart Game'}
      </button>
    </section>
  )
}

export default RoundSummaryPanel
