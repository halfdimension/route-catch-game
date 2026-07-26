function isAbortError(error) {
  return error?.name === 'AbortError'
}

function resultRoundId(result) {
  return (
    result?.publicResult?.roundId ||
    result?.personalResult?.roundId ||
    ''
  )
}

function resultRoomCode(result) {
  return (
    result?.publicResult?.roomCode ||
    result?.personalResult?.roomCode ||
    ''
  )
}

function createResultError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || '').trim()
}

function sameRoomCode(firstRoomCode, secondRoomCode) {
  return normalizeRoomCode(firstRoomCode).toUpperCase() ===
    normalizeRoomCode(secondRoomCode).toUpperCase()
}

function createInitialState() {
  return {
    error: null,
    isFinalizing: false,
    isLoading: false,
    isOpen: false,
    result: null,
  }
}

export function createMultiplayerRoundResultController({
  getExactResult,
  getLatestResult,
  onStateChange = () => {},
}) {
  let state = createInitialState()
  let context = {}
  let roomKey = ''
  let requestGeneration = 0
  let abortController = null
  let activeRequestKey = ''
  let activeRequestRoundId = ''
  let lastRequest = null
  let presentedRoundIds = new Set()
  let recoveryAttemptKeys = new Set()
  let processedEventKeys = new Set()

  function emit() {
    onStateChange({ ...state })
  }

  function updateState(nextState) {
    state = { ...state, ...nextState }
    emit()
  }

  function abortCurrentRequest() {
    requestGeneration += 1
    abortController?.abort()
    abortController = null
    activeRequestKey = ''
    activeRequestRoundId = ''
  }

  function clear() {
    abortCurrentRequest()
    lastRequest = null
    state = createInitialState()
    emit()
  }

  function getCurrentGameContext() {
    const normalizedRoomCode = normalizeRoomCode(context.roomCode)
    const gameState = context.gameState
    const isCurrentGameState = Boolean(
      gameState &&
      (
        !gameState.roomCode ||
        sameRoomCode(gameState.roomCode, normalizedRoomCode)
      ),
    )
    const currentRoundId = isCurrentGameState && gameState?.roundId
      ? String(gameState.roundId)
      : ''
    const gameStatus = isCurrentGameState ? gameState?.gameStatus || '' : ''

    return {
      currentRoundId,
      gameState,
      gameStatus,
      isCurrentGameState,
      normalizedRoomCode,
    }
  }

  async function loadResult({
    mode,
    roundId = '',
    expectedRoundId = '',
    force = false,
  }) {
    const normalizedRoomCode = normalizeRoomCode(context.roomCode)
    const token = context.token

    if (!normalizedRoomCode || !token) {
      return false
    }

    const requestKey = [
      normalizedRoomCode,
      mode,
      roundId || 'latest',
      expectedRoundId,
    ].join(':')
    const presentationRoundId = String(expectedRoundId || roundId || '')

    if (
      !force &&
      (
        activeRequestKey === requestKey ||
        (
          presentationRoundId &&
          activeRequestRoundId === presentationRoundId
        )
      )
    ) {
      return false
    }

    abortCurrentRequest()
    const requestRoomKey = roomKey
    const currentRequestGeneration = requestGeneration
    abortController = new AbortController()
    const requestAbortController = abortController
    activeRequestKey = requestKey
    activeRequestRoundId = presentationRoundId
    lastRequest = { mode, roundId, expectedRoundId }

    updateState({
      error: null,
      isLoading: true,
      isOpen: presentationRoundId && !presentedRoundIds.has(
        String(presentationRoundId),
      )
        ? true
        : state.isOpen,
    })

    try {
      const nextResult = mode === 'exact'
        ? await getExactResult({
            token,
            roomCode: normalizedRoomCode,
            roundId,
            signal: requestAbortController.signal,
          })
        : await getLatestResult({
            token,
            roomCode: normalizedRoomCode,
            signal: requestAbortController.signal,
          })

      if (
        currentRequestGeneration !== requestGeneration ||
        requestRoomKey !== roomKey
      ) {
        return false
      }

      const nextRoundId = String(resultRoundId(nextResult))
      const nextRoomCode = String(resultRoomCode(nextResult))

      if (
        !nextResult?.publicResult ||
        !nextResult?.personalResult ||
        !nextRoundId
      ) {
        throw createResultError('The final result response was incomplete.')
      }

      if (nextRoomCode && !sameRoomCode(nextRoomCode, normalizedRoomCode)) {
        throw createResultError('The final result belongs to another room.')
      }

      if (expectedRoundId && nextRoundId !== String(expectedRoundId)) {
        throw createResultError(
          'Final results for this round are not available yet.',
          404,
        )
      }

      const shouldPresent = !presentedRoundIds.has(nextRoundId)
      presentedRoundIds.add(nextRoundId)
      updateState({
        error: null,
        isOpen: shouldPresent ? true : state.isOpen,
        result: nextResult,
      })
      return true
    } catch (requestError) {
      if (
        isAbortError(requestError) ||
        currentRequestGeneration !== requestGeneration ||
        requestRoomKey !== roomKey
      ) {
        return false
      }

      updateState({ error: requestError, isOpen: true })
      return false
    } finally {
      if (currentRequestGeneration === requestGeneration) {
        abortController = null
        activeRequestKey = ''
        activeRequestRoundId = ''
        updateState({ isLoading: false })
      }
    }
  }

  function updateContext(nextContext) {
    context = nextContext
    const {
      currentRoundId,
      gameState,
      gameStatus,
      isCurrentGameState,
      normalizedRoomCode,
    } = getCurrentGameContext()
    const nextRoomKey = context.token && normalizedRoomCode
      ? `${normalizedRoomCode}:${context.token}`
      : ''

    if (roomKey !== nextRoomKey) {
      roomKey = nextRoomKey
      presentedRoundIds = new Set()
      recoveryAttemptKeys = new Set()
      processedEventKeys = new Set()
      clear()
    }

    const isFinalizing = gameStatus === 'FINALIZING'
    if (state.isFinalizing !== isFinalizing) {
      updateState({ isFinalizing, isOpen: isFinalizing ? true : state.isOpen })
    }

    const eventRoundId = context.roomEvent?.eventType === 'GAME_ENDED'
      ? String(context.roomEvent?.payload?.roundId || '')
      : ''
    const isCurrentRoomEvent = Boolean(
      eventRoundId &&
      sameRoomCode(context.roomEvent?.roomCode, normalizedRoomCode) &&
      (!currentRoundId || eventRoundId === currentRoundId),
    )
    const eventKey = isCurrentRoomEvent
      ? `${context.roomEvent?.eventId || ''}:${eventRoundId}`
      : ''

    if (
      gameStatus === 'RUNNING' &&
      currentRoundId &&
      eventRoundId !== currentRoundId &&
      resultRoundId(state.result) !== currentRoundId &&
      (state.result || state.error || state.isOpen)
    ) {
      clear()
      return
    }

    if (
      eventKey &&
      !processedEventKeys.has(eventKey) &&
      resultRoundId(state.result) !== eventRoundId
    ) {
      processedEventKeys.add(eventKey)
      void loadResult({
        mode: 'exact',
        roundId: eventRoundId,
        expectedRoundId: eventRoundId,
      })
      return
    }

    const hasCompletedRound =
      gameStatus === 'ENDED' ||
      Boolean(isCurrentGameState && gameState?.endedAt)

    if (!hasCompletedRound || !normalizedRoomCode || !context.token) {
      return
    }

    const recoveryKey = [
      normalizedRoomCode,
      currentRoundId || 'latest',
      isCurrentGameState ? gameState?.generation ?? '' : '',
      context.connectionStatus === 'connected' ? 'connected' : 'offline',
    ].join(':')

    if (
      recoveryAttemptKeys.has(recoveryKey) ||
      (currentRoundId && resultRoundId(state.result) === currentRoundId) ||
      (isCurrentRoomEvent && eventRoundId === currentRoundId)
    ) {
      return
    }

    recoveryAttemptKeys.add(recoveryKey)
    void loadResult({ mode: 'latest', expectedRoundId: currentRoundId })
  }

  function retry() {
    const { currentRoundId } = getCurrentGameContext()

    if (lastRequest) {
      return loadResult({ ...lastRequest, force: true })
    }

    return loadResult({
      mode: currentRoundId ? 'exact' : 'latest',
      roundId: currentRoundId,
      expectedRoundId: currentRoundId,
      force: true,
    })
  }

  return {
    clear,
    close: () => updateState({ isOpen: false }),
    destroy: abortCurrentRequest,
    getState: () => ({ ...state }),
    loadResult,
    open: () => updateState({ isOpen: true }),
    retry,
    updateContext,
  }
}
