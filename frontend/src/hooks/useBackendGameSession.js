import { useCallback, useRef, useState } from 'react'
import {
  createGameSession,
  endGameSession,
  startGameSession,
  submitCatch,
} from '../api/gameSessionClient.js'
import {
  SoloCatchResponseIdentityError,
  responseConfirmsSoloCatch,
} from '../recovery/soloCatchSubmission.js'

function operationIsAllowed(operation, operationRevisionRef) {
  return (
    operationRevisionRef.current === operation.revision &&
    operation.shouldApply?.() !== false
  )
}

function isValidBackendTotal(value) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

export function useBackendGameSession(token) {
  const [backendSession, setBackendSessionState] = useState(null)
  const [sessionNotice, setSessionNotice] = useState(null)
  const [catchSubmissionWarning, setCatchSubmissionWarning] = useState('')
  const [backendScore, setBackendScore] = useState(0)
  const [backendCaughtCount, setBackendCaughtCount] = useState(0)
  const [isSessionPending, setIsSessionPending] = useState(false)
  const backendSessionRef = useRef(null)
  const operationRevisionRef = useRef(0)
  const launchInFlightRef = useRef(null)

  const setBackendSession = useCallback((session) => {
    backendSessionRef.current = session
    setBackendSessionState(session)

    if (typeof session?.score === 'number') {
      setBackendScore(session.score)
    }

    if (typeof session?.caughtCount === 'number') {
      setBackendCaughtCount(session.caughtCount)
    }
  }, [])

  const invalidateSessionOperations = useCallback(({
    clearSession = false,
  } = {}) => {
    operationRevisionRef.current += 1
    launchInFlightRef.current = null
    setIsSessionPending(false)
    if (clearSession) {
      backendSessionRef.current = null
      setBackendSessionState(null)
      setBackendScore(0)
      setBackendCaughtCount(0)
      setSessionNotice(null)
      setCatchSubmissionWarning('')
    }
  }, [])

  const beginOperation = useCallback((shouldApply, { launch = false } = {}) => {
    if (launch && launchInFlightRef.current !== null) {
      return null
    }
    const operation = {
      revision: operationRevisionRef.current + 1,
      shouldApply,
    }
    operationRevisionRef.current = operation.revision
    if (launch) {
      launchInFlightRef.current = operation.revision
    }
    setIsSessionPending(true)
    return operation
  }, [])

  const finishOperation = useCallback((operation) => {
    if (launchInFlightRef.current === operation?.revision) {
      launchInFlightRef.current = null
    }
    if (operationRevisionRef.current === operation?.revision) {
      setIsSessionPending(false)
    }
  }, [])

  const beginSession = useCallback(
    async (durationSeconds, playerName, { shouldApply } = {}) => {
      const operation = beginOperation(shouldApply, { launch: true })
      if (!operation) {
        return false
      }
      setSessionNotice(null)
      setCatchSubmissionWarning('')

      try {
        const createdSession = await createGameSession(
          durationSeconds,
          playerName,
          token,
        )
        if (!operationIsAllowed(operation, operationRevisionRef)) {
          return false
        }
        setBackendSession(createdSession)

        const runningSession = await startGameSession(createdSession.sessionId)
        if (!operationIsAllowed(operation, operationRevisionRef)) {
          return false
        }
        setBackendSession(runningSession)
        return runningSession
      } catch {
        if (operationIsAllowed(operation, operationRevisionRef)) {
          setSessionNotice({
            tone: 'error',
            message: 'Could not start the game session. Please try again.',
          })
        }
        return false
      } finally {
        finishOperation(operation)
      }
    },
    [beginOperation, finishOperation, setBackendSession, token],
  )

  const finishSession = useCallback(
    async (
      failureMessage = 'Backend session could not be ended. Local cleanup continued.',
      { expectedSessionId, shouldApply } = {},
    ) => {
      const currentSession = backendSessionRef.current

      if (
        !currentSession ||
        currentSession.status === 'ENDED' ||
        (expectedSessionId && currentSession.sessionId !== expectedSessionId)
      ) {
        return true
      }

      const operation = beginOperation(shouldApply)
      try {
        const endedSession = await endGameSession(currentSession.sessionId)
        if (
          !operationIsAllowed(operation, operationRevisionRef) ||
          backendSessionRef.current?.sessionId !== currentSession.sessionId
        ) {
          return false
        }
        setBackendSession(endedSession)
        setSessionNotice(null)
        return true
      } catch {
        if (operationIsAllowed(operation, operationRevisionRef)) {
          setSessionNotice({
            tone: 'warning',
            message: failureMessage,
          })
        }
        return false
      } finally {
        finishOperation(operation)
      }
    },
    [beginOperation, finishOperation, setBackendSession],
  )

  const finishSessionById = useCallback(async (expectedSessionId) => {
    if (!expectedSessionId) {
      return true
    }

    try {
      await endGameSession(expectedSessionId)
      return true
    } catch {
      // Detached cleanup is deliberately state-free. Its originating session
      // may no longer be current, so neither success nor failure may update
      // the active backend-session UI or invalidate a newer operation.
      return false
    }
  }, [])

  const replaceSession = useCallback(
    async (durationSeconds, playerName, { shouldApply } = {}) => {
      const operation = beginOperation(shouldApply, { launch: true })
      if (!operation) {
        return false
      }
      setSessionNotice(null)
      setCatchSubmissionWarning('')

      const currentSession = backendSessionRef.current
      let previousSessionEndFailed = false

      if (currentSession && currentSession.status !== 'ENDED') {
        try {
          const endedSession = await endGameSession(currentSession.sessionId)
          if (!operationIsAllowed(operation, operationRevisionRef)) {
            return false
          }
          if (backendSessionRef.current?.sessionId === currentSession.sessionId) {
            setBackendSession(endedSession)
          }
        } catch {
          if (!operationIsAllowed(operation, operationRevisionRef)) {
            return false
          }
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
          token,
        )
        if (!operationIsAllowed(operation, operationRevisionRef)) {
          return false
        }
        setBackendSession(createdSession)

        const runningSession = await startGameSession(createdSession.sessionId)
        if (!operationIsAllowed(operation, operationRevisionRef)) {
          return false
        }
        setBackendSession(runningSession)
        setSessionNotice(
          previousSessionEndFailed
            ? {
                tone: 'warning',
                message: 'Previous backend session could not be ended.',
              }
            : null,
        )
        return runningSession
      } catch {
        if (operationIsAllowed(operation, operationRevisionRef)) {
          setSessionNotice({
            tone: 'error',
            message: 'Could not restart the game session. Please try again.',
          })
        }
        return false
      } finally {
        finishOperation(operation)
      }
    },
    [beginOperation, finishOperation, setBackendSession, token],
  )

  const submitBackendCatchForSession = useCallback(async (
    sessionId,
    catchId,
    creatureId,
    { shouldApply } = {},
  ) => {
    const canApply = () => (
      backendSessionRef.current?.sessionId === sessionId &&
      shouldApply?.() !== false
    )
    try {
      const response = await submitCatch(
        sessionId,
        catchId,
        creatureId,
        token,
      )

      if (!responseConfirmsSoloCatch(response, catchId)) {
        throw new SoloCatchResponseIdentityError(catchId, response?.catchId)
      }

      if (canApply()) {
        if (isValidBackendTotal(response.score)) {
          setBackendScore((currentScore) =>
            Math.max(currentScore, response.score),
          )
        }
        if (isValidBackendTotal(response.caughtCount)) {
          setBackendCaughtCount((currentCount) =>
            Math.max(currentCount, response.caughtCount),
          )
        }
        setCatchSubmissionWarning('')
      }
      return response
    } catch (error) {
      if (canApply()) {
        setCatchSubmissionWarning(
          'Catch saved locally, but backend sync failed.',
        )
      }
      throw error
    }
  }, [token])

  const submitBackendCatch = useCallback(async (catchId, creatureId) => {
    const currentSession = backendSessionRef.current

    if (!currentSession || currentSession.status !== 'RUNNING') {
      return null
    }

    try {
      return await submitBackendCatchForSession(
        currentSession.sessionId,
        catchId,
        creatureId,
      )
    } catch {
      return null
    }
  }, [submitBackendCatchForSession])

  return {
    backendSession,
    backendScore,
    backendCaughtCount,
    sessionNotice,
    catchSubmissionWarning,
    isSessionPending,
    beginSession,
    finishSession,
    finishSessionById,
    replaceSession,
    invalidateSessionOperations,
    adoptBackendSession: setBackendSession,
    submitBackendCatch,
    submitBackendCatchForSession,
  }
}
