import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getLatestRoundResult,
  getRoundResult,
} from '../src/api/multiplayerRoundResultClient.js'

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('fetches an exact result with encoded identifiers, auth, and signal', async () => {
  const originalFetch = globalThis.fetch
  const abortController = new AbortController()
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return jsonResponse({ publicResult: {}, personalResult: {} })
  }

  try {
    await getRoundResult({
      token: 'token-value',
      roomCode: 'A/B',
      roundId: 'round id',
      signal: abortController.signal,
    })

    assert.equal(
      request.url,
      'http://localhost:8080/api/multiplayer/rooms/A%2FB/rounds/round%20id/result',
    )
    assert.equal(request.options.headers.Authorization, 'Bearer token-value')
    assert.equal(request.options.signal, abortController.signal)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetches the latest retained result', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async (url) => {
    requestedUrl = url
    return jsonResponse({ publicResult: {}, personalResult: {} })
  }

  try {
    await getLatestRoundResult({ token: 'token', roomCode: 'ABC123' })
    assert.equal(
      requestedUrl,
      'http://localhost:8080/api/multiplayer/rooms/ABC123/rounds/latest/result',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('validates all required arguments before requesting', () => {
  assert.throws(
    () => getRoundResult({ token: 'token', roomCode: '', roundId: 'round' }),
    /roomCode is required/,
  )
  assert.throws(
    () => getRoundResult({ token: 'token', roomCode: 'ROOM', roundId: '' }),
    /roundId is required/,
  )
  assert.throws(
    () => getLatestRoundResult({ token: '', roomCode: 'ROOM' }),
    /token is required/,
  )
})

test('preserves JSON error status and code without exposing HTML', async () => {
  const originalFetch = globalThis.fetch

  try {
    globalThis.fetch = async () => jsonResponse(
      { message: 'Only round participants can view this result', errorCode: 'FORBIDDEN' },
      { status: 403 },
    )
    await assert.rejects(
      getLatestRoundResult({ token: 'token', roomCode: 'ROOM' }),
      (error) => (
        error.status === 403 &&
        error.errorCode === 'FORBIDDEN' &&
        error.message === 'Only round participants can view this result'
      ),
    )

    globalThis.fetch = async () => new Response('<h1>Not Found</h1>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
    await assert.rejects(
      getLatestRoundResult({ token: 'token', roomCode: 'ROOM' }),
      (error) => (
        error.status === 404 &&
        error.message === 'Round result request failed (404)' &&
        !error.message.includes('<h1>')
      ),
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
