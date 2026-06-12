function ScorePanel({ score, caughtCount }) {
  return (
    <section className="score-panel" aria-label="Score">
      <p>Score</p>
      <strong>{score}</strong>
      <span>Caught: {caughtCount}</span>
    </section>
  )
}

export default ScorePanel
