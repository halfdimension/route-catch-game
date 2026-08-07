const DEFAULT_PAGE_SIZE = 10
const DETAIL_CACHE_LIMIT = 5

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function normalizeAuthIdentity(authIdentity) {
  return String(authIdentity || '').trim() || 'authenticated-user'
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || '').trim().toUpperCase()
}

function normalizeRoundId(roundId) {
  return String(roundId || '').trim()
}

function detailKey(round) {
  return JSON.stringify([
    normalizeRoomCode(round?.roomCode),
    normalizeRoundId(round?.roundId),
  ])
}

function createResultIdentityError() {
  const error = new Error('Historical result identity mismatch')
  error.isResultIdentityMismatch = true
  return error
}

function safeDetailError(error) {
  let message = 'The historical result is temporarily unavailable. Please try again.'

  if (
    error?.status === 403 ||
    error?.status === 404 ||
    error?.isResultIdentityMismatch
  ) {
    message = 'This historical result is unavailable.'
  } else if (error?.status === 401) {
    message = 'Your session has expired. Please sign in again.'
  }

  const safeError = new Error(message)
  safeError.status = error?.status
  return safeError
}

function isMatchingResultIdentity(result, round) {
  const requestedRoomCode = normalizeRoomCode(round?.roomCode)
  const requestedRoundId = normalizeRoundId(round?.roundId)
  const publicResult = result?.publicResult
  const personalResult = result?.personalResult
  const publicRoomCode = normalizeRoomCode(publicResult?.roomCode)
  const publicRoundId = normalizeRoundId(publicResult?.roundId)
  const personalRoomCode = personalResult?.roomCode === undefined
    ? publicRoomCode
    : normalizeRoomCode(personalResult.roomCode)
  const personalRoundId = personalResult?.roundId === undefined
    ? publicRoundId
    : normalizeRoundId(personalResult.roundId)

  return Boolean(
    publicResult &&
    personalResult &&
    requestedRoomCode &&
    requestedRoundId &&
    publicRoomCode === requestedRoomCode &&
    publicRoundId === requestedRoundId &&
    personalRoomCode === publicRoomCode &&
    personalRoundId === publicRoundId,
  )
}

function isCompatibleHistoryResponse(history, requestedPage, pageSize) {
  return Boolean(
    history &&
    typeof history === 'object' &&
    Array.isArray(history.content) &&
    Number.isInteger(history.page) &&
    history.page === requestedPage &&
    Number.isInteger(history.size) &&
    history.size === pageSize &&
    history.content.length <= pageSize &&
    Number.isInteger(history.totalElements) &&
    history.totalElements >= 0 &&
    Number.isInteger(history.totalPages) &&
    history.totalPages >= 0 &&
    history.totalPages === (
      history.totalElements === 0
        ? 0
        : Math.ceil(history.totalElements / pageSize)
    ) &&
    !(
      history.totalPages === 0 &&
      (history.totalElements !== 0 || history.content.length !== 0)
    ) &&
    !(
      history.totalPages > 0 &&
      requestedPage >= history.totalPages &&
      history.content.length !== 0
    ),
  )
}

function invalidHistoryResponseError() {
  return new Error('Multiplayer round history returned an invalid response')
}

export function createMultiplayerRoundHistoryInitialState(
  authIdentity = '',
  authContextMarker = null,
) {
  return {
    authContextMarker,
    authIdentity,
    detailError: null,
    detailResult: null,
    history: null,
    historyError: '',
    isDetailLoading: false,
    isHistoryLoading: false,
    isResultOpen: false,
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    pendingPage: null,
    retryPage: null,
    selectedRound: null,
  }
}

export function getMultiplayerRoundHistoryPagination({
  history,
  isLoading,
  page,
}) {
  const isCurrentPage = history?.page === page

  return {
    canGoNext: Boolean(
      !isLoading &&
      isCurrentPage &&
      page + 1 < (history?.totalPages ?? 0),
    ),
    canGoPrevious: Boolean(!isLoading && page > 0),
  }
}

export function isMultiplayerHistoryAuthStateCurrent({
  authContextMarker,
  authIdentity,
  isAuthenticated,
  stateAuthIdentity,
  stateAuthContextMarker,
  token,
}) {
  return Boolean(
    isAuthenticated &&
    token &&
    stateAuthIdentity === normalizeAuthIdentity(authIdentity) &&
    stateAuthContextMarker === authContextMarker,
  )
}

export function createMultiplayerRoundHistoryController({
  getResult,
  listHistory,
  onAuthExpired = () => {},
  onStateChange = () => {},
}) {
  let state = createMultiplayerRoundHistoryInitialState()
  let context = { authIdentity: '', isAuthenticated: false, token: '' }
  let activeAuthIdentity = ''
  let activeToken = ''
  let activeRefreshVersion
  let authGeneration = 0
  let historyGeneration = 0
  let detailGeneration = 0
  let historyAbortController = null
  let activeHistoryPage = null
  let detailAbortController = null
  const detailCache = new Map()

  function emit() {
    onStateChange({ ...state })
  }

  function updateState(nextState) {
    state = { ...state, ...nextState }
    emit()
  }

  function abortHistory() {
    historyGeneration += 1
    historyAbortController?.abort()
    historyAbortController = null
    activeHistoryPage = null
  }

  function abortDetail() {
    detailGeneration += 1
    detailAbortController?.abort()
    detailAbortController = null
  }

  function resetAuthContext(
    authIdentity = '',
    token = '',
    authContextMarker = null,
    shouldEmit = true,
  ) {
    authGeneration += 1
    abortHistory()
    abortDetail()
    detailCache.clear()
    activeAuthIdentity = authIdentity
    activeToken = token
    state = createMultiplayerRoundHistoryInitialState(
      authIdentity,
      authContextMarker,
    )

    if (shouldEmit) {
      emit()
    }
  }

  async function loadPage(
    nextPage = state.page,
    { correctionAttempted = false, force = false } = {},
  ) {
    if (!context.isAuthenticated || !context.token || !activeAuthIdentity) {
      return false
    }

    const safePage = Number.isInteger(nextPage) && nextPage >= 0
      ? nextPage
      : 0

    if (!force && historyAbortController && activeHistoryPage === safePage) {
      return false
    }

    abortHistory()
    const requestGeneration = historyGeneration
    const requestAuthGeneration = authGeneration
    historyAbortController = new AbortController()
    activeHistoryPage = safePage
    const requestAbortController = historyAbortController
    updateState({
      historyError: '',
      isHistoryLoading: true,
      pendingPage: safePage,
      retryPage: null,
    })

    try {
      const history = await listHistory({
        token: context.token,
        page: safePage,
        size: state.pageSize,
        signal: requestAbortController.signal,
      })

      if (
        requestGeneration !== historyGeneration ||
        requestAuthGeneration !== authGeneration
      ) {
        return false
      }

      if (!isCompatibleHistoryResponse(history, safePage, state.pageSize)) {
        throw invalidHistoryResponseError()
      }

      if (history.totalPages === 0) {
        updateState({
          history: { ...history, page: 0 },
          historyError: '',
          page: 0,
          pendingPage: null,
          retryPage: null,
        })
        return true
      }

      if (safePage >= history.totalPages) {
        if (correctionAttempted) {
          throw invalidHistoryResponseError()
        }

        return loadPage(history.totalPages - 1, {
          correctionAttempted: true,
          force: true,
        })
      }

      updateState({
        history,
        historyError: '',
        page: safePage,
        pendingPage: null,
        retryPage: null,
      })
      return true
    } catch (error) {
      if (
        isAbortError(error) ||
        requestGeneration !== historyGeneration ||
        requestAuthGeneration !== authGeneration
      ) {
        return false
      }

      if (error?.status === 401) {
        resetAuthContext()
        context = { authIdentity: '', isAuthenticated: false, token: '' }
        onAuthExpired()
        return false
      }

      updateState({
        historyError: `Could not load page ${safePage + 1}. Please try again.`,
        pendingPage: null,
        retryPage: safePage,
      })
      return false
    } finally {
      if (
        requestGeneration === historyGeneration &&
        requestAuthGeneration === authGeneration
      ) {
        historyAbortController = null
        activeHistoryPage = null
        updateState({ isHistoryLoading: false, pendingPage: null })
      }
    }
  }

  function updateContext(nextContext) {
    context = nextContext
    const isAuthenticated = Boolean(context.isAuthenticated && context.token)
    const nextAuthIdentity = isAuthenticated
      ? normalizeAuthIdentity(context.authIdentity)
      : ''
    const nextToken = isAuthenticated ? context.token : ''
    const authChanged = (
      nextAuthIdentity !== activeAuthIdentity ||
      nextToken !== activeToken
    )

    if (!isAuthenticated) {
      if (activeAuthIdentity || activeToken || state.authIdentity) {
        resetAuthContext()
      }
      activeRefreshVersion = context.refreshVersion
      return
    }

    if (authChanged) {
      resetAuthContext(
        nextAuthIdentity,
        nextToken,
        context.authContextMarker,
      )
      activeRefreshVersion = context.refreshVersion
      loadPage(0, { force: true })
      return
    }

    if (context.refreshVersion !== activeRefreshVersion) {
      activeRefreshVersion = context.refreshVersion
      loadPage(state.page, { force: true })
    }
  }

  function rememberDetail(key, result) {
    detailCache.delete(key)
    detailCache.set(key, result)

    if (detailCache.size > DETAIL_CACHE_LIMIT) {
      detailCache.delete(detailCache.keys().next().value)
    }
  }

  async function openResult(round, { force = false } = {}) {
    const key = detailKey(round)
    const hasIdentity = Boolean(
      normalizeRoomCode(round?.roomCode) && normalizeRoundId(round?.roundId),
    )

    if (
      !context.isAuthenticated ||
      !context.token ||
      !activeAuthIdentity ||
      !hasIdentity
    ) {
      return false
    }

    if (
      !force &&
      state.isResultOpen &&
      state.isDetailLoading &&
      detailKey(state.selectedRound) === key
    ) {
      return false
    }

    abortDetail()
    const requestGeneration = detailGeneration
    const requestAuthGeneration = authGeneration
    const cachedResult = force ? null : detailCache.get(key)
    updateState({
      detailError: null,
      detailResult: cachedResult || null,
      isDetailLoading: !cachedResult,
      isResultOpen: true,
      selectedRound: round,
    })

    if (cachedResult) {
      return true
    }

    detailAbortController = new AbortController()
    const requestAbortController = detailAbortController

    try {
      const result = await getResult({
        token: context.token,
        roomCode: round.roomCode,
        roundId: round.roundId,
        signal: requestAbortController.signal,
      })

      if (
        requestGeneration !== detailGeneration ||
        requestAuthGeneration !== authGeneration
      ) {
        return false
      }

      if (!isMatchingResultIdentity(result, round)) {
        throw createResultIdentityError()
      }

      rememberDetail(key, result)
      updateState({ detailError: null, detailResult: result })
      return true
    } catch (error) {
      if (
        isAbortError(error) ||
        requestGeneration !== detailGeneration ||
        requestAuthGeneration !== authGeneration
      ) {
        return false
      }

      if (error?.status === 401) {
        const detailError = safeDetailError(error)
        resetAuthContext()
        context = { authIdentity: '', isAuthenticated: false, token: '' }
        updateState({ detailError })
        onAuthExpired()
        return false
      }

      updateState({ detailError: safeDetailError(error), detailResult: null })
      return false
    } finally {
      if (
        requestGeneration === detailGeneration &&
        requestAuthGeneration === authGeneration
      ) {
        detailAbortController = null
        updateState({ isDetailLoading: false })
      }
    }
  }

  function closeResult() {
    abortDetail()
    updateState({
      detailError: null,
      detailResult: null,
      isDetailLoading: false,
      isResultOpen: false,
      selectedRound: null,
    })
  }

  function destroy() {
    resetAuthContext('', '', null, false)
    context = { authIdentity: '', isAuthenticated: false, token: '' }
    activeRefreshVersion = undefined
  }

  return {
    closeResult,
    destroy,
    loadPage,
    openResult,
    retryDetail: () => state.selectedRound
      ? openResult(state.selectedRound, { force: true })
      : false,
    retryHistory: () => loadPage(state.retryPage ?? state.page),
    updateContext,
  }
}
