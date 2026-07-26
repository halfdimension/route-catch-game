import { isCurrentRoundPlayer } from './roundResultsViewModel'

function RoundLeaderboard({ entries = [], currentPlayerId }) {
  return (
    <section
      className="round-results-leaderboard"
      aria-labelledby="round-leaderboard-heading"
    >
      <div className="round-results-section-heading">
        <h2 id="round-leaderboard-heading">Leaderboard</h2>
        <span>{entries.length} players</span>
      </div>

      <div className="round-results-leaderboard-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Score</th>
              <th scope="col">Caught</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isCurrentPlayer = isCurrentRoundPlayer(
                entry,
                currentPlayerId,
              )

              return (
                <tr
                  key={entry.playerId}
                  className={isCurrentPlayer ? 'is-current-player' : undefined}
                >
                  <td>#{entry.rank}</td>
                  <th scope="row" title={entry.displayName}>
                    <span>{entry.displayName}</span>
                    {isCurrentPlayer && <small>You</small>}
                  </th>
                  <td>{entry.score}</td>
                  <td>{entry.creaturesCaught}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default RoundLeaderboard
