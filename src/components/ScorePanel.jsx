function ScorePanel({ score, caughtCount, lastCaughtName, caughtNotice }) {
  return (
    <section className="score-panel" aria-label="Score">
      <p>Score</p>
      <strong>{score}</strong>
      <span>Caught: {caughtCount}</span>
      {lastCaughtName && <span>Last: {lastCaughtName}</span>}
      {caughtNotice && <div className="caught-notice">{caughtNotice}</div>}
    </section>
  )
}

export default ScorePanel
