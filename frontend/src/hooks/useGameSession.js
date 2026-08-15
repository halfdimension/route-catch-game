import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_ROUND_SECONDS,
  ROUND_DURATION_OPTIONS_SECONDS,
} from '../config/gameConfig.js'
import {
  createSoloRoundTimeline,
  getRecoverableSoloRoundState,
  getSoloRoundRemainingMilliseconds,
  getSoloRoundRemainingSeconds,
} from '../recovery/soloRoundClock.js'

const ROUND_DISPLAY_REFRESH_INTERVAL_MS = 250

export function useGameSession({
  getEpochTimeMs = Date.now,
  onRoundExpired,
} = {}) {
  const [gameState, setGameState] = useState('ready')
  const [selectedRoundSeconds, setSelectedRoundSecondsState] =
    useState(DEFAULT_ROUND_SECONDS)
  const [roundTimeline, setRoundTimeline] = useState(null)
  const [remainingSeconds, setRemainingSeconds] = useState(
    DEFAULT_ROUND_SECONDS,
  )
  const gameStateRef = useRef('ready')
  const roundRevisionRef = useRef(0)
  const notifiedExpiryRevisionRef = useRef(null)
  const getEpochTimeMsRef = useRef(getEpochTimeMs)
  const onRoundExpiredRef = useRef(onRoundExpired)

  useEffect(() => {
    getEpochTimeMsRef.current = getEpochTimeMs
  }, [getEpochTimeMs])

  useEffect(() => {
    onRoundExpiredRef.current = onRoundExpired
  }, [onRoundExpired])

  const expireRound = useCallback((expectedRevision, timeline) => {
    if (
      expectedRevision !== roundRevisionRef.current ||
      gameStateRef.current !== 'running'
    ) {
      return false
    }

    gameStateRef.current = 'ended'
    setGameState('ended')
    setRemainingSeconds(0)

    if (notifiedExpiryRevisionRef.current !== expectedRevision) {
      notifiedExpiryRevisionRef.current = expectedRevision
      onRoundExpiredRef.current?.(timeline)
    }

    return true
  }, [])

  useEffect(() => {
    if (gameState !== 'running' || !roundTimeline) {
      return undefined
    }

    const expectedRevision = roundRevisionRef.current

    const updateFromWallClock = () => {
      const nowEpochMs = getEpochTimeMsRef.current()
      const nextRemainingSeconds = getSoloRoundRemainingSeconds(
        roundTimeline,
        nowEpochMs,
      )
      setRemainingSeconds(nextRemainingSeconds)

      if (nextRemainingSeconds === 0) {
        expireRound(expectedRevision, roundTimeline)
      }
    }

    updateFromWallClock()
    const intervalId = window.setInterval(
      updateFromWallClock,
      ROUND_DISPLAY_REFRESH_INTERVAL_MS,
    )
    const exactRemainingMs = getSoloRoundRemainingMilliseconds(
      roundTimeline,
      getEpochTimeMsRef.current(),
    )
    const expiryTimerId = window.setTimeout(
      updateFromWallClock,
      exactRemainingMs,
    )

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(expiryTimerId)
    }
  }, [expireRound, gameState, roundTimeline])

  function setSelectedRoundSeconds(nextDurationSeconds) {
    if (gameStateRef.current === 'running') {
      return
    }

    setSelectedRoundSecondsState(nextDurationSeconds)
    setRemainingSeconds(nextDurationSeconds)
  }

  function startGame({
    durationSeconds = selectedRoundSeconds,
    startedAtEpochMs = getEpochTimeMsRef.current(),
    endsAtEpochMs,
  } = {}) {
    const timeline = createSoloRoundTimeline({
      durationSeconds,
      startedAtEpochMs,
      endsAtEpochMs,
    })
    const nowEpochMs = getEpochTimeMsRef.current()
    const nextGameState = getRecoverableSoloRoundState(timeline, nowEpochMs)
    const nextRevision = roundRevisionRef.current + 1

    roundRevisionRef.current = nextRevision
    notifiedExpiryRevisionRef.current = null
    gameStateRef.current = nextGameState
    setSelectedRoundSecondsState(durationSeconds)
    setRoundTimeline(timeline)
    setGameState(nextGameState)
    setRemainingSeconds(
      getSoloRoundRemainingSeconds(timeline, nowEpochMs),
    )

    if (nextGameState === 'ended') {
      notifiedExpiryRevisionRef.current = nextRevision
      onRoundExpiredRef.current?.(timeline)
    }

    return timeline
  }

  function endGame() {
    roundRevisionRef.current += 1
    gameStateRef.current = 'ended'
    setGameState('ended')
    setRemainingSeconds(0)
  }

  function restartGame(options) {
    return startGame(options)
  }

  function resetGameSession() {
    roundRevisionRef.current += 1
    notifiedExpiryRevisionRef.current = null
    gameStateRef.current = 'ready'
    setRoundTimeline(null)
    setRemainingSeconds(selectedRoundSeconds)
    setGameState('ready')
  }

  return {
    gameState,
    remainingSeconds,
    selectedRoundSeconds,
    roundDurationOptions: ROUND_DURATION_OPTIONS_SECONDS,
    startedAtEpochMs: roundTimeline?.startedAtEpochMs ?? null,
    endsAtEpochMs: roundTimeline?.endsAtEpochMs ?? null,
    setSelectedRoundSeconds,
    startGame,
    endGame,
    restartGame,
    resetGameSession,
  }
}
