function PersonalResultSummary({ result }) {
  return (
    <section
      className="round-results-personal"
      aria-label={`${result.displayName}'s final result`}
    >
      <div className="round-results-player">
        <span>Your result</span>
        <strong title={result.displayName}>{result.displayName}</strong>
      </div>

      <div className="round-results-personal-stats">
        <div className="is-rank">
          <span>Rank</span>
          <strong>#{result.rank}</strong>
          <small>of {result.playerCount}</small>
        </div>
        <div>
          <span>Final score</span>
          <strong>{result.score}</strong>
          <small>points</small>
        </div>
        <div>
          <span>Catches</span>
          <strong>{result.creaturesCaught}</strong>
          <small>creatures</small>
        </div>
      </div>
    </section>
  )
}

export default PersonalResultSummary
