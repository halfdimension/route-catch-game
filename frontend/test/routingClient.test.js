import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchNearestRoadPoint,
  fetchRoute,
} from '../src/api/routingClient.js'
import { TRAVEL_MODES } from '../src/config/travelMode.js'

const SOURCE = Object.freeze({ lat: 28.55, lon: 77.26 })
const DESTINATION = Object.freeze({ lat: 28.57, lon: 77.29 })

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body
    },
  }
}

for (const travelMode of Object.values(TRAVEL_MODES)) {
  test(`route client sends exact ${travelMode} domain value`, async () => {
    const originalFetch = globalThis.fetch
    let request
    globalThis.fetch = async (url, options) => {
      request = { url, options }
      return jsonResponse({
        coordinates: [SOURCE, DESTINATION],
        distanceMeters: 3000,
        durationSeconds: 180,
      })
    }

    try {
      await fetchRoute(SOURCE, DESTINATION, { travelMode })
      assert.match(request.url, /\/api\/routes$/)
      assert.equal(request.options.travelMode, undefined)
      assert.deepEqual(JSON.parse(request.options.body), {
        sourceLat: SOURCE.lat,
        sourceLon: SOURCE.lon,
        destinationLat: DESTINATION.lat,
        destinationLon: DESTINATION.lon,
        travelMode,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test(`nearest client sends exact ${travelMode} domain value`, async () => {
    const originalFetch = globalThis.fetch
    let request
    globalThis.fetch = async (url, options) => {
      request = { url, options }
      return jsonResponse({ snappedPoint: DESTINATION })
    }

    try {
      await fetchNearestRoadPoint(SOURCE, { travelMode })
      assert.match(request.url, /\/api\/nearest$/)
      assert.equal(request.options.travelMode, undefined)
      assert.deepEqual(JSON.parse(request.options.body), {
        lat: SOURCE.lat,
        lon: SOURCE.lon,
        travelMode,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
}

test('routing client preserves optional omitted mode for non-SOLO callers', async () => {
  const originalFetch = globalThis.fetch
  const payloads = []
  globalThis.fetch = async (url, options) => {
    payloads.push(JSON.parse(options.body))
    return url.endsWith('/api/routes')
      ? jsonResponse({ coordinates: [SOURCE, DESTINATION] })
      : jsonResponse({ snappedPoint: DESTINATION })
  }

  try {
    await fetchRoute(SOURCE, DESTINATION)
    await fetchNearestRoadPoint(SOURCE)
    assert.deepEqual(payloads, [
      {
        sourceLat: SOURCE.lat,
        sourceLon: SOURCE.lon,
        destinationLat: DESTINATION.lat,
        destinationLon: DESTINATION.lon,
      },
      { lat: SOURCE.lat, lon: SOURCE.lon },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
