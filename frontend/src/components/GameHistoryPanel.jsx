import { useEffect, useState } from 'react'
import {
  listGameSessions,
  listSessionCatches,
} from '../api/gameSessionClient'

function formatHistoryTime(timestamp) {
  if (!timestamp) {
    return null
  }

  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

        setSessionResult({
          key: sessionRequestKey,
          sessions: recentSessions,
          error: '',
        })
        setSelectedSessionId((currentSessionId) => {
          if (
            currentSessionId &&
            recentSessions.some(
              (session) => session.sessionId === currentSessionId,
            )
          ) {
            return currentSessionId
          }

          if (
            activeSessionId &&
            recentSessions.some(
              (session) => session.sessionId === activeSessionId,
            )
          ) {
            return activeSessionId
          }

          return recentSessions[0]?.sessionId ?? null
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
            catches: sessionCatches,
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
        <p>Game History</p>
        <button
          type="button"
          onClick={() => setLocalRefreshVersion((version) => version + 1)}
          disabled={isSessionsLoading}
        >
          Refresh
        </button>
      </div>

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
            {sessions.map((session) => {
              const sessionTime = formatHistoryTime(session.createdAt)

              return (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    className={
                      selectedSessionId === session.sessionId
                        ? 'is-selected'
                        : undefined
                    }
                    onClick={() => setSelectedSessionId(session.sessionId)}
                  >
                    <span>
                      <strong>{session.sessionId.slice(0, 8)}</strong>
                      <small>{session.status}</small>
                    </span>
                    <span>
                      {session.score} pts · {session.caughtCount} caught
                    </span>
                    {sessionTime && <time>{sessionTime}</time>}
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="game-history-catches">
            <p>Catches</p>
            {catchesError && (
              <span className="game-history-error">{catchesError}</span>
            )}
            {isCatchesLoading ? (
              <span>Loading catches...</span>
            ) : catches.length === 0 ? (
              <span>No catches for this session yet.</span>
            ) : (
              <ul>
                {catches.map((caughtCreature) => (
                  <li key={caughtCreature.catchId}>
                    <strong>{caughtCreature.creatureName}</strong>
                    <span>
                      {caughtCreature.rarity} · +{caughtCreature.scoreValue}
                    </span>
                    <time>
                      {formatHistoryTime(caughtCreature.caughtAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default GameHistoryPanel
