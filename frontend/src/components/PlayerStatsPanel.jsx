import { useEffect, useState } from 'react'
import { getPlayerStats } from '../api/gameSessionClient'

function formatStatsTime(timestamp) {
  if (!timestamp) {
    return null
  }

  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAverageScore(value) {
  const score = Number(value ?? 0)

  if (!Number.isFinite(score)) {
    return '0'
  }

  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function PlayerStatsPanel({ playerName, refreshVersion }) {
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0)
  const normalizedPlayerName = playerName?.trim() || 'Guest'
  const requestKey =
    `${refreshVersion}:${localRefreshVersion}:${normalizedPlayerName}`
  const [result, setResult] = useState({
    key: null,
    stats: null,
    error: '',
  })
  const isLoading = result.key !== requestKey
  const error = result.key === requestKey ? result.error : ''
  const stats = result.key === requestKey ? result.stats : null
  const latestSessionTime = formatStatsTime(stats?.latestSessionAt)

  useEffect(() => {
    let isCurrentRequest = true

    getPlayerStats(normalizedPlayerName)
      .then((playerStats) => {
        if (isCurrentRequest) {
          setResult({
            key: requestKey,
            stats: playerStats && typeof playerStats === 'object'
              ? playerStats
              : null,
            error: '',
          })
        }
      })
      .catch(() => {
        if (isCurrentRequest) {
          setResult((currentResult) => ({
            key: requestKey,
            stats: currentResult.stats,
            error: 'Player stats are unavailable.',
          }))
        }
      })

    return () => {
      isCurrentRequest = false
    }
  }, [normalizedPlayerName, requestKey])

  return (
    <section className="player-stats-panel" aria-label="My stats">
      <div className="player-stats-header">
        <div>
          <p>My Stats</p>
          <span>{stats?.playerName || normalizedPlayerName}</span>
        </div>
        <button
          type="button"
          onClick={() => setLocalRefreshVersion((version) => version + 1)}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="player-stats-content">
        {error ? (
          <span className="player-stats-error" role="status">
            {error}
          </span>
        ) : isLoading && !stats ? (
          <span className="player-stats-empty">Loading player stats...</span>
        ) : stats ? (
          <>
            <div className="player-stats-summary">
              <strong>{stats.totalScore ?? 0}</strong>
              <span>Total score</span>
            </div>

            <dl className="player-stats-grid">
              <div>
                <dt>Total sessions</dt>
                <dd>{stats.totalSessions ?? 0}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{stats.completedSessions ?? 0}</dd>
              </div>
              <div>
                <dt>Total catches</dt>
                <dd>{stats.totalCatches ?? 0}</dd>
              </div>
              <div>
                <dt>Best score</dt>
                <dd>{stats.bestScore ?? 0}</dd>
              </div>
              <div>
                <dt>Best caught</dt>
                <dd>{stats.bestCaughtCount ?? 0}</dd>
              </div>
              <div>
                <dt>Average score</dt>
                <dd>{formatAverageScore(stats.averageScore)}</dd>
              </div>
            </dl>

            <div className="player-stats-latest">
              <span>Latest session</span>
              {latestSessionTime ? <time>{latestSessionTime}</time> : <strong>None yet</strong>}
            </div>
          </>
        ) : (
          <span className="player-stats-empty">No stats yet.</span>
        )}
      </div>
    </section>
  )
}

export default PlayerStatsPanel
