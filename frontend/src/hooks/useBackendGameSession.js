import { useCallback, useRef, useState } from 'react'
import {
  createGameSession,
  endGameSession,
  startGameSession,
  submitCatch,
} from '../api/gameSessionClient'

export function useBackendGameSession() {
  const [backendSession, setBackendSessionState] = useState(null)
  const [sessionNotice, setSessionNotice] = useState(null)
  const [catchSubmissionWarning, setCatchSubmissionWarning] = useState('')
  const [backendScore, setBackendScore] = useState(0)
  const [backendCaughtCount, setBackendCaughtCount] = useState(0)
  const [isSessionPending, setIsSessionPending] = useState(false)
  const backendSessionRef = useRef(null)

  const setBackendSession = useCallback((session) => {
    backendSessionRef.current = session
    setBackendSessionState(session)

    if (typeof session.score === 'number') {
      setBackendScore(session.score)
    }

    if (typeof session.caughtCount === 'number') {
      setBackendCaughtCount(session.caughtCount)
    }
  }, [])

  const beginSession = useCallback(
    async (durationSeconds, playerName) => {
      setIsSessionPending(true)
      setSessionNotice(null)
      setCatchSubmissionWarning('')

      try {
        const createdSession = await createGameSession(
          durationSeconds,
          playerName,
        )
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
    async (durationSeconds, playerName) => {
      setIsSessionPending(true)
      setSessionNotice(null)
      setCatchSubmissionWarning('')

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
        const createdSession = await createGameSession(
          durationSeconds,
          playerName,
        )
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

  const submitBackendCatch = useCallback(async (creatureId) => {
    const currentSession = backendSessionRef.current

    if (!currentSession || currentSession.status !== 'RUNNING') {
      return null
    }

    const submittingSessionId = currentSession.sessionId

    try {
      const response = await submitCatch(submittingSessionId, creatureId)

      if (backendSessionRef.current?.sessionId !== submittingSessionId) {
        return response
      }

      setBackendScore((currentScore) =>
        Math.max(currentScore, response.score ?? currentScore),
      )
      setBackendCaughtCount((currentCount) =>
        Math.max(currentCount, response.caughtCount ?? currentCount),
      )
      setCatchSubmissionWarning('')
      return response
    } catch {
      if (backendSessionRef.current?.sessionId === submittingSessionId) {
        setCatchSubmissionWarning(
          'Catch saved locally, but backend sync failed.',
        )
      }

      return null
    }
  }, [])

  return {
    backendSession,
    backendScore,
    backendCaughtCount,
    sessionNotice,
    catchSubmissionWarning,
    isSessionPending,
    beginSession,
    finishSession,
    replaceSession,
    submitBackendCatch,
  }
}
