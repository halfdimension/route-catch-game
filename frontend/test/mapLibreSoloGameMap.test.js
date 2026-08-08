import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  toRouteGeoJson,
} from '../src/components/maplibre/mapLibreCoordinates.js'
import {
  createSoloDestinationFromMapClick,
  createSoloDestinationFromMapEvent,
  createSoloFollowCameraOptions,
  createSoloInitialViewState,
  createSoloOverviewBounds,
  getCaughtTargetEffectViewState,
  getShortestSoloCameraBearingDelta,
  getSoloReducedMotionCameraPolicy,
  getSoloRouteDestination,
  getSoloDestinationMarkerViewState,
  getSoloPlayerMarkerViewState,
  getSoloTargetMarkerViewState,
  handleSoloTargetMarkerClick,
  isSoloCameraUserInteraction,
  recenterSoloMap,
  smoothSoloCameraBearing,
  SOLO_CAMERA_EVENTS,
  SOLO_CAMERA_MODES,
  SOLO_CAMERA_PROGRAMMATIC_EVENT,
  SOLO_MAP_INTERACTION_PROPS,
  SOLO_TARGET_ANIMATION_CLASS_NAMES,
  transitionSoloCameraMode,
} from '../src/components/maplibre/mapLibreSoloGameState.js'
import {
  getNonChasedMapLibreTargets,
  getMapLibreRoundViewState,
  getMapLibreTargetViewState,
  handleMapLibreHudCancelChase,
  handleMapLibreHudTargetClick,
  resolveMapLibreDebugControlsEnabled,
  stopMapLibreHudEvent,
} from '../src/components/maplibre/mapLibreGameHudState.js'
import {
  createBuildingExtrusionLayer,
  getRouteLayerConfigurations,
} from '../src/components/maplibre/mapLibreStyleConfig.js'
import {
  createLoadedStyleState,
  isRouteEligible,
} from '../src/components/maplibre/mapLibreStyleState.js'
import {
  resolveSoloMapRenderer,
  getSoloRouteAnimationStartDelay,
  MAPLIBRE_SOLO_ROUTE_PRELUDE_MS,
  SOLO_MAP_RENDERER,
  SOLO_MAP_RENDERERS,
} from '../src/config/soloMapRenderer.js'
import {
  INITIAL_MAP_CENTER,
  INITIAL_MAP_ZOOM,
} from '../src/config/mapConfig.js'

const NOW = 1_800_000_000_000

const REAL_TARGET = Object.freeze({
  id: 'target-42',
  name: 'Azure Jackal',
  rarity: 'Rare',
  symbol: 'J',
  color: '#2563eb',
  score: 30,
  difficulty: 'Medium',
  expiresAt: NOW + 12_400,
  lat: 28.6107,
  lon: 77.2057,
})

test('solo renderer defaults to Leaflet when the setting is absent', () => {
  assert.equal(SOLO_MAP_RENDERER, SOLO_MAP_RENDERERS.LEAFLET)
  assert.equal(
    resolveSoloMapRenderer(undefined),
    SOLO_MAP_RENDERERS.LEAFLET,
  )
})

test('an explicit leaflet setting selects Leaflet', () => {
  assert.equal(
    resolveSoloMapRenderer('leaflet'),
    SOLO_MAP_RENDERERS.LEAFLET,
  )
})

test('an explicit maplibre setting selects MapLibre', () => {
  assert.equal(
    resolveSoloMapRenderer('maplibre'),
    SOLO_MAP_RENDERERS.MAPLIBRE,
  )
})

test('empty and invalid solo renderer settings safely select Leaflet', () => {
  assert.equal(resolveSoloMapRenderer(''), SOLO_MAP_RENDERERS.LEAFLET)
  assert.equal(
    resolveSoloMapRenderer('openlayers'),
    SOLO_MAP_RENDERERS.LEAFLET,
  )
  assert.equal(
    resolveSoloMapRenderer('MAPLIBRE'),
    SOLO_MAP_RENDERERS.LEAFLET,
  )
})

test('the real player position uses the shared MapLibre coordinate boundary', () => {
  assert.deepEqual(
    getSoloPlayerMarkerViewState(
      { lat: 28.6139, lon: 77.209 },
      'Delhi Ranger',
    ),
    {
      mapPosition: [77.209, 28.6139],
      displayName: 'Delhi Ranger',
      initial: 'D',
      avatarUrl: '',
      title: 'Delhi Ranger, local player',
    },
  )
  assert.equal(
    getSoloPlayerMarkerViewState({ lat: 95, lon: 77.209 }, 'Ranger'),
    null,
  )
})

test('the pending destination uses the same coordinate boundary', () => {
  assert.deepEqual(
    getSoloDestinationMarkerViewState({
      lat: 28.6122,
      lon: 77.2132,
    }),
    {
      mapPosition: [77.2132, 28.6122],
      title: 'Pending destination',
    },
  )
  assert.equal(getSoloDestinationMarkerViewState(null), null)
})

test('initial camera center uses the first valid real player position', () => {
  assert.deepEqual(
    createSoloInitialViewState({ lat: 19.076, lon: 72.8777 }),
    {
      longitude: 72.8777,
      latitude: 19.076,
      zoom: INITIAL_MAP_ZOOM,
      pitch: 40,
      bearing: 0,
    },
  )
})

test('invalid player position falls back to INITIAL_MAP_CENTER', () => {
  const initialViewState = createSoloInitialViewState({
    lat: Number.NaN,
    lon: 72.8777,
  })

  assert.equal(initialViewState.longitude, INITIAL_MAP_CENTER[1])
  assert.equal(initialViewState.latitude, INITIAL_MAP_CENTER[0])
})

test('camera initialization remains stable after player position changes', () => {
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(
    soloMapSource,
    /useState\(\(\) =>\s*createSoloInitialViewState\(playerPosition\)/,
  )
  assert.doesNotMatch(soloMapSource, /setInitialViewState/)
  assert.match(
    soloMapSource,
    /playerPositionRef\.current = playerPosition/,
  )
  assert.match(
    soloMapSource,
    /recenterSoloMap\(mapRef\.current, playerPositionRef\.current\)/,
  )
})

test('free camera interaction settings keep every required handler enabled', () => {
  assert.deepEqual(SOLO_MAP_INTERACTION_PROPS, {
    interactive: true,
    cooperativeGestures: false,
    boxZoom: true,
    doubleClickZoom: true,
    dragPan: true,
    dragRotate: true,
    keyboard: true,
    pitchWithRotate: true,
    scrollZoom: true,
    touchPitch: true,
    touchZoomRotate: true,
  })
})

test('solo map uses uncontrolled initialViewState without recycled camera state', () => {
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(soloMapSource, /initialViewState=\{initialViewState\}/)
  assert.doesNotMatch(soloMapSource, /\bviewState=/)
  assert.doesNotMatch(soloMapSource, /\breuseMaps\b/)
  assert.doesNotMatch(soloMapSource, /\bkey=/)
})

test('recenter uses the latest player position and preserves usable zoom', () => {
  const cameraUpdates = []
  const map = {
    getZoom() {
      return 14
    },
    easeTo(nextCamera) {
      cameraUpdates.push(nextCamera)
    },
  }

  assert.equal(
    recenterSoloMap(map, { lat: 19.082, lon: 72.891 }),
    true,
  )
  assert.deepEqual(cameraUpdates[0].center, [72.891, 19.082])
  assert.equal(cameraUpdates[0].zoom, 14)
  assert.equal(cameraUpdates[0].essential, false)
  assert.equal(recenterSoloMap(map, { lat: 100, lon: 72.891 }), false)
  assert.equal(cameraUpdates.length, 1)
})

test('recenter raises an unusably low zoom to the initial game zoom', () => {
  let cameraUpdate
  const map = {
    getZoom() {
      return 4
    },
    easeTo(nextCamera) {
      cameraUpdate = nextCamera
    },
  }

  recenterSoloMap(map, { lat: 19.082, lon: 72.891 })

  assert.equal(cameraUpdate.zoom, INITIAL_MAP_ZOOM)
})

test('the real target marker view model preserves production display data', () => {
  const viewState = getSoloTargetMarkerViewState(
    REAL_TARGET,
    null,
    null,
    NOW,
  )

  assert.deepEqual(viewState.mapPosition, [77.2057, 28.6107])
  assert.equal(viewState.name, REAL_TARGET.name)
  assert.equal(viewState.rarityLabel, 'Rare')
  assert.equal(viewState.score, 30)
  assert.equal(viewState.remainingSeconds, 13)
  assert.equal(viewState.difficultyLabel, 'Medium')
  assert.match(viewState.className, /rarity-rare/)
  assert.match(viewState.ariaLabel, /13 seconds remaining/)
})

test('the chased target state is represented without changing target data', () => {
  const viewState = getSoloTargetMarkerViewState(
    REAL_TARGET,
    REAL_TARGET.id,
    null,
    NOW,
  )

  assert.equal(viewState.isChased, true)
  assert.equal(viewState.isRouting, false)
  assert.equal(viewState.difficultyLabel, 'Chasing')
  assert.match(viewState.className, /is-chased/)
  assert.doesNotMatch(viewState.className, /is-routing/)
})

test('the routing target state adds routing status and pulse state', () => {
  const viewState = getSoloTargetMarkerViewState(
    REAL_TARGET,
    null,
    REAL_TARGET.id,
    NOW,
  )

  assert.equal(viewState.isChased, false)
  assert.equal(viewState.isRouting, true)
  assert.equal(viewState.difficultyLabel, 'Routing')
  assert.match(viewState.className, /is-routing/)
})

test('a target click invokes the target callback exactly once', () => {
  let targetClickCount = 0

  handleSoloTargetMarkerClick(
    { stopPropagation() {} },
    REAL_TARGET,
    (clickedTarget) => {
      targetClickCount += 1
      assert.equal(clickedTarget, REAL_TARGET)
    },
  )

  assert.equal(targetClickCount, 1)
})

test('a target click stops propagation before a map click can run', () => {
  let propagationStopped = false
  let mapClickCount = 0

  handleSoloTargetMarkerClick(
    {
      stopPropagation() {
        propagationStopped = true
      },
    },
    REAL_TARGET,
    () => {},
  )

  if (!propagationStopped) {
    mapClickCount += 1
  }

  assert.equal(propagationStopped, true)
  assert.equal(mapClickCount, 0)
})

test('a valid two-point route creates the solo halo and core layers', () => {
  const route = toRouteGeoJson([
    [28.6139, 77.209],
    [28.6145, 77.21],
  ])
  const layers = getRouteLayerConfigurations(false, 'solo-route')

  assert.equal(route.geometry.coordinates.length, 2)
  assert.equal(layers.halo.id, 'solo-route-halo')
  assert.equal(layers.core.id, 'solo-route-core')
  assert.equal(layers.halo.layout['line-cap'], 'round')
  assert.equal(layers.core.layout['line-join'], 'round')
  assert.ok(
    layers.halo.paint['line-width'] > layers.core.paint['line-width'],
  )
})

test('3D buildings retain depth without overpowering navigation overlays', () => {
  const layer = createBuildingExtrusionLayer({
    source: 'openmaptiles',
    sourceLayer: 'building',
  })

  assert.equal(layer.type, 'fill-extrusion')
  assert.equal(layer.paint['fill-extrusion-opacity'], 0.34)
  assert.ok(layer.paint['fill-extrusion-opacity'] > 0)
})

test('empty, short, and invalid route data clears the route view', () => {
  assert.equal(toRouteGeoJson([]), null)
  assert.equal(toRouteGeoJson([[28.6139, 77.209]]), null)
  assert.equal(
    toRouteGeoJson([
      [28.6139, 77.209],
      [Number.NaN, 77.21],
    ]),
    null,
  )
})

test('the caught-target effect is visual-only and rejects invalid positions', () => {
  assert.deepEqual(
    getCaughtTargetEffectViewState(REAL_TARGET),
    {
      mapPosition: [77.2057, 28.6107],
      score: 30,
      className: 'maplibre-solo-catch-effect rarity-rare',
    },
  )
  assert.equal(getCaughtTargetEffectViewState(null), null)
  assert.equal(
    getCaughtTargetEffectViewState({
      ...REAL_TARGET,
      lat: Number.NaN,
    }),
    null,
  )
})

test('MapLibre map clicks return the application {lat, lon} contract', () => {
  assert.deepEqual(
    createSoloDestinationFromMapClick({
      lng: 77.2132,
      lat: 28.6122,
    }),
    { lat: 28.6122, lon: 77.2132 },
  )
  assert.equal(
    createSoloDestinationFromMapClick({ lng: 190, lat: 28.6122 }),
    null,
  )
})

test('a drag interaction cannot produce a map-click destination', () => {
  assert.equal(
    createSoloDestinationFromMapEvent({
      type: 'drag',
      lngLat: { lng: 77.2132, lat: 28.6122 },
    }),
    null,
  )
  assert.deepEqual(
    createSoloDestinationFromMapEvent({
      type: 'click',
      lngLat: { lng: 77.2132, lat: 28.6122 },
    }),
    { lat: 28.6122, lon: 77.2132 },
  )
})

test('solo map relies on MapLibre responsive behavior without a duplicate resize path', () => {
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const soloStateSource = readFileSync(
    new URL(
      '../src/components/maplibre/mapLibreSoloGameState.js',
      import.meta.url,
    ),
    'utf8',
  )
  const removedResizeHelper = ['observe', 'SoloMap', 'Resize'].join('')

  for (const source of [soloMapSource, soloStateSource]) {
    assert.equal(source.includes(removedResizeHelper), false)
    assert.doesNotMatch(source, /\bResizeObserver\b/)
    assert.doesNotMatch(source, /\.resize\s*\(/)
  }
})

test('valid moving routes stay eligible above the basemap and below markers', () => {
  const routeCoordinates = [
    [19.076, 72.8777],
    [19.078, 72.882],
  ]
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const routeLayerSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreRouteLayer.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const basemapIndex = soloMapSource.indexOf('mapStyle=')
  const routeIndex = soloMapSource.indexOf('<MapLibreRouteLayer')
  const markersIndex = soloMapSource.indexOf('<MapLibreSoloGameMarkers')
  const haloIndex = routeLayerSource.indexOf('layerConfigurations.halo')
  const coreIndex = routeLayerSource.indexOf('layerConfigurations.core')

  assert.equal(
    isRouteEligible(createLoadedStyleState(true), routeCoordinates),
    true,
  )
  assert.ok(basemapIndex >= 0)
  assert.ok(basemapIndex < routeIndex)
  assert.ok(routeIndex < markersIndex)
  assert.ok(haloIndex < coreIndex)
})

test('solo route coordinates remain display-only map input', () => {
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(soloMapSource, /coordinates=\{routeCoordinates\}/)
  assert.doesNotMatch(soloMapSource, /fetchRoute/)
  assert.doesNotMatch(soloMapSource, /osrmClient/)
})

test('successful map load clears the loading notice without manual resizing', () => {
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const loadedTransitions =
    soloMapSource.match(/setStyleState\(createLoadedStyleState\(/g) || []

  assert.equal(loadedTransitions.length, 3)
  assert.match(soloMapSource, /styleState\.status === 'loading'/)
  assert.doesNotMatch(soloMapSource, /\.resize\s*\(/)
})

test('SoloPlayPage lazy-loads MapLibre without changing the GameMap contract', () => {
  const soloPageSource = readFileSync(
    new URL('../src/pages/SoloPlayPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(soloPageSource, /lazy\(/)
  assert.match(soloPageSource, /MapLibreSoloGameMap/)
  assert.match(soloPageSource, /<GameMap/)
  assert.match(soloPageSource, /\{\.\.\.soloMapProps\}/)
})

test('multiplayer RoomPlayPage remains on the Leaflet GameMap', () => {
  const roomPageSource = readFileSync(
    new URL('../src/pages/RoomPlayPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(roomPageSource, /import GameMap from/)
  assert.match(roomPageSource, /<GameMap/)
  assert.doesNotMatch(roomPageSource, /MapLibre/)
})

test('MapLibre experience shell activates without changing the Leaflet default', () => {
  const soloPageSource = readFileSync(
    new URL('../src/pages/SoloPlayPage.jsx', import.meta.url),
    'utf8',
  )

  assert.equal(SOLO_MAP_RENDERER, SOLO_MAP_RENDERERS.LEAFLET)
  assert.match(soloPageSource, /isMapLibreExperience/)
  assert.match(soloPageSource, /is-maplibre-experience/)
  assert.match(soloPageSource, /<MapLibreGameHud gameplay=\{gameplay\}/)
  assert.match(soloPageSource, /isMapLibreExperience \? \(/)
  assert.match(soloPageSource, /<MovementStatusPanel/)
  assert.match(soloPageSource, /<TargetInfoPanel/)
})

test('round HUD exposes player-facing timer, score state, and warning state', () => {
  assert.deepEqual(
    getMapLibreRoundViewState({
      gameState: 'running',
      remainingSeconds: 9,
      selectedRoundSeconds: 120,
    }),
    {
      timeLabel: '00:09',
      stateLabel: 'Round live',
      isWarning: true,
    },
  )
  assert.equal(
    getMapLibreRoundViewState({
      gameState: 'ready',
      remainingSeconds: 0,
      selectedRoundSeconds: 125,
    }).timeLabel,
    '02:05',
  )
})

test('target HUD view state preserves rarity, score data, and chase state', () => {
  const viewState = getMapLibreTargetViewState(
    REAL_TARGET,
    REAL_TARGET.id,
    null,
    NOW,
  )

  assert.equal(viewState.rarityClassName, 'rarity-rare')
  assert.equal(viewState.remainingSeconds, 13)
  assert.equal(viewState.isChased, true)
  assert.equal(viewState.isRouting, false)
  assert.equal(viewState.statusLabel, 'Chasing')
  assert.equal(REAL_TARGET.score, 30)
})

test('HUD interactions stop at the shell and target callbacks run once', () => {
  let propagationStops = 0
  let targetClicks = 0
  const event = {
    stopPropagation() {
      propagationStops += 1
    },
  }

  stopMapLibreHudEvent(event)
  handleMapLibreHudTargetClick(event, REAL_TARGET, (target) => {
    targetClicks += 1
    assert.equal(target, REAL_TARGET)
  })

  assert.equal(propagationStops, 2)
  assert.equal(targetClicks, 1)
})

test('target collapse remains local presentation state and keeps target props mounted', () => {
  const targetPanelSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreTargetPanel.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(targetPanelSource, /useState\(false\)/)
  assert.match(targetPanelSource, /aria-expanded=\{!isCollapsed\}/)
  assert.match(targetPanelSource, /remainingTargets\.map/)
  assert.doesNotMatch(targetPanelSource, /setTargets/)
  assert.doesNotMatch(targetPanelSource, /useEffect/)
})

test('destination sheet delegates Confirm and Cancel to existing callbacks', () => {
  const destinationSheetSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreDestinationSheet.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const gameHudSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreGameHud.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(destinationSheetSource, /onClick=\{onConfirm\}/)
  assert.match(destinationSheetSource, /onClick=\{onCancel\}/)
  assert.match(destinationSheetSource, /'Confirm'/)
  assert.match(destinationSheetSource, />\s*Cancel\s*</)
  assert.match(gameHudSource, /gameplay\.handleConfirmPendingMove/)
  assert.match(gameHudSource, /gameplay\.clearPendingDestination/)
})

test('HUD remains presentational and MapLibre controls remain usable', () => {
  const hudSources = [
    'MapLibreGameHud.jsx',
    'MapLibreTargetPanel.jsx',
    'MapLibreDestinationSheet.jsx',
    'MapLibreRecentCatchesDrawer.jsx',
    'MapLibreSessionControls.jsx',
    'MapLibreDevelopmentControls.jsx',
  ].map((fileName) =>
    readFileSync(
      new URL(`../src/components/maplibre/${fileName}`, import.meta.url),
      'utf8',
    ),
  )
  const soloMapSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMap.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  for (const hudSource of hudSources) {
    assert.doesNotMatch(hudSource, /fetch\s*\(/)
    assert.doesNotMatch(hudSource, /osrmClient/)
    assert.doesNotMatch(hudSource, /gameSessionClient/)
  }

  assert.match(soloMapSource, /<NavigationControl/)
  assert.match(soloMapSource, /maplibre-solo-recenter-control/)
  assert.doesNotMatch(soloMapSource, /\bviewState=/)
  assert.doesNotMatch(soloMapSource, /\bResizeObserver\b/)
  assert.doesNotMatch(soloMapSource, /\.resize\s*\(/)
  assert.doesNotMatch(soloMapSource, /\bworkerUrl\b/)
})

test('Recent Catches is relocated away from the map-control corner', () => {
  const gameHudSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreGameHud.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const recentCatchesSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreRecentCatchesDrawer.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(gameHudSource, /maplibre-left-rail/)
  assert.match(gameHudSource, /<MapLibreRecentCatchesDrawer/)
  assert.doesNotMatch(gameHudSource, /maplibre-hud-inventory/)
  assert.doesNotMatch(recentCatchesSource, /bottom-right/)
})

test('recent-catches open and close state never copies or mutates catch data', () => {
  const gameHudSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreGameHud.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const recentCatchesSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreRecentCatchesDrawer.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(gameHudSource, /useState\(false\)/)
  assert.match(gameHudSource, /caughtTargets=\{gameplay\.caughtTargets\}/)
  assert.match(recentCatchesSource, /caughtTargets\.slice\(0, 3\)/)
  assert.doesNotMatch(gameHudSource, /setCaughtTargets/)
  assert.doesNotMatch(recentCatchesSource, /setCaughtTargets/)
})

test('the chased target is pinned once and remaining targets stay listed', () => {
  const secondTarget = { ...REAL_TARGET, id: 'target-43', name: 'Roadling' }
  const targets = [REAL_TARGET, secondTarget]

  assert.deepEqual(
    getNonChasedMapLibreTargets(targets, REAL_TARGET.id),
    [secondTarget],
  )
  assert.deepEqual(getNonChasedMapLibreTargets(targets, null), targets)
})

test('Cancel Chase stops HUD propagation and invokes its callback once', () => {
  let propagationStops = 0
  let cancelCalls = 0

  handleMapLibreHudCancelChase(
    {
      stopPropagation() {
        propagationStops += 1
      },
    },
    () => {
      cancelCalls += 1
    },
  )

  assert.equal(propagationStops, 1)
  assert.equal(cancelCalls, 1)
})

test('MapLibre development controls require the explicit environment flag', () => {
  assert.equal(resolveMapLibreDebugControlsEnabled(undefined), false)
  assert.equal(resolveMapLibreDebugControlsEnabled('false'), false)
  assert.equal(resolveMapLibreDebugControlsEnabled('TRUE'), true)
  assert.equal(resolveMapLibreDebugControlsEnabled(' true '), true)

  const environmentExample = readFileSync(
    new URL('../.env.example', import.meta.url),
    'utf8',
  )
  assert.match(environmentExample, /VITE_ENABLE_DEBUG_CONTROLS=false/)
})

test('normal MapLibre session controls hide API diagnostics and retain End round', () => {
  const gameHudSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreGameHud.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const sessionControlsSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSessionControls.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const developmentControlsSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreDevelopmentControls.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.doesNotMatch(sessionControlsSource, /backendSession/)
  assert.doesNotMatch(sessionControlsSource, /backendScore/)
  assert.doesNotMatch(sessionControlsSource, /API session/)
  assert.match(sessionControlsSource, /gameplay\.handleEndGame/)
  assert.match(sessionControlsSource, /End round/)
  assert.match(
    gameHudSource,
    /MAPLIBRE_DEBUG_CONTROLS_ENABLED &&/,
  )
  assert.match(developmentControlsSource, /Technical session status/)
  assert.doesNotMatch(developmentControlsSource, /controls-overlay/)
  for (const callbackName of [
    'toggleSpawning',
    'clearTargets',
    'resetScore',
    'resetPlayer',
    'resetGame',
    'setSimulationSpeed',
  ]) {
    assert.match(developmentControlsSource, new RegExp(`gameplay\\.${callbackName}`))
  }
})

test('MapLibre route notifications use the compact noninteractive toast', () => {
  const soloPageSource = readFileSync(
    new URL('../src/pages/SoloPlayPage.jsx', import.meta.url),
    'utf8',
  )
  const mapLibreCss = readFileSync(
    new URL('../src/styles/maplibreSoloGameMap.css', import.meta.url),
    'utf8',
  )

  assert.match(soloPageSource, /maplibre-game-toast is-error/)
  assert.match(mapLibreCss, /\.maplibre-game-toast\s*\{/)
  assert.match(mapLibreCss, /max-width: min\(360px,/)
  assert.match(mapLibreCss, /pointer-events: none/)
  assert.match(mapLibreCss, /@keyframes maplibre-game-toast-life/)
})

test('Leaflet solo components and multiplayer Leaflet map stay isolated', () => {
  const soloPageSource = readFileSync(
    new URL('../src/pages/SoloPlayPage.jsx', import.meta.url),
    'utf8',
  )
  const roomPageSource = readFileSync(
    new URL('../src/pages/RoomPlayPage.jsx', import.meta.url),
    'utf8',
  )

  for (const legacyComponent of [
    'MovementStatusPanel',
    'PlayerHudPanel',
    'GameSessionPanel',
    'GameControlsPanel',
    'TargetInfoPanel',
    'CaughtInventoryPanel',
    'MoveConfirmPanel',
  ]) {
    assert.match(soloPageSource, new RegExp(`<${legacyComponent}`))
  }

  assert.match(roomPageSource, /<GameMap/)
  assert.doesNotMatch(roomPageSource, /MapLibre/)
})

test('Common, Rare, and Legendary targets derive distinct animation classes', () => {
  const rarityExpectations = [
    ['common', SOLO_TARGET_ANIMATION_CLASS_NAMES.COMMON],
    ['Rare', SOLO_TARGET_ANIMATION_CLASS_NAMES.RARE],
    ['LEGENDARY', SOLO_TARGET_ANIMATION_CLASS_NAMES.LEGENDARY],
  ]

  for (const [rarity, expectedAnimationClass] of rarityExpectations) {
    const viewState = getSoloTargetMarkerViewState(
      { ...REAL_TARGET, rarity },
      null,
      null,
      NOW,
    )

    assert.equal(viewState.animationClassName, expectedAnimationClass)
    assert.match(viewState.className, new RegExp(expectedAnimationClass))
  }
})

test('rarity identity remains present while chase and routing stay distinct', () => {
  const chasedViewState = getSoloTargetMarkerViewState(
    REAL_TARGET,
    REAL_TARGET.id,
    null,
    NOW,
  )
  const routingViewState = getSoloTargetMarkerViewState(
    REAL_TARGET,
    REAL_TARGET.id,
    REAL_TARGET.id,
    NOW,
  )

  assert.match(chasedViewState.className, /rarity-rare/)
  assert.match(chasedViewState.className, /animation-rare/)
  assert.match(chasedViewState.className, /is-chased/)
  assert.doesNotMatch(chasedViewState.className, /is-routing/)
  assert.match(routingViewState.className, /rarity-rare/)
  assert.match(routingViewState.className, /is-chased/)
  assert.match(routingViewState.className, /is-routing/)
})

test('the pending destination beacon renders only for a valid destination', () => {
  const markerSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMarkers.jsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.ok(getSoloDestinationMarkerViewState({ lat: 28.61, lon: 77.2 }))
  assert.equal(
    getSoloDestinationMarkerViewState({ lat: Number.NaN, lon: 77.2 }),
    null,
  )
  assert.match(markerSource, /maplibre-solo-destination-beacon/)
  assert.match(markerSource, /maplibre-solo-destination-core/)
  assert.match(markerSource, /destinationPosition &&/)
})

test('MapLibre alone receives the bounded route overview prelude', () => {
  assert.equal(
    getSoloRouteAnimationStartDelay(SOLO_MAP_RENDERERS.LEAFLET),
    0,
  )
  assert.equal(
    getSoloRouteAnimationStartDelay(SOLO_MAP_RENDERERS.MAPLIBRE),
    MAPLIBRE_SOLO_ROUTE_PRELUDE_MS,
  )
  assert.ok(MAPLIBRE_SOLO_ROUTE_PRELUDE_MS >= 350)
  assert.ok(MAPLIBRE_SOLO_ROUTE_PRELUDE_MS <= 450)
})

test('camera modes transition OVERVIEW to FOLLOW to FREE and resume FOLLOW', () => {
  let mode = SOLO_CAMERA_MODES.OVERVIEW

  mode = transitionSoloCameraMode(
    mode,
    SOLO_CAMERA_EVENTS.MOVEMENT_STARTED,
  )
  assert.equal(mode, SOLO_CAMERA_MODES.FOLLOW)

  mode = transitionSoloCameraMode(
    mode,
    SOLO_CAMERA_EVENTS.USER_INTERACTION,
  )
  assert.equal(mode, SOLO_CAMERA_MODES.FREE)
  assert.equal(
    transitionSoloCameraMode(
      mode,
      SOLO_CAMERA_EVENTS.MOVEMENT_STARTED,
    ),
    SOLO_CAMERA_MODES.FREE,
  )

  mode = transitionSoloCameraMode(
    mode,
    SOLO_CAMERA_EVENTS.RESUME_FOLLOW,
  )
  assert.equal(mode, SOLO_CAMERA_MODES.FOLLOW)
  assert.equal(
    transitionSoloCameraMode(
      mode,
      SOLO_CAMERA_EVENTS.MOVEMENT_STOPPED,
    ),
    SOLO_CAMERA_MODES.OVERVIEW,
  )
})

test('shortest-angle bearing interpolation crosses north correctly', () => {
  assert.equal(getShortestSoloCameraBearingDelta(359, 1), 2)
  assert.equal(getShortestSoloCameraBearingDelta(1, 359), -2)
  assert.equal(getShortestSoloCameraBearingDelta(0, 180), -180)
  assert.equal(getShortestSoloCameraBearingDelta(180, 0), -180)
  assert.ok(smoothSoloCameraBearing(359, 1, 16) > 359)
  assert.ok(smoothSoloCameraBearing(1, 359, 16) < 1)
})

test('camera smoothing is elapsed-time based and converges toward heading', () => {
  const oneLongFrame = smoothSoloCameraBearing(10, 90, 32)
  const firstShortFrame = smoothSoloCameraBearing(10, 90, 16)
  const twoShortFrames = smoothSoloCameraBearing(
    firstShortFrame,
    90,
    16,
  )

  assert.ok(Math.abs(oneLongFrame - twoShortFrames) < 1e-10)
  assert.ok(oneLongFrame > 10)
  assert.ok(oneLongFrame < 90)
})

test('only real camera input is classified as a user interaction', () => {
  assert.equal(
    isSoloCameraUserInteraction({ originalEvent: { type: 'wheel' } }),
    true,
  )
  assert.equal(
    isSoloCameraUserInteraction({
      soloCameraOperation: SOLO_CAMERA_PROGRAMMATIC_EVENT,
    }),
    false,
  )
  assert.equal(isSoloCameraUserInteraction({ type: 'movestart' }), false)
  assert.equal(
    isSoloCameraUserInteraction({
      soloCameraOperation: SOLO_CAMERA_PROGRAMMATIC_EVENT,
      originalEvent: { type: 'pointerdown' },
    }),
    true,
  )
})

test('reduced motion removes cinematic transitions and rotation', () => {
  assert.deepEqual(getSoloReducedMotionCameraPolicy(true), {
    overviewDurationMs: 0,
    followEntryDurationMs: 0,
    resumeDurationMs: 0,
    followPitch: 0,
    overviewPitch: 0,
    tracksBearing: false,
  })

  const options = createSoloFollowCameraOptions(
    {
      position: { lat: 28.6, lon: 77.2 },
      lookAheadPosition: { lat: 28.601, lon: 77.201 },
      bearingDegrees: 45,
      timestampMs: 100,
    },
    { currentBearingDegrees: 20, prefersReducedMotion: true },
  )

  assert.equal(options.pitch, 0)
  assert.equal(options.bearing, 0)
  assert.ok(options.center[0] > 77.2)
  assert.ok(options.center[1] > 28.6)
})

test('overview bounds include route endpoints without antimeridian world framing', () => {
  assert.deepEqual(
    createSoloOverviewBounds({
      playerPosition: { lat: 10, lon: 179.8 },
      destination: { lat: 10.1, lon: -179.8 },
      routeCoordinates: [
        [10, 179.8],
        [10.1, -179.8],
      ],
    }),
    [
      [179.8, 10],
      [180.2, 10.1],
    ],
  )
  assert.deepEqual(
    getSoloRouteDestination([
      [28.6, 77.2],
      [28.7, 77.3],
    ]),
    { lat: 28.7, lon: 77.3 },
  )
})

test('camera controller remains local, imperative, and cleanup-aware', () => {
  const cameraSource = readFileSync(
    new URL(
      '../src/components/maplibre/useMapLibreSoloCamera.js',
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

  assert.match(cameraSource, /subscribeToNavigationFrames/)
  assert.match(cameraSource, /map\.jumpTo/)
  assert.match(cameraSource, /map\.easeTo/)
  assert.match(cameraSource, /map\.fitBounds/)
  assert.match(cameraSource, /createSoloCameraWorkManager/)
  assert.match(cameraSource, /removeEventListener/)
  assert.match(soloMapSource, /Resume Follow/)
  assert.doesNotMatch(soloMapSource, /\bviewState=/)
})

test('catch feedback remains score-aware and pointer-transparent', () => {
  const markerSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMarkers.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const mapLibreCss = readFileSync(
    new URL('../src/styles/maplibreSoloGameMap.css', import.meta.url),
    'utf8',
  )
  const viewState = getCaughtTargetEffectViewState(REAL_TARGET)

  assert.equal(viewState.score, REAL_TARGET.score)
  assert.match(viewState.className, /rarity-rare/)
  assert.match(markerSource, /pointerEvents: 'none'/)
  assert.match(markerSource, /<strong>\+\{viewState\.score\}<\/strong>/)
  assert.match(
    mapLibreCss,
    /\.maplibre-solo-catch-effect,[\s\S]*pointer-events: none/,
  )
})

test('continuous MapLibre motion has complete reduced-motion fallbacks', () => {
  const mapLibreCss = readFileSync(
    new URL('../src/styles/maplibreSoloGameMap.css', import.meta.url),
    'utf8',
  )
  const finalReducedMotionBlock = mapLibreCss.slice(
    mapLibreCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
  )

  for (const selector of [
    '.maplibre-solo-target-visual',
    '.maplibre-solo-target-ring',
    '.maplibre-solo-target-lock',
    '.maplibre-solo-target-routing',
    '.maplibre-solo-destination-beacon',
    '.maplibre-round-status.is-warning .maplibre-round-time',
  ]) {
    assert.ok(finalReducedMotionBlock.includes(selector))
  }

  assert.match(finalReducedMotionBlock, /animation: none/)
  assert.match(finalReducedMotionBlock, /\.maplibre-solo-catch-ring/)
  assert.match(finalReducedMotionBlock, /opacity: 0\.68/)
})

test('animations stay on marker inner elements and avoid frame loops', () => {
  const markerSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreSoloGameMarkers.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const mapLibreCss = readFileSync(
    new URL('../src/styles/maplibreSoloGameMap.css', import.meta.url),
    'utf8',
  )
  const projectPackage = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )

  assert.match(markerSource, /maplibre-solo-target-visual/)
  assert.match(
    mapLibreCss,
    /\.maplibre-solo-target\.animation-common \.maplibre-solo-target-visual/,
  )
  assert.doesNotMatch(
    mapLibreCss,
    /\.maplibregl-marker[^}]*animation/,
  )
  assert.doesNotMatch(markerSource, /requestAnimationFrame/)
  assert.doesNotMatch(mapLibreCss, /requestAnimationFrame/)
  assert.equal(projectPackage.dependencies['framer-motion'], undefined)
  assert.equal(projectPackage.dependencies['react-spring'], undefined)
  assert.equal(projectPackage.dependencies['animejs'], undefined)
})

test('HUD value feedback remounts only value spans, never the map', () => {
  const gameHudSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreGameHud.jsx',
      import.meta.url,
    ),
    'utf8',
  )
  const targetPanelSource = readFileSync(
    new URL(
      '../src/components/maplibre/MapLibreTargetPanel.jsx',
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

  assert.match(gameHudSource, /key=\{`score-\$\{score\}`\}/)
  assert.match(gameHudSource, /key=\{`caught-\$\{caughtCount\}`\}/)
  assert.match(targetPanelSource, /key=\{`targets-\$\{targets\.length\}`\}/)
  assert.doesNotMatch(soloMapSource, /\bkey=/)
  assert.doesNotMatch(gameHudSource, /requestAnimationFrame/)
})
