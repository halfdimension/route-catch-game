import { useCallback, useRef, useState } from 'react'
import {
  createGameSession,
  endGameSession,
  startGameSession,
} from '../api/gameSessionClient'

export function useBackendGameSession() {
  const [backendSession, setBackendSessionState] = useState(null)
  const [sessionNotice, setSessionNotice] = useState(null)
  const [isSessionPending, setIsSessionPending] = useState(false)
  const backendSessionRef = useRef(null)

  const setBackendSession = useCallback((session) => {
    backendSessionRef.current = session
    setBackendSessionState(session)
  }, [])

  const beginSession = useCallback(
    async (durationSeconds) => {
      setIsSessionPending(true)
      setSessionNotice(null)

      try {
        const createdSession = await createGameSession(durationSeconds)
        setBackendSession(createdSession)

        const runningSession = await startGameSession(createdSession.sessionId)
        setBackendSession(runningSession)
        return true
      } catch {
        setSessionNotice({
          tone: 'error',
          message: 'Could not start the game session. Please try again.',
        })
        return false
      } finally {
        setIsSessionPending(false)
      }
    },
    [setBackendSession],
  )

  const finishSession = useCallback(
    async (
      failureMessage = 'Backend session could not be ended. Local cleanup continued.',
    ) => {
      const currentSession = backendSessionRef.current

      if (!currentSession || currentSession.status === 'ENDED') {
        return true
      }

      setIsSessionPending(true)

      try {
        const endedSession = await endGameSession(currentSession.sessionId)
        setBackendSession(endedSession)
        setSessionNotice(null)
        return true
      } catch {
        setSessionNotice({
          tone: 'warning',
          message: failureMessage,
        })
        return false
      } finally {
        setIsSessionPending(false)
      }
    },
    [setBackendSession],
  )

  const replaceSession = useCallback(
    async (durationSeconds) => {
      setIsSessionPending(true)
      setSessionNotice(null)

      const currentSession = backendSessionRef.current
      let previousSessionEndFailed = false

      if (currentSession && currentSession.status !== 'ENDED') {
        try {
          const endedSession = await endGameSession(currentSession.sessionId)
          setBackendSession(endedSession)
        } catch {
          previousSessionEndFailed = true
          setSessionNotice({
            tone: 'warning',
            message: 'Previous backend session could not be ended.',
          })
        }
      }

      try {
        const createdSession = await createGameSession(durationSeconds)
        setBackendSession(createdSession)

        const runningSession = await startGameSession(createdSession.sessionId)
        setBackendSession(runningSession)
        setSessionNotice(
          previousSessionEndFailed
            ? {
                tone: 'warning',
                message: 'Previous backend session could not be ended.',
              }
            : null,
        )
        return true
      } catch {
        setSessionNotice({
          tone: 'error',
          message: 'Could not restart the game session. Please try again.',
        })
        return false
      } finally {
        setIsSessionPending(false)
      }
    },
    [setBackendSession],
  )

  return {
    backendSession,
    sessionNotice,
    isSessionPending,
    beginSession,
    finishSession,
    replaceSession,
  }
}
