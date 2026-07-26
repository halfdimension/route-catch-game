import assert from 'node:assert/strict'
import test from 'node:test'
import { createMultiplayerRoundResultController } from '../src/hooks/multiplayerRoundResultState.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

function roundResult({ roomCode = 'ROOM', roundId = 'round-1' } = {}) {
  return {
    publicResult: {
      endReason: 'TIME_EXPIRED',
      leaderboard: [],
      roomCode,
      roundId,
    },
    personalResult: {
      caughtCreatures: [],
      displayName: 'Player',
      playerCount: 1,
      playerId: 'player-1',
      rank: 1,
      rarityCounts: {},
      roomCode,
      roundId,
      score: 15,
    },
  }
}

function gameState({
  gameStatus = 'ENDED',
  generation = 1,
  roomCode = 'ROOM',
  roundId = 'round-1',
} = {}) {
  return { gameStatus, generation, roomCode, roundId }
}

function gameEndedEvent({ eventId = 'event-1', roomCode = 'ROOM', roundId = 'round-1' } = {}) {
  return {
    eventId,
    eventType: 'GAME_ENDED',
    payload: { roundId },
    roomCode,
  }
}

function createController(overrides = {}) {
  const states = []
  const exactRequests = []
  const latestRequests = []
  const controller = createMultiplayerRoundResultController({
    getExactResult: async (request) => {
      exactRequests.push(request)
      return roundResult({ roundId: request.roundId })
    },
    getLatestResult: async (request) => {
      latestRequests.push(request)
      return roundResult()
    },
    onStateChange: (state) => states.push(state),
    ...overrides,
  })

  return { controller, exactRequests, latestRequests, states }
}

async function flushRequests() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('GAME_ENDED retrieves the exact backend round once', async () => {
  const { controller, exactRequests, latestRequests } = createController()

  controller.updateContext({
    roomCode: 'ROOM',
    roomEvent: gameEndedEvent({ roundId: 'round-exact' }),
    token: 'token',
  })
  await flushRequests()

  assert.equal(exactRequests.length, 1)
  assert.equal(exactRequests[0].roundId, 'round-exact')
  assert.equal(latestRequests.length, 0)
  assert.equal(controller.getState().result.publicResult.roundId, 'round-exact')
})

test('duplicate GAME_ENDED neither re-requests nor re-presents its result', async () => {
  const { controller, exactRequests, states } = createController()
  const event = gameEndedEvent()

  controller.updateContext({ roomCode: 'ROOM', roomEvent: event, token: 'token' })
  await flushRequests()
  controller.close()
  controller.updateContext({ roomCode: 'ROOM', roomEvent: event, token: 'token' })
  await flushRequests()

  assert.equal(exactRequests.length, 1)
  assert.equal(
    states.filter((state, index) => state.isOpen && !states[index - 1]?.isOpen)
      .length,
    1,
  )
  assert.equal(controller.getState().isOpen, false)
})

test('polling RUNNING to ENDED with an OPEN room recovers latest once', async () => {
  const { controller, latestRequests } = createController()
  const runningContext = {
    gameState: {
      ...gameState({ gameStatus: 'RUNNING' }),
      roomStatus: 'IN_PROGRESS',
    },
    roomCode: 'ROOM',
    token: 'token',
  }
  const endedContext = {
    ...runningContext,
    gameState: {
      ...gameState(),
      roomStatus: 'OPEN',
    },
  }

  controller.updateContext(runningContext)
  assert.equal(latestRequests.length, 0)
  controller.updateContext(endedContext)
  controller.updateContext(endedContext)
  await flushRequests()

  assert.equal(latestRequests.length, 1)
  assert.equal(controller.getState().result.personalResult.roundId, 'round-1')
})

test('an event and polling race performs one effective retrieval', async () => {
  const latestResponse = deferred()
  const { controller, exactRequests, latestRequests } = createController({
    getLatestResult: (request) => {
      latestRequests.push(request)
      return latestResponse.promise
    },
  })
  const endedContext = {
    gameState: gameState(),
    roomCode: 'ROOM',
    token: 'token',
  }

  controller.updateContext(endedContext)
  controller.updateContext({
    ...endedContext,
    roomEvent: gameEndedEvent(),
  })
  latestResponse.resolve(roundResult())
  await flushRequests()

  assert.equal(latestRequests.length, 1)
  assert.equal(exactRequests.length, 0)
  assert.equal(controller.getState().isOpen, true)
  assert.equal(controller.getState().result.publicResult.roundId, 'round-1')
})

test('a current GAME_ENDED event survives a stale RUNNING polling render', async () => {
  const exactResponse = deferred()
  let exactRequest
  const { controller, exactRequests, latestRequests } = createController({
    getExactResult: (request) => {
      exactRequest = request
      exactRequests.push(request)
      return exactResponse.promise
    },
  })
  const staleRunningContext = {
    gameState: gameState({ gameStatus: 'RUNNING' }),
    roomCode: 'ROOM',
    roomEvent: gameEndedEvent(),
    token: 'token',
  }

  controller.updateContext(staleRunningContext)
  controller.updateContext(staleRunningContext)

  assert.equal(exactRequests.length, 1)
  assert.equal(exactRequest.signal.aborted, false)

  exactResponse.resolve(roundResult())
  await flushRequests()

  assert.equal(latestRequests.length, 0)
  assert.equal(controller.getState().isOpen, true)
  assert.equal(controller.getState().result.publicResult.roundId, 'round-1')
})

test('a reconnect retries latest-result recovery after an offline failure', async () => {
  let latestCallCount = 0
  const { controller, latestRequests } = createController({
    getLatestResult: async (request) => {
      latestRequests.push(request)
      latestCallCount += 1
      if (latestCallCount === 1) {
        throw new TypeError('Network unavailable')
      }
      return roundResult()
    },
  })
  const context = { gameState: gameState(), roomCode: 'ROOM', token: 'token' }

  controller.updateContext({ ...context, connectionStatus: 'disconnected' })
  await flushRequests()
  controller.updateContext({ ...context, connectionStatus: 'connected' })
  await flushRequests()

  assert.equal(latestRequests.length, 2)
  assert.equal(controller.getState().result.publicResult.roundId, 'round-1')
})

test('loading an already-ended round recovers its latest result', async () => {
  const { controller, latestRequests } = createController()

  controller.updateContext({
    connectionStatus: 'connected',
    gameState: gameState(),
    roomCode: 'ROOM',
    token: 'token',
  })
  await flushRequests()

  assert.equal(latestRequests.length, 1)
  assert.equal(controller.getState().result.publicResult.roundId, 'round-1')
})

test('an older delayed response cannot replace a newer round result', async () => {
  const firstResponse = deferred()
  const secondResponse = deferred()
  let requestCount = 0
  const { controller } = createController({
    getExactResult: () => {
      requestCount += 1
      return requestCount === 1 ? firstResponse.promise : secondResponse.promise
    },
  })

  controller.updateContext({
    roomCode: 'ROOM', roomEvent: gameEndedEvent({ roundId: 'round-old' }), token: 'token',
  })
  controller.updateContext({
    roomCode: 'ROOM', roomEvent: gameEndedEvent({ eventId: 'event-2', roundId: 'round-new' }), token: 'token',
  })
  secondResponse.resolve(roundResult({ roundId: 'round-new' }))
  await flushRequests()
  firstResponse.resolve(roundResult({ roundId: 'round-old' }))
  await flushRequests()

  assert.equal(controller.getState().result.publicResult.roundId, 'round-new')
})

test('switching rooms aborts the old request and clears its result state', async () => {
  const pendingResponse = deferred()
  let pendingRequest
  const { controller } = createController({
    getExactResult: (request) => {
      pendingRequest = request
      return pendingResponse.promise
    },
  })

  controller.updateContext({
    roomCode: 'ROOM', roomEvent: gameEndedEvent(), token: 'token',
  })
  controller.updateContext({ roomCode: 'OTHER', token: 'token' })
  pendingResponse.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  await flushRequests()

  assert.equal(pendingRequest.signal.aborted, true)
  assert.equal(controller.getState().result, null)
  assert.equal(controller.getState().isOpen, false)
})

test('a genuinely new running round clears the prior result presentation', async () => {
  const { controller } = createController()

  controller.updateContext({
    roomCode: 'ROOM', roomEvent: gameEndedEvent(), token: 'token',
  })
  await flushRequests()
  controller.updateContext({
    gameState: gameState({ gameStatus: 'RUNNING', roundId: 'round-2' }),
    roomCode: 'ROOM',
    token: 'token',
  })

  assert.equal(controller.getState().result, null)
  assert.equal(controller.getState().isOpen, false)
})

test('a stale prior GAME_ENDED event cannot reopen during a new round', async () => {
  const { controller, exactRequests } = createController()
  const priorEvent = gameEndedEvent()

  controller.updateContext({
    roomCode: 'ROOM', roomEvent: priorEvent, token: 'token',
  })
  await flushRequests()
  controller.close()
  controller.updateContext({
    gameState: gameState({ gameStatus: 'RUNNING', roundId: 'round-2' }),
    roomCode: 'ROOM',
    roomEvent: priorEvent,
    token: 'token',
  })
  await flushRequests()

  assert.equal(exactRequests.length, 1)
  assert.equal(controller.getState().result, null)
  assert.equal(controller.getState().isOpen, false)
})

test('a network error exposes retry and retry succeeds', async () => {
  let callCount = 0
  const { controller } = createController({
    getExactResult: async (request) => {
      callCount += 1
      if (callCount === 1) {
        throw new TypeError('Network unavailable')
      }
      return roundResult({ roundId: request.roundId })
    },
  })

  controller.updateContext({
    roomCode: 'ROOM', roomEvent: gameEndedEvent(), token: 'token',
  })
  await flushRequests()
  assert.match(controller.getState().error.message, /Network unavailable/)
  await controller.retry()

  assert.equal(callCount, 2)
  assert.equal(controller.getState().error, null)
  assert.equal(controller.getState().result.publicResult.roundId, 'round-1')
})

test('an aborted request does not become a user-facing error', async () => {
  const pendingResponse = deferred()
  const { controller } = createController({
    getExactResult: () => pendingResponse.promise,
  })

  controller.updateContext({
    roomCode: 'ROOM', roomEvent: gameEndedEvent(), token: 'token',
  })
  controller.clear()
  pendingResponse.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  await flushRequests()

  assert.equal(controller.getState().error, null)
  assert.equal(controller.getState().isOpen, false)
})

test('the same completed round opens automatically only once', async () => {
  const { controller, states } = createController()
  const event = gameEndedEvent()

  controller.updateContext({ roomCode: 'ROOM', roomEvent: event, token: 'token' })
  await flushRequests()
  controller.close()
  controller.updateContext({
    gameState: gameState(), roomCode: 'ROOM', roomEvent: event, token: 'token',
  })
  await flushRequests()

  const openedTransitions = states.filter((state, index) => (
    state.isOpen && !states[index - 1]?.isOpen
  ))
  assert.equal(openedTransitions.length, 1)
})
