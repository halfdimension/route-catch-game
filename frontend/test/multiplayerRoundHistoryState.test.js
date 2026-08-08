import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMultiplayerRoundHistoryController,
  getMultiplayerRoundHistoryPagination,
  isMultiplayerHistoryAuthStateCurrent,
} from '../src/components/multiplayerRoundHistoryState.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function history(page, content = [], overrides = {}) {
  return {
    content,
    page,
    size: 10,
    totalElements: content.length ? page * 10 + content.length : 0,
    totalPages: content.length ? page + 1 : 0,
    ...overrides,
  }
}

function round(roundId = 'round-1', roomCode = 'ROOM') {
  return { roundId, roomCode, endedAt: '2026-08-06T12:01:00Z' }
}

function result(roundId = 'round-1', roomCode = 'ROOM') {
  return {
    publicResult: { leaderboard: [], roomCode, roundId },
    personalResult: { caughtCreatures: [], roomCode, roundId },
  }
}

function setup(overrides = {}) {
  const states = []
  const historyCalls = []
  const resultCalls = []
  let authExpiredCalls = 0
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async (request) => {
      historyCalls.push(request)
      return history(request.page, [round(`round-${request.page}`)])
    },
    getResult: async (request) => {
      resultCalls.push(request)
      return result(request.roundId, request.roomCode)
    },
    onAuthExpired: () => { authExpiredCalls += 1 },
    onStateChange: (state) => states.push(state),
    ...overrides,
  })

  return {
    controller,
    get authExpiredCalls() { return authExpiredCalls },
    historyCalls,
    resultCalls,
    states,
  }
}

test('does not request history while unauthenticated and loads page zero once after auth', async () => {
  const context = setup()
  context.controller.updateContext({ isAuthenticated: false, token: '' })
  assert.equal(context.historyCalls.length, 0)

  context.controller.updateContext({
    isAuthenticated: true,
    refreshVersion: 0,
    token: 'token',
  })
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(context.historyCalls.length, 1)
  assert.equal(context.historyCalls[0].page, 0)
  assert.equal(context.historyCalls[0].size, 10)
  assert.equal(context.states.at(-1).history.content[0].roundId, 'round-0')
  assert.equal(context.states.at(-1).isHistoryLoading, false)
  assert.equal(context.resultCalls.length, 0)
})

test('pagination enables only valid backend pages and disables on the final page', () => {
  assert.deepEqual(
    getMultiplayerRoundHistoryPagination({
      history: history(0, [round()], { totalElements: 11, totalPages: 2 }),
      isLoading: false,
      page: 0,
    }),
    { canGoNext: true, canGoPrevious: false },
  )
  assert.deepEqual(
    getMultiplayerRoundHistoryPagination({
      history: history(1, [round()], { totalElements: 11, totalPages: 2 }),
      isLoading: false,
      page: 1,
    }),
    { canGoNext: false, canGoPrevious: true },
  )
  assert.deepEqual(
    getMultiplayerRoundHistoryPagination({
      history: history(0, [round()], { totalElements: 11, totalPages: 2 }),
      isLoading: true,
      page: 0,
    }),
    { canGoNext: false, canGoPrevious: false },
  )
})

test('loads each requested page once and ignores negative pages', async () => {
  const context = setup()
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  await Promise.resolve()
  await context.controller.loadPage(1)
  await context.controller.loadPage(-4)

  assert.deepEqual(context.historyCalls.map((call) => call.page), [0, 1, 0])
  assert.equal(context.states.at(-1).page, 0)
})

test('duplicate requests for the same page transition are prevented', async () => {
  const pending = deferred()
  let requests = 0
  const context = setup({
    listHistory: () => {
      requests += 1
      return pending.promise
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  const duplicate = await context.controller.loadPage(0)

  assert.equal(duplicate, false)
  assert.equal(requests, 1)
  pending.resolve(history(0))
  await Promise.resolve()
  await Promise.resolve()
})

test('a stale slower page response cannot overwrite the newest page', async () => {
  const requests = []
  const context = setup({
    listHistory: (request) => {
      const pending = deferred()
      requests.push({ ...request, pending })
      return pending.promise
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  const nextPageRequest = context.controller.loadPage(1)

  requests[1].pending.resolve(history(1, [round('newest')], {
    totalElements: 11,
    totalPages: 2,
  }))
  await nextPageRequest
  requests[0].pending.resolve(history(0, [round('stale')], {
    totalElements: 11,
    totalPages: 2,
  }))
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(context.states.at(-1).page, 1)
  assert.equal(context.states.at(-1).history.content[0].roundId, 'newest')
})

test('history failures are retryable and preserve loaded data', async () => {
  let calls = 0
  const loadedHistory = history(0, [round('loaded')])
  const context = setup({
    listHistory: async () => {
      calls += 1
      if (calls === 1) return loadedHistory
      const error = new Error('raw backend detail')
      error.status = 503
      throw error
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  await Promise.resolve()
  await Promise.resolve()
  await context.controller.retryHistory()

  const latestState = context.states.at(-1)
  assert.equal(context.authExpiredCalls, 0)
  assert.equal(latestState.history, loadedHistory)
  assert.match(latestState.historyError, /Could not load page 1/)
  assert.equal(latestState.historyError.includes('raw backend'), false)
})

test('opening a row requests only its exact durable result and close cancels work', async () => {
  const pending = deferred()
  const context = setup({
    getResult: (request) => {
      context.resultCalls.push(request)
      return pending.promise
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  await Promise.resolve()
  const selected = round('round-exact', 'A/B')
  const detailRequest = context.controller.openResult(selected)

  assert.equal(context.resultCalls.length, 1)
  assert.equal(context.resultCalls[0].roomCode, 'A/B')
  assert.equal(context.resultCalls[0].roundId, 'round-exact')
  assert.equal(context.states.at(-1).isResultOpen, true)
  assert.equal(context.states.at(-1).isDetailLoading, true)
  assert.equal(context.resultCalls[0].signal.aborted, false)

  context.controller.closeResult()
  assert.equal(context.resultCalls[0].signal.aborted, true)
  assert.equal(context.states.at(-1).isResultOpen, false)
  pending.resolve(result('round-exact', 'A/B'))
  await detailRequest
})

test('duplicate detail opens are prevented and a loaded detail is cached locally', async () => {
  const pending = deferred()
  let requests = 0
  const context = setup({
    getResult: async () => {
      requests += 1
      return pending.promise
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  await Promise.resolve()
  const selected = round()
  const first = context.controller.openResult(selected)
  const duplicate = await context.controller.openResult(selected)
  assert.equal(duplicate, false)
  assert.equal(requests, 1)

  pending.resolve(result())
  await first
  context.controller.closeResult()
  const didOpenCached = await context.controller.openResult(selected)
  assert.equal(didOpenCached, true)
  assert.equal(requests, 1)
  assert.equal(context.states.at(-1).detailResult.publicResult.roundId, 'round-1')
})

test('a second selected result cannot be overwritten by the first request', async () => {
  const requests = []
  const context = setup({
    getResult: (request) => {
      const pending = deferred()
      requests.push({ request, pending })
      return pending.promise
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  await Promise.resolve()
  const firstRequest = context.controller.openResult(round('first', 'ONE'))
  const secondRequest = context.controller.openResult(round('second', 'TWO'))

  requests[1].pending.resolve(result('second', 'TWO'))
  await secondRequest
  requests[0].pending.resolve(result('mismatched', 'OTHER'))
  await firstRequest

  assert.equal(context.states.at(-1).selectedRound.roundId, 'second')
  assert.equal(context.states.at(-1).detailResult.publicResult.roundId, 'second')
})

test('detail auth expiry and forbidden/not-found responses use safe messages', async () => {
  const errors = [401, 403, 404]
  const context = setup({
    getResult: async () => {
      const error = new Error('raw private backend message')
      error.status = errors.shift()
      throw error
    },
  })
  context.controller.updateContext({ isAuthenticated: true, token: 'token' })
  await Promise.resolve()

  await context.controller.openResult(round('one'))
  assert.equal(context.authExpiredCalls, 1)
  assert.match(context.states.at(-1).detailError.message, /session has expired/)

  context.controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-2',
  })
  context.controller.closeResult()
  await context.controller.openResult(round('two'))
  assert.equal(context.states.at(-1).detailError.message, 'This historical result is unavailable.')

  context.controller.closeResult()
  await context.controller.openResult(round('three'))
  assert.equal(context.states.at(-1).detailError.message, 'This historical result is unavailable.')
})

test('Strict Mode setup, cleanup, and second setup starts a fresh initial load', async () => {
  const requests = []
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: (request) => {
      const pending = deferred()
      requests.push({ pending, request })
      return pending.promise
    },
    getResult: async () => result(),
    onStateChange: (state) => states.push(state),
  })
  const context = {
    authIdentity: 'user-a',
    isAuthenticated: true,
    refreshVersion: 0,
    token: 'token-a',
  }

  controller.updateContext(context)
  controller.destroy()
  assert.equal(requests[0].request.signal.aborted, true)

  controller.updateContext(context)
  assert.equal(requests.length, 2)
  requests[1].pending.resolve(history(0, [round('fresh')]))
  await Promise.resolve()
  await Promise.resolve()
  requests[0].pending.resolve(history(0, [round('strict-stale')]))
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(states.at(-1).isHistoryLoading, false)
  assert.equal(states.at(-1).history.content[0].roundId, 'fresh')
})

test('real destroy invalidates pending history without emitting after unmount', async () => {
  const pending = deferred()
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: () => pending.promise,
    getResult: async () => result(),
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  const stateCountBeforeDestroy = states.length
  controller.destroy()
  pending.resolve(history(0, [round('late')]))
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(states.length, stateCountBeforeDestroy)
})

test('failed navigation keeps committed page and rows until retry succeeds', async () => {
  let pageOneAttempts = 0
  const calls = []
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async (request) => {
      calls.push(request.page)
      if (request.page === 0) {
        return history(0, [round('page-zero')], {
          totalElements: 11,
          totalPages: 2,
        })
      }

      pageOneAttempts += 1
      if (pageOneAttempts === 1) {
        throw Object.assign(new Error('unavailable'), { status: 503 })
      }

      return history(1, [round('page-one')], {
        totalElements: 11,
        totalPages: 2,
      })
    },
    getResult: async () => result(),
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  await Promise.resolve()
  await Promise.resolve()

  await controller.loadPage(1)
  let latestState = states.at(-1)
  assert.equal(latestState.page, 0)
  assert.equal(latestState.history.page, 0)
  assert.equal(latestState.history.content[0].roundId, 'page-zero')
  assert.equal(latestState.retryPage, 1)
  assert.match(latestState.historyError, /page 2/)

  await controller.retryHistory()
  latestState = states.at(-1)
  assert.deepEqual(calls, [0, 1, 1])
  assert.equal(latestState.page, 1)
  assert.equal(latestState.history.page, 1)
  assert.equal(latestState.history.content[0].roundId, 'page-one')
})

test('shrinking totals reconcile a committed later page to the last valid page', async () => {
  const calls = []
  let pageTwoLoads = 0
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async (request) => {
      calls.push(request.page)
      if (request.page === 2) {
        pageTwoLoads += 1
        return pageTwoLoads === 1
          ? history(2, [round('old-last-page')], {
              totalElements: 21,
              totalPages: 3,
            })
          : history(2, [], { totalElements: 11, totalPages: 2 })
      }
      if (request.page === 1) {
        return history(1, [round('new-last-page')], {
          totalElements: 11,
          totalPages: 2,
        })
      }
      return history(0, [round('first-page')], {
        totalElements: 21,
        totalPages: 3,
      })
    },
    getResult: async () => result(),
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    refreshVersion: 0,
    token: 'token-a',
  })
  await Promise.resolve()
  await controller.loadPage(2)
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    refreshVersion: 1,
    token: 'token-a',
  })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(calls, [0, 2, 2, 1])
  assert.equal(states.at(-1).page, 1)
  assert.equal(states.at(-1).history.totalPages, 2)
  assert.equal(states.at(-1).history.content[0].roundId, 'new-last-page')
})

test('a zero-page out-of-range response normalizes to committed page zero without a loop', async () => {
  const calls = []
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async (request) => {
      calls.push(request.page)
      return request.page === 0
        ? history(0, [round('loaded')])
        : history(request.page, [], { totalElements: 0, totalPages: 0 })
    },
    getResult: async () => result(),
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  await Promise.resolve()
  await controller.loadPage(4)

  assert.deepEqual(calls, [0, 4])
  assert.equal(states.at(-1).page, 0)
  assert.equal(states.at(-1).history.page, 0)
  assert.equal(states.at(-1).history.totalPages, 0)
})

test('a response page mismatch is rejected without changing committed data', async () => {
  let calls = 0
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async (request) => {
      calls += 1
      return calls === 1
        ? history(0, [round('committed')], { totalElements: 11, totalPages: 2 })
        : history(request.page - 1, [round('wrong-page')], {
            totalElements: 11,
            totalPages: 2,
          })
    },
    getResult: async () => result(),
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  await Promise.resolve()
  await controller.loadPage(1)

  assert.equal(states.at(-1).page, 0)
  assert.equal(states.at(-1).history.content[0].roundId, 'committed')
  assert.equal(states.at(-1).retryPage, 1)
})

test('logout and account switches clear cached personal results', async () => {
  for (const switchMode of ['logout-first', 'direct']) {
    const detailCalls = []
    const states = []
    const controller = createMultiplayerRoundHistoryController({
      listHistory: async () => history(0),
      getResult: async (request) => {
        detailCalls.push(request)
        return {
          ...result(request.roundId, request.roomCode),
          personalResult: {
            ...result(request.roundId, request.roomCode).personalResult,
            playerId: request.token === 'token-a' ? 'user-a' : 'user-b',
          },
        }
      },
      onStateChange: (state) => states.push(state),
    })
    controller.updateContext({
      authIdentity: 'user-a',
      isAuthenticated: true,
      token: 'token-a',
    })
    await controller.openResult(round())
    controller.closeResult()

    if (switchMode === 'logout-first') {
      controller.updateContext({
        authIdentity: '',
        isAuthenticated: false,
        token: '',
      })
    }
    controller.updateContext({
      authIdentity: 'user-b',
      isAuthenticated: true,
      token: 'token-b',
    })
    await controller.openResult(round())

    assert.equal(detailCalls.length, 2, switchMode)
    assert.equal(states.at(-1).detailResult.personalResult.playerId, 'user-b')
  }
})

test('logout aborts pending detail and stale prior-account work cannot populate new state', async () => {
  const requests = []
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async () => history(0),
    getResult: (request) => {
      const pending = deferred()
      requests.push({ pending, request })
      return pending.promise
    },
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  const userARequest = controller.openResult(round())
  controller.updateContext({ isAuthenticated: false, token: '' })
  assert.equal(requests[0].request.signal.aborted, true)
  controller.updateContext({
    authIdentity: 'user-b',
    isAuthenticated: true,
    token: 'token-b',
  })

  requests[0].pending.resolve({
    ...result(),
    personalResult: { ...result().personalResult, playerId: 'user-a' },
  })
  await userARequest
  assert.equal(states.at(-1).detailResult, null)

  const userBRequest = controller.openResult(round())
  requests[1].pending.resolve({
    ...result(),
    personalResult: { ...result().personalResult, playerId: 'user-b' },
  })
  await userBRequest
  assert.equal(requests.length, 2)
  assert.equal(states.at(-1).detailResult.personalResult.playerId, 'user-b')
})

test('mismatched detail identity is unavailable and is never cached', async () => {
  let detailCalls = 0
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async () => history(0),
    getResult: async () => {
      detailCalls += 1
      return detailCalls === 1
        ? result('round-b', 'ROOM_B')
        : result('round-a', 'ROOM_A')
    },
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  const selected = round('round-a', 'ROOM_A')
  await controller.openResult(selected)
  assert.equal(states.at(-1).detailResult, null)
  assert.equal(
    states.at(-1).detailError.message,
    'This historical result is unavailable.',
  )

  controller.closeResult()
  await controller.openResult(selected)
  assert.equal(detailCalls, 2)
  assert.equal(states.at(-1).detailResult.publicResult.roundId, 'round-a')
})

test('failed and aborted detail responses are not cached', async () => {
  let failureCalls = 0
  const failedController = createMultiplayerRoundHistoryController({
    listHistory: async () => history(0),
    getResult: async () => {
      failureCalls += 1
      if (failureCalls === 1) {
        throw Object.assign(new Error('unavailable'), { status: 503 })
      }
      return result()
    },
  })
  failedController.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  await failedController.openResult(round())
  failedController.closeResult()
  await failedController.openResult(round())
  assert.equal(failureCalls, 2)

  const requests = []
  const abortedController = createMultiplayerRoundHistoryController({
    listHistory: async () => history(0),
    getResult: (request) => {
      const pending = deferred()
      requests.push({ pending, request })
      return pending.promise
    },
  })
  abortedController.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  const abortedRequest = abortedController.openResult(round())
  abortedController.closeResult()
  requests[0].pending.resolve(result())
  await abortedRequest
  const freshRequest = abortedController.openResult(round())
  requests[1].pending.resolve(result())
  await freshRequest
  assert.equal(requests.length, 2)
})

test('unauthorized detail responses clear cache before the next authenticated request', async () => {
  let detailCalls = 0
  const states = []
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async () => history(0),
    getResult: async () => {
      detailCalls += 1
      if (detailCalls === 1) {
        throw Object.assign(new Error('expired'), { status: 401 })
      }
      return {
        ...result(),
        personalResult: { ...result().personalResult, playerId: 'user-b' },
      }
    },
    onStateChange: (state) => states.push(state),
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  await controller.openResult(round())
  controller.updateContext({
    authIdentity: 'user-b',
    isAuthenticated: true,
    token: 'token-b',
  })
  await controller.openResult(round())

  assert.equal(detailCalls, 2)
  assert.equal(states.at(-1).detailResult.personalResult.playerId, 'user-b')
})

test('detail cache retains at most five results with deterministic eviction', async () => {
  const detailCalls = new Map()
  const controller = createMultiplayerRoundHistoryController({
    listHistory: async () => history(0),
    getResult: async (request) => {
      detailCalls.set(
        request.roundId,
        (detailCalls.get(request.roundId) || 0) + 1,
      )
      return result(request.roundId, request.roomCode)
    },
  })
  controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })

  for (let index = 1; index <= 6; index += 1) {
    await controller.openResult(round(`round-${index}`))
    controller.closeResult()
  }
  await controller.openResult(round('round-1'))
  controller.closeResult()
  await controller.openResult(round('round-2'))

  assert.equal(detailCalls.get('round-1'), 2)
  assert.equal(detailCalls.get('round-2'), 2)
  assert.equal(detailCalls.get('round-6'), 1)
})

test('authentication display guard hides logged-out and prior-user state immediately', () => {
  const markerA = {}
  const markerB = {}
  assert.equal(isMultiplayerHistoryAuthStateCurrent({
    authContextMarker: markerA,
    authIdentity: 'user-a',
    isAuthenticated: true,
    stateAuthIdentity: 'user-a',
    stateAuthContextMarker: markerA,
    token: 'token-a',
  }), true)
  assert.equal(isMultiplayerHistoryAuthStateCurrent({
    authContextMarker: markerB,
    authIdentity: 'user-b',
    isAuthenticated: true,
    stateAuthIdentity: 'user-a',
    stateAuthContextMarker: markerA,
    token: 'token-b',
  }), false)
  assert.equal(isMultiplayerHistoryAuthStateCurrent({
    authContextMarker: null,
    authIdentity: 'user-a',
    isAuthenticated: false,
    stateAuthIdentity: 'user-a',
    stateAuthContextMarker: markerA,
    token: '',
  }), false)
  assert.equal(isMultiplayerHistoryAuthStateCurrent({
    authContextMarker: markerB,
    authIdentity: 'user-a',
    isAuthenticated: true,
    stateAuthIdentity: 'user-a',
    stateAuthContextMarker: markerA,
    token: 'token-b',
  }), false)
})

test('history 401 clears protected history and expires authentication', async () => {
  let calls = 0
  const context = setup({
    listHistory: async () => {
      calls += 1
      if (calls === 1) return history(0, [round('private')])
      throw Object.assign(new Error('expired'), { status: 401 })
    },
  })
  context.controller.updateContext({
    authIdentity: 'user-a',
    isAuthenticated: true,
    token: 'token-a',
  })
  await Promise.resolve()
  await Promise.resolve()
  await context.controller.retryHistory()

  assert.equal(context.authExpiredCalls, 1)
  assert.equal(context.states.at(-1).history, null)
  assert.equal(context.states.at(-1).authIdentity, '')
})
