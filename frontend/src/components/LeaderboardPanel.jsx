import { useEffect, useState } from 'react'
import { getLeaderboard } from '../api/gameSessionClient'

function formatEndedTime(timestamp) {
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

function LeaderboardPanel({ refreshVersion }) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0)
  const requestKey = `${refreshVersion}:${localRefreshVersion}`
  const [result, setResult] = useState({
    key: null,
    entries: [],
    error: '',
  })
  const isLoading = result.key !== requestKey
  const error = result.key === requestKey ? result.error : ''

  useEffect(() => {
    let isCurrentRequest = true

    getLeaderboard()
      .then((leaderboardEntries) => {
        if (isCurrentRequest) {
          setResult({
            key: requestKey,
            entries: Array.isArray(leaderboardEntries)
              ? leaderboardEntries
              : [],
            error: '',
          })
        }
      })
      .catch(() => {
        if (isCurrentRequest) {
          setResult((currentResult) => ({
            key: requestKey,
            entries: currentResult.entries,
            error: 'Leaderboard is unavailable.',
          }))
        }
      })

    return () => {
      isCurrentRequest = false
    }
  }, [requestKey])

  return (
    <section
      className={`leaderboard-panel${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label="Leaderboard"
    >
      <div className="leaderboard-header">
        <div>
          <p>Leaderboard</p>
          <span>Top {result.entries.length}</span>
        </div>
        <div className="leaderboard-header-actions">
          {!isCollapsed && (
            <button
              type="button"
              onClick={() => setLocalRefreshVersion((version) => version + 1)}
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed((currentValue) => !currentValue)}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="leaderboard-content">
          {error ? (
            <span className="leaderboard-error" role="status">
              {error}
            </span>
          ) : isLoading && result.entries.length === 0 ? (
            <span className="leaderboard-empty">Loading leaderboard...</span>
          ) : result.entries.length === 0 ? (
            <span className="leaderboard-empty">
              No completed sessions yet.
            </span>
          ) : (
            <ol className="leaderboard-list">
              {result.entries.map((entry, index) => {
                const sessionId = String(entry?.sessionId ?? '')
                const rank = entry?.rank ?? index + 1
                const endedTime = formatEndedTime(entry?.endedAt)

                return (
                  <li key={sessionId || `leaderboard-${index}`}>
                    <strong className="leaderboard-rank">{rank}</strong>
                    <div>
                      <strong title={sessionId}>
                        {sessionId.slice(0, 8) || 'Unknown'}
                      </strong>
                      <span>
                        {entry?.score ?? 0} pts · {entry?.caughtCount ?? 0}{' '}
                        caught
                      </span>
                    </div>
                    <div className="leaderboard-meta">
                      <span>{entry?.durationSeconds ?? 0}s</span>
                      {endedTime && <time>{endedTime}</time>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

export default LeaderboardPanel
