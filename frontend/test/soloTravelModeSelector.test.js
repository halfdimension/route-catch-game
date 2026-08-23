import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { createServer } from 'vite'
import {
  DEFAULT_TRAVEL_MODE,
  SOLO_TRAVEL_MODE_OPTIONS,
  TRAVEL_MODES,
} from '../src/config/travelMode.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const leafletSessionSource = readFileSync(
  new URL('../src/components/GameSessionPanel.jsx', import.meta.url),
  'utf8',
)
const mapLibreSessionSource = readFileSync(
  new URL(
    '../src/components/maplibre/MapLibreSessionControls.jsx',
    import.meta.url,
  ),
  'utf8',
)

test('selector domain exposes exactly Car, Motorcycle, and Walking with CAR default', () => {
  assert.equal(DEFAULT_TRAVEL_MODE, TRAVEL_MODES.CAR)
  assert.deepEqual(SOLO_TRAVEL_MODE_OPTIONS, [
    { label: 'Car', value: TRAVEL_MODES.CAR },
    { label: 'Motorcycle', value: TRAVEL_MODES.MOTORCYCLE },
    { label: 'Walking', value: TRAVEL_MODES.WALKING },
  ])
  assert.equal(Object.isFrozen(SOLO_TRAVEL_MODE_OPTIONS), true)
  assert.equal(
    SOLO_TRAVEL_MODE_OPTIONS.every((option) => Object.isFrozen(option)),
    true,
  )
})

test('rendered selector supports editing, locking, and re-selection', async (context) => {
  const server = await createServer({
    root: frontendRoot,
    logLevel: 'silent',
    server: { middlewareMode: true },
  })
  context.after(() => server.close())
  const { default: TravelModeSelector } = await server.ssrLoadModule(
    '/src/components/TravelModeSelector.jsx',
  )
  const selections = []
  const onSelectedTravelModeChange = (travelMode) => {
    selections.push(travelMode)
  }
  const selector = (selectedTravelMode, disabled) => React.createElement(
    TravelModeSelector,
    {
      selectedTravelMode,
      activeTravelMode: null,
      onSelectedTravelModeChange,
      disabled,
    },
  )
  let root

  const renderedState = () => {
    const fieldset = root.root.findByType('fieldset')
    const radios = Object.fromEntries(
      root.root.findAllByType('input').map((input) => [
        input.props.value,
        input,
      ]),
    )
    return { fieldset, radios }
  }
  const assertChecked = (expectedTravelMode) => {
    const { radios } = renderedState()
    for (const travelMode of Object.values(TRAVEL_MODES)) {
      assert.equal(
        radios[travelMode].props.checked,
        travelMode === expectedTravelMode,
      )
    }
  }

  try {
    await act(async () => {
      root = create(selector(TRAVEL_MODES.CAR, false))
    })
    assert.equal(
      root.root.findByType('legend').children.join(''),
      'Travel mode',
    )
    assert.deepEqual(
      root.root.findAllByType('span').map((span) => span.children.join('')),
      ['Car', 'Motorcycle', 'Walking'],
    )
    assert.equal(renderedState().fieldset.props.disabled, false)
    assert.ok(
      Object.values(renderedState().radios).every(
        (radio) => radio.props.disabled === false,
      ),
    )
    assertChecked(TRAVEL_MODES.CAR)

    await act(async () => {
      renderedState().radios[TRAVEL_MODES.MOTORCYCLE].props.onChange()
    })
    assert.deepEqual(selections, [TRAVEL_MODES.MOTORCYCLE])
    assertChecked(TRAVEL_MODES.CAR)

    await act(async () => {
      root.update(selector(TRAVEL_MODES.MOTORCYCLE, false))
    })
    assertChecked(TRAVEL_MODES.MOTORCYCLE)

    await act(async () => {
      renderedState().radios[TRAVEL_MODES.WALKING].props.onChange()
    })
    assert.deepEqual(selections, [
      TRAVEL_MODES.MOTORCYCLE,
      TRAVEL_MODES.WALKING,
    ])
    await act(async () => {
      root.update(selector(TRAVEL_MODES.WALKING, false))
    })
    assertChecked(TRAVEL_MODES.WALKING)

    await act(async () => {
      root.update(selector(TRAVEL_MODES.WALKING, true))
    })
    assert.equal(renderedState().fieldset.props.disabled, true)
    assert.ok(
      Object.values(renderedState().radios).every(
        (radio) => radio.props.disabled === true,
      ),
    )
    assertChecked(TRAVEL_MODES.WALKING)
    await act(async () => {
      renderedState().radios[TRAVEL_MODES.MOTORCYCLE].props.onChange()
    })
    assert.deepEqual(selections, [
      TRAVEL_MODES.MOTORCYCLE,
      TRAVEL_MODES.WALKING,
    ])

    await act(async () => {
      root.update(selector(TRAVEL_MODES.WALKING, false))
    })
    assert.equal(renderedState().fieldset.props.disabled, false)
    await act(async () => {
      renderedState().radios[TRAVEL_MODES.MOTORCYCLE].props.onChange()
    })
    assert.deepEqual(selections, [
      TRAVEL_MODES.MOTORCYCLE,
      TRAVEL_MODES.WALKING,
      TRAVEL_MODES.MOTORCYCLE,
    ])
    await act(async () => {
      root.update(selector(TRAVEL_MODES.MOTORCYCLE, false))
    })
    assertChecked(TRAVEL_MODES.MOTORCYCLE)
  } finally {
    if (root) {
      await act(async () => root.unmount())
    }
  }
})

test('Leaflet and MapLibre setup surfaces use the same selector authority', () => {
  for (const source of [leafletSessionSource, mapLibreSessionSource]) {
    assert.match(source, /<TravelModeSelector/)
    assert.match(source, /selectedTravelMode=/)
    assert.match(source, /activeTravelMode=/)
    assert.match(source, /onSelectedTravelModeChange=/)
    assert.match(source, /isSessionPending/)
  }
})
