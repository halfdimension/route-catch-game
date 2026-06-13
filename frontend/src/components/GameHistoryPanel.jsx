import { useEffect, useState } from 'react'
import {
  listGameSessions,
  listSessionCatches,
} from '../api/gameSessionClient'

function formatHistoryTime(timestamp) {
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

function getStatusClass(status) {
  const normalizedStatus = String(status ?? '').toLowerCase()

  if (['running', 'ended', 'created'].includes(normalizedStatus)) {
    return `is-${normalizedStatus}`
  }

  return 'is-unknown'
}

function SessionListItem({ session, isSelected, onSelect }) {
  const sessionId = String(session?.sessionId ?? '')
  const status = String(session?.status ?? 'UNKNOWN')
  const sessionTime = formatHistoryTime(
    session?.startedAt ?? session?.createdAt,
  )
  const playerName = session?.playerName?.trim() || 'Guest'

  return (
    <li>
      <button
        type="button"
        className={isSelected ? 'is-selected' : undefined}
        onClick={() => onSelect(sessionId)}
        disabled={!sessionId}
      >
        <span className="game-history-session-heading">
          <strong title={`${playerName} · ${sessionId}`}>{playerName}</strong>
          <small className={`game-history-status ${getStatusClass(status)}`}>
            {status}
          </small>
        </span>
        <span className="game-history-session-stats">
          <span>{sessionId.slice(0, 8) || 'Unknown'}</span>
          <span>{session?.score ?? 0} pts</span>
          <span>{session?.caughtCount ?? 0} caught</span>
        </span>
        {sessionTime && <time>{sessionTime}</time>}
      </button>
    </li>
  )
}

function CatchHistoryItem({ caughtCreature }) {
  const caughtTime = formatHistoryTime(caughtCreature?.caughtAt)

  return (
    <li>
      <strong>{caughtCreature?.creatureName || 'Unknown creature'}</strong>
      <span>
        {caughtCreature?.rarity || 'unknown'} · +
        {caughtCreature?.scoreValue ?? 0}
      </span>
      {caughtTime && <time>{caughtTime}</time>}
    </li>
  )
}

function GameHistoryPanel({ activeSessionId, refreshVersion }) {
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0)
  const sessionRequestKey =
    `${refreshVersion}:${localRefreshVersion}:${activeSessionId ?? ''}`
  const catchRequestKey =
    `${refreshVersion}:${localRefreshVersion}:${selectedSessionId ?? ''}`
  const [sessionResult, setSessionResult] = useState({
    key: null,
    sessions: [],
    error: '',
  })
  const [catchResult, setCatchResult] = useState({
    key: null,
    catches: [],
    error: '',
  })
  const sessions = sessionResult.sessions
  const catches =
    selectedSessionId && catchResult.key === catchRequestKey
      ? catchResult.catches
      : []
  const sessionsError =
    sessionResult.key === sessionRequestKey ? sessionResult.error : ''
  const catchesError =
    catchResult.key === catchRequestKey ? catchResult.error : ''
  const isSessionsLoading = sessionResult.key !== sessionRequestKey
  const isCatchesLoading =
    Boolean(selectedSessionId) && catchResult.key !== catchRequestKey

  useEffect(() => {
    let isCurrentRequest = true

    listGameSessions()
      .then((recentSessions) => {
        if (!isCurrentRequest) {
          return
        }

        const safeSessions = Array.isArray(recentSessions)
          ? recentSessions
          : []

        setSessionResult({
          key: sessionRequestKey,
          sessions: safeSessions,
          error: '',
        })
        setSelectedSessionId((currentSessionId) => {
          if (
            currentSessionId &&
            safeSessions.some(
              (session) => session?.sessionId === currentSessionId,
            )
          ) {
            return currentSessionId
          }

          if (
            activeSessionId &&
            safeSessions.some(
              (session) => session?.sessionId === activeSessionId,
            )
          ) {
            return activeSessionId
          }

          return safeSessions[0]?.sessionId ?? null
        })
      })
      .catch(() => {
        if (isCurrentRequest) {
          setSessionResult((currentResult) => ({
            key: sessionRequestKey,
            sessions: currentResult.sessions,
            error: 'History is unavailable.',
          }))
        }
      })

    return () => {
      isCurrentRequest = false
    }
  }, [activeSessionId, sessionRequestKey])

  useEffect(() => {
    if (!selectedSessionId) {
      return undefined
    }

    let isCurrentRequest = true

    listSessionCatches(selectedSessionId)
      .then((sessionCatches) => {
        if (isCurrentRequest) {
          setCatchResult({
            key: catchRequestKey,
            catches: Array.isArray(sessionCatches) ? sessionCatches : [],
            error: '',
          })
        }
      })
      .catch(() => {
        if (isCurrentRequest) {
          setCatchResult({
            key: catchRequestKey,
            catches: [],
            error: 'Catch history is unavailable.',
          })
        }
      })

    return () => {
      isCurrentRequest = false
    }
  }, [catchRequestKey, selectedSessionId])

  return (
    <section className="game-history-panel" aria-label="Game history">
      <div className="game-history-header">
        <div>
          <p>Game History</p>
          <span>{sessions.length} sessions</span>
        </div>
        <div className="game-history-header-actions">
          <button
            type="button"
            onClick={() => setLocalRefreshVersion((version) => version + 1)}
            disabled={isSessionsLoading}
          >
            {isSessionsLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="game-history-content">
        {sessionsError && (
          <p className="game-history-error" role="status">
            {sessionsError}
          </p>
        )}

        {isSessionsLoading && sessions.length === 0 ? (
          <span className="game-history-empty">Loading sessions...</span>
        ) : sessions.length === 0 ? (
          <span className="game-history-empty">No sessions yet.</span>
        ) : (
          <div className="game-history-layout">
            <ul className="game-history-sessions">
              {sessions.map((session, index) => (
                <SessionListItem
                  key={session?.sessionId ?? `session-${index}`}
                  session={session}
                  isSelected={selectedSessionId === session?.sessionId}
                  onSelect={setSelectedSessionId}
                />
              ))}
            </ul>

            <div className="game-history-catches">
              <p>Catches</p>
              {catchesError ? (
                <span className="game-history-error">{catchesError}</span>
              ) : isCatchesLoading ? (
                <span className="game-history-empty">Loading catches...</span>
              ) : catches.length === 0 ? (
                <span className="game-history-empty">
                  No catches for this session yet.
                </span>
              ) : (
                <ul>
                  {catches.map((caughtCreature, index) => (
                    <CatchHistoryItem
                      key={caughtCreature?.catchId ?? `catch-${index}`}
                      caughtCreature={caughtCreature}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default GameHistoryPanel
