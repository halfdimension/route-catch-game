import LeaderboardPanel from '../components/LeaderboardPanel'

function LeaderboardPage({ refreshVersion }) {
  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>Leaderboard</h1>
        <p>Top completed game sessions.</p>
      </div>
      <section className="page-panel leaderboard-page-panel">
        <LeaderboardPanel refreshVersion={refreshVersion} />
      </section>
    </main>
  )
}

export default LeaderboardPage
