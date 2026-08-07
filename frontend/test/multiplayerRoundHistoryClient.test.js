import assert from 'node:assert/strict'
import test from 'node:test'
import { requestAuthenticatedMultiplayerJson } from '../src/api/multiplayerAuthenticatedClient.js'
import { listMultiplayerRoundHistory } from '../src/api/multiplayerRoundHistoryClient.js'

function historyResponse(overrides = {}) {
  return {
    content: [
      {
        creaturesCaught: 6,
        durationSeconds: 60,
        endedAt: '2026-08-06T12:01:00Z',
        endReason: 'TIME_EXPIRED',
        participantCount: 2,
        rank: 1,
        roomCode: 'KSUTXG',
        roundId: 'round-1',
        score: 280,
        startedAt: '2026-08-06T12:00:00Z',
      },
    ],
    page: 0,
    size: 10,
    totalElements: 1,
    totalPages: 1,
    ...overrides,
  }
}

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('lists the authenticated user history with backend page, size, and signal', async () => {
  const originalFetch = globalThis.fetch
  const abortController = new AbortController()
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse(historyResponse({
      page: 2,
      totalElements: 21,
      totalPages: 3,
    }))
  }

  try {
    const response = await listMultiplayerRoundHistory({
      token: 'token-value',
      page: 2,
      size: 10,
      signal: abortController.signal,
    })

    assert.equal(
      request.url,
      'http://localhost:8080/api/multiplayer/me/rounds?page=2&size=10',
    )
    assert.equal(request.options.headers.Authorization, 'Bearer token-value')
    assert.equal(request.options.signal, abortController.signal)
    assert.equal(response.content[0].rank, 1)
    assert.equal(response.content[0].score, 280)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not accept or send a user id', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async (url) => {
    requestedUrl = url
    return jsonResponse(historyResponse())
  }

  try {
    await listMultiplayerRoundHistory({
      token: 'token',
      page: 0,
      size: 10,
      userId: 'another-user',
    })

    assert.equal(requestedUrl.includes('user'), false)
    assert.equal(requestedUrl.includes('another-user'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves 401 status and backend error code for auth expiry handling', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse(
    { errorCode: 'AUTH_REQUIRED', message: 'Authentication required' },
    { status: 401 },
  )

  try {
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'expired', page: 0, size: 10 }),
      (error) => error.status === 401 && error.errorCode === 'AUTH_REQUIRED',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves structured backend failures without exposing unstructured bodies', async () => {
  const originalFetch = globalThis.fetch

  try {
    globalThis.fetch = async () => jsonResponse(
      {
        errorCode: 'ROUND_HISTORY_UNAVAILABLE',
        message: 'Multiplayer round history is unavailable',
      },
      { status: 503 },
    )
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'token', page: 0, size: 10 }),
      (error) => (
        error.status === 503 &&
        error.errorCode === 'ROUND_HISTORY_UNAVAILABLE'
      ),
    )

    globalThis.fetch = async () => new Response('<pre>database details</pre>', {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    })
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'token', page: 0, size: 10 }),
      (error) => (
        error.status === 500 &&
        !error.message.includes('database details')
      ),
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects malformed responses and invalid pagination before use', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ content: [] })

  try {
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'token', page: 0, size: 10 }),
      /invalid response/,
    )
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'token', page: -1, size: 10 }),
      /page must be an integer of at least 0/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects a response page or size that does not match the request', async () => {
  const originalFetch = globalThis.fetch

  try {
    globalThis.fetch = async () => jsonResponse(historyResponse({ page: 1 }))
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'token', page: 0, size: 10 }),
      /invalid response/,
    )

    globalThis.fetch = async () => jsonResponse(historyResponse({ size: 20 }))
    await assert.rejects(
      listMultiplayerRoundHistory({ token: 'token', page: 0, size: 10 }),
      /invalid response/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('passes cancellation through to fetch', async () => {
  const originalFetch = globalThis.fetch
  const abortController = new AbortController()
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

  try {
    const request = listMultiplayerRoundHistory({
      token: 'token',
      page: 0,
      size: 10,
      signal: abortController.signal,
    })
    abortController.abort()
    await assert.rejects(request, (error) => error.name === 'AbortError')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves AbortError while response JSON parsing is pending', async () => {
  const originalFetch = globalThis.fetch
  const abortController = new AbortController()
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    json: async () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    }),
  })

  try {
    const request = requestAuthenticatedMultiplayerJson({
      path: '/api/test',
      token: 'token',
      signal: abortController.signal,
    })
    await Promise.resolve()
    abortController.abort()
    await assert.rejects(request, (error) => error.name === 'AbortError')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generic successful-response JSON failures use a safe parsing error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => { throw new SyntaxError('raw parser detail') },
  })

  try {
    await assert.rejects(
      requestAuthenticatedMultiplayerJson({ path: '/api/test', token: 'token' }),
      (error) => (
        error.message === 'Multiplayer request returned an invalid response' &&
        !error.message.includes('raw parser detail')
      ),
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
