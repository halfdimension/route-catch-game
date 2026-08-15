import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { useCatchDetection } from '../src/hooks/useCatchDetection.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function CatchHarness({ options }) {
  useCatchDetection(options)
  return null
}

async function renderDetection(options) {
  let root
  await act(async () => {
    root = create(React.createElement(CatchHarness, { options }))
  })
  return {
    async update(nextOptions) {
      await act(async () => root.update(
        React.createElement(CatchHarness, { options: nextOptions }),
      ))
    },
    async unmount() {
      await act(async () => root.unmount())
    },
  }
}

function nearbyTarget() {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    lat: 28.5505,
    lon: 77.2688,
    expiresAt: Date.now() + 10_000,
  }
}

test('stationary detection catches a nearby target once', async () => {
  const caught = []
  const target = nearbyTarget()
  const options = {
    playerPosition: { lat: target.lat, lon: target.lon },
    targets: [target],
    enabled: true,
    isMoving: false,
    onCatchTarget: (entry) => caught.push(entry.id),
  }
  const rendered = await renderDetection(options)

  try {
    assert.deepEqual(caught, [target.id])
    await rendered.update({ ...options })
    assert.deepEqual(caught, [target.id])
  } finally {
    await rendered.unmount()
  }
})

test('moving positional samples do not compete with route-interval catches', async () => {
  const caught = []
  const target = nearbyTarget()
  const rendered = await renderDetection({
    playerPosition: { lat: target.lat, lon: target.lon },
    targets: [target],
    enabled: true,
    isMoving: true,
    onCatchTarget: (entry) => caught.push(entry.id),
  })

  try {
    assert.deepEqual(caught, [])
  } finally {
    await rendered.unmount()
  }
})
