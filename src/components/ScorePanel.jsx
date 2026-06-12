function ScorePanel({ score, caughtCount, lastCaughtName }) {
  return (
    <section className="score-panel" aria-label="Score">
      <p>Score</p>
      <strong>{score}</strong>
      <span>Caught: {caughtCount}</span>
      {lastCaughtName && <span>Last: {lastCaughtName}</span>}
    </section>
  )
}

export default ScorePanel
