import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  fromMapLibreLngLat,
  toMapLibreCoordinate,
  toMapLibreLngLat,
  toRouteGeoJson,
} from '../src/components/maplibre/mapLibreCoordinates.js'
import {
  createDestinationFromMapClick,
  getCreatureMarkerViewState,
  SAMPLE_CREATURES,
} from '../src/components/maplibre/mapLibrePrototypeState.js'
import {
  getRouteLayerConfigurations,
} from '../src/components/maplibre/mapLibreStyleConfig.js'
import {
  createFatalStyleState,
  createLoadedStyleState,
  createLoadingStyleState,
  isRouteEligible,
  MAP_STYLE_STATUS,
  transitionStyleStateForError,
} from '../src/components/maplibre/mapLibreStyleState.js'

test('{lat, lon} converts to MapLibre [longitude, latitude]', () => {
  assert.deepEqual(
    toMapLibreLngLat({ lat: 28.6139, lon: 77.209 }),
    [77.209, 28.6139],
  )
})

test('[lat, lon] converts to MapLibre [longitude, latitude]', () => {
  assert.deepEqual(
    toMapLibreCoordinate([28.6139, 77.209]),
    [77.209, 28.6139],
  )
})

test('MapLibre lngLat converts back to the application position contract', () => {
  assert.deepEqual(
    fromMapLibreLngLat({ lng: 77.209, lat: 28.6139 }),
    { lat: 28.6139, lon: 77.209 },
  )
})

test('route coordinates convert to a GeoJSON LineString', () => {
  assert.deepEqual(
    toRouteGeoJson([
      [28.6139, 77.209],
      [28.6145, 77.21],
    ]),
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [77.209, 28.6139],
          [77.21, 28.6145],
        ],
      },
    },
  )
})

test('invalid coordinates are handled safely', () => {
  assert.equal(toMapLibreLngLat({ lat: Number.NaN, lon: 77.209 }), null)
  assert.equal(toMapLibreCoordinate([91, 77.209]), null)
  assert.equal(fromMapLibreLngLat({ lng: 181, lat: 28.6139 }), null)
  assert.equal(
    toRouteGeoJson([
      [28.6139, 77.209],
      [Number.NaN, 77.21],
    ]),
    null,
  )
})

test('an empty or single-point route is not rendered as GeoJSON', () => {
  assert.equal(toRouteGeoJson([]), null)
  assert.equal(toRouteGeoJson([[28.6139, 77.209]]), null)
})

test('sample creature marker view state exposes rarity without chase state', () => {
  const creature = SAMPLE_CREATURES[1]
  const viewState = getCreatureMarkerViewState(creature, null, null)

  assert.equal(viewState.isSelected, false)
  assert.equal(viewState.isRouting, false)
  assert.match(viewState.className, /rarity-rare/)
  assert.equal(viewState.statusLabel, 'Rare')
})

test('selected creature marker view state exposes chase and routing state', () => {
  const creature = SAMPLE_CREATURES[2]
  const viewState = getCreatureMarkerViewState(
    creature,
    creature.id,
    creature.id,
  )

  assert.equal(viewState.isSelected, true)
  assert.equal(viewState.isRouting, true)
  assert.match(viewState.className, /is-selected/)
  assert.match(viewState.className, /is-routing/)
  assert.equal(viewState.statusLabel, 'Routing')
})

test('map click destinations preserve the {lat, lon} callback contract', () => {
  assert.deepEqual(
    createDestinationFromMapClick({ lng: 77.2132, lat: 28.6122 }),
    { lat: 28.6122, lon: 77.2132 },
  )
  assert.equal(createDestinationFromMapClick({ lng: '77.2', lat: 28.6 }), null)
})

test('route layer configuration is stable and preserves halo/core ordering', () => {
  const chaseConfiguration = getRouteLayerConfigurations(true)

  assert.equal(
    chaseConfiguration,
    getRouteLayerConfigurations(true),
    'configuration should retain stable object identity',
  )
  assert.equal(chaseConfiguration.halo.id, 'prototype-route-halo')
  assert.equal(chaseConfiguration.core.id, 'prototype-route-core')
  assert.equal(chaseConfiguration.halo.layout['line-cap'], 'round')
  assert.ok(
    chaseConfiguration.halo.paint['line-width'] >
      chaseConfiguration.core.paint['line-width'],
  )
  assert.ok(
    chaseConfiguration.core.paint['line-width'] >
      getRouteLayerConfigurations(false).core.paint['line-width'],
  )
})

test('both maps rely on the supported built-in MapLibre worker', () => {
  const prototypeMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibrePrototypeMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const unsupportedReferences = [
    ['mapLibre', 'RuntimeConfig'].join(''),
    ['mapLibre', 'WorkerUrl'].join(''),
    ['maplibre-gl-worker', '.mjs'].join(''),
    ['.vite/deps/', 'maplibre-gl-worker', '.mjs'].join(''),
  ]
  const explicitWorkerProperty = ['worker', 'Url'].join('')

  for (const mapSource of [prototypeMapSource, soloMapSource]) {
    for (const unsupportedReference of unsupportedReferences) {
      assert.equal(mapSource.includes(unsupportedReference), false)
    }

    assert.equal(
      new RegExp(`\\b${explicitWorkerProperty}\\s*=`).test(mapSource),
      false,
    )
  }
})

test('MapLibre v5 is pinned once and accepted by the React wrapper', () => {
  const projectPackage = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const packageLock = JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
  )
  const mapLibrePackage = JSON.parse(
    readFileSync(
      new URL('../node_modules/maplibre-gl/package.json', import.meta.url),
      'utf8',
    ),
  )
  const reactMapLibrePackage = JSON.parse(
    readFileSync(
      new URL(
        '../node_modules/@vis.gl/react-maplibre/package.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const mapLibreLockEntries = Object.entries(packageLock.packages).filter(
    ([packagePath]) => packagePath.endsWith('node_modules/maplibre-gl'),
  )
  const wrapperPeerRange =
    reactMapLibrePackage.peerDependencies['maplibre-gl']
  const minimumPeerMajor = Number(
    wrapperPeerRange.match(/\d+/)?.[0],
  )
  const installedMapLibreMajor = Number(mapLibrePackage.version.split('.')[0])

  assert.equal(projectPackage.dependencies['maplibre-gl'], '5.24.0')
  assert.equal(mapLibrePackage.version, '5.24.0')
  assert.equal(
    projectPackage.dependencies['@vis.gl/react-maplibre'],
    '^8.1.1',
  )
  assert.equal(reactMapLibrePackage.version, '8.1.1')
  assert.equal(
    wrapperPeerRange,
    '>=4.0.0',
  )
  assert.ok(installedMapLibreMajor >= minimumPeerMajor)

  assert.equal(
    packageLock.packages[''].dependencies['maplibre-gl'],
    '5.24.0',
  )
  assert.equal(
    packageLock.packages['node_modules/maplibre-gl'].version,
    '5.24.0',
  )
  assert.deepEqual(
    mapLibreLockEntries.map(([packagePath, packageMetadata]) => ({
      packagePath,
      version: packageMetadata.version,
    })),
    [{ packagePath: 'node_modules/maplibre-gl', version: '5.24.0' }],
  )
})

test('style state starts with an accurate loading label', () => {
  assert.deepEqual(createLoadingStyleState(), {
    status: MAP_STYLE_STATUS.LOADING,
    label: 'Loading style',
    errorMessage: '',
  })
})

test('style-loaded transitions report building compatibility accurately', () => {
  assert.deepEqual(createLoadedStyleState(true), {
    status: MAP_STYLE_STATUS.LOADED,
    label: 'Style loaded',
    errorMessage: '',
  })
  assert.deepEqual(createLoadedStyleState(false), {
    status: MAP_STYLE_STATUS.LOADED_WITHOUT_BUILDINGS,
    label: 'Style loaded without compatible 3D buildings',
    errorMessage: '',
  })
})

test('fatal initialization errors replace the loading style state', () => {
  const error = new Error('Failed to initialize Web Worker')
  const fatalState = transitionStyleStateForError(
    createLoadingStyleState(),
    error,
  )

  assert.deepEqual(fatalState, createFatalStyleState(error))
  assert.equal(fatalState.status, MAP_STYLE_STATUS.FATAL)
  assert.equal(fatalState.label, 'Fatal map/worker initialization error')
})

test('worker failures remain fatal even after an earlier style transition', () => {
  const error = new Error('Web Worker initialization failed')
  const fatalState = transitionStyleStateForError(
    createLoadedStyleState(true),
    error,
  )

  assert.equal(fatalState.status, MAP_STYLE_STATUS.FATAL)
  assert.equal(fatalState.errorMessage, error.message)
})

test('routes become eligible only after style load with two coordinates', () => {
  const routeCoordinates = [
    [28.6139, 77.209],
    [28.6145, 77.21],
  ]

  assert.equal(
    isRouteEligible(createLoadingStyleState(), routeCoordinates),
    false,
  )
  assert.equal(
    isRouteEligible(createLoadedStyleState(true), routeCoordinates),
    true,
  )
  assert.equal(
    isRouteEligible(createLoadedStyleState(false), routeCoordinates),
    true,
  )
  assert.equal(isRouteEligible(createLoadedStyleState(true), []), false)
})
