import GameHistoryPanel from '../components/GameHistoryPanel'
import PlayerStatsPanel from '../components/PlayerStatsPanel'
import { useAuth } from '../context/authContextCore'

function StatsPage({ activeSessionId, playerName, refreshVersion }) {
  const {
    currentUser,
    isAuthenticated,
    logout,
    token,
  } = useAuth()

  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>Stats</h1>
        <p>Your scoring totals, recent sessions, and catch history.</p>
      </div>
      <div className="stats-page-grid">
        <section className="page-panel">
          <PlayerStatsPanel
            currentUser={currentUser}
            isAuthenticated={isAuthenticated}
            onAuthExpired={logout}
            playerName={playerName}
            refreshVersion={refreshVersion}
            token={token}
          />
        </section>
        <section className="page-panel">
          <GameHistoryPanel
            activeSessionId={activeSessionId}
            currentUser={currentUser}
            isAuthenticated={isAuthenticated}
            onAuthExpired={logout}
            refreshVersion={refreshVersion}
            token={token}
          />
        </section>
      </div>
    </main>
  )
}

export default StatsPage
