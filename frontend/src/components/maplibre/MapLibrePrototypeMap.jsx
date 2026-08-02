import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import Map, { NavigationControl } from '@vis.gl/react-maplibre'
import { fetchRoute } from '../../api/osrmClient'
import { INITIAL_MAP_CENTER } from '../../config/mapConfig'
import { toMapLibreCoordinate } from './mapLibreCoordinates'
import MapLibrePrototypeMarkers from './MapLibrePrototypeMarkers'
import MapLibreRouteLayer from './MapLibreRouteLayer'
import {
  createDestinationFromMapClick,
  SAMPLE_CREATURES,
} from './mapLibrePrototypeState'
import {
  createBuildingExtrusionLayer,
  findBuildingSource,
  MAPLIBRE_STYLE_URL,
} from './mapLibreStyleConfig'
import {
  createLoadedStyleState,
  createLoadingStyleState,
  isRouteEligible,
  transitionStyleStateForError,
} from './mapLibreStyleState'

const PLAYER_POSITION = Object.freeze({
  lat: INITIAL_MAP_CENTER[0],
  lon: INITIAL_MAP_CENTER[1],
})

const INITIAL_DESTINATION = Object.freeze({
  lat: 28.6122,
  lon: 77.2132,
})

const INITIAL_MAPLIBRE_CENTER = toMapLibreCoordinate(INITIAL_MAP_CENTER)

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return '—'
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`
}

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds)) {
    return '—'
  }

  const roundedMinutes = Math.max(1, Math.round(durationSeconds / 60))
  return `${roundedMinutes} min`
}

function MapLibrePrototypeMap() {
  const routeAbortControllerRef = useRef(null)
  const [pendingDestination, setPendingDestination] =
    useState(INITIAL_DESTINATION)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [routeMetrics, setRouteMetrics] = useState(null)
  const [selectedCreatureId, setSelectedCreatureId] = useState(null)
  const [routingCreatureId, setRoutingCreatureId] = useState(null)
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [styleState, setStyleState] = useState(createLoadingStyleState)

  const requestRoute = useCallback(async (destination, creatureId = null) => {
    routeAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    routeAbortControllerRef.current = abortController

    setPendingDestination(destination)
    setRoutingCreatureId(creatureId)
    setIsRouteLoading(true)
    setRouteError('')
    setRouteMetrics(null)

    try {
      const route = await fetchRoute(PLAYER_POSITION, destination, {
        signal: abortController.signal,
      })

      if (routeAbortControllerRef.current !== abortController) {
        return
      }

      setRouteCoordinates(route.coordinates)
      setRouteMetrics({
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      })
    } catch (error) {
      if (
        error.name === 'AbortError' ||
        routeAbortControllerRef.current !== abortController
      ) {
        return
      }

      setRouteCoordinates([])
      setRouteError(
        `Routing unavailable: ${error.message || 'the backend or OSRM did not respond.'}`,
      )
    } finally {
      if (routeAbortControllerRef.current === abortController) {
        routeAbortControllerRef.current = null
        setRoutingCreatureId(null)
        setIsRouteLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const initialRouteTimer = window.setTimeout(() => {
      void requestRoute(INITIAL_DESTINATION)
    }, 0)

    return () => {
      window.clearTimeout(initialRouteTimer)
      routeAbortControllerRef.current?.abort()
      routeAbortControllerRef.current = null
    }
  }, [requestRoute])

  const handleMapClick = useCallback(
    (event) => {
      const destination = createDestinationFromMapClick(event.lngLat)

      if (!destination) {
        setRouteError('The selected map location is invalid.')
        return
      }

      setSelectedCreatureId(null)
      void requestRoute(destination)
    },
    [requestRoute],
  )

  const handleCreatureClick = useCallback(
    (creature) => {
      setSelectedCreatureId(creature.id)
      void requestRoute(
        { lat: creature.lat, lon: creature.lon },
        creature.id,
      )
    },
    [requestRoute],
  )

  const handleMapLoad = useCallback((event) => {
    const map = event.target
    const buildingSource = findBuildingSource(map.getStyle())
    const buildingLayer = createBuildingExtrusionLayer(buildingSource)

    if (!buildingLayer) {
      setStyleState(createLoadedStyleState(false))
      return
    }

    try {
      if (!map.getLayer(buildingLayer.id)) {
        map.addLayer(buildingLayer, buildingSource.beforeId)
      }
      setStyleState(createLoadedStyleState(true))
    } catch {
      setStyleState(createLoadedStyleState(false))
    }
  }, [])

  const handleMapError = useCallback((event) => {
    setStyleState((currentState) =>
      transitionStyleStateForError(currentState, event.error),
    )
  }, [])

  const canRenderRoute = isRouteEligible(styleState, routeCoordinates)

  function clearPrototypeRoute() {
    routeAbortControllerRef.current?.abort()
    routeAbortControllerRef.current = null
    setPendingDestination(null)
    setRouteCoordinates([])
    setRouteMetrics(null)
    setRouteError('')
    setSelectedCreatureId(null)
    setRoutingCreatureId(null)
    setIsRouteLoading(false)
  }

  return (
    <section
      className="maplibre-prototype-map-shell"
      aria-label="MapLibre game map prototype"
    >
      <Map
        id="maplibre-game-map-prototype"
        initialViewState={{
          longitude: INITIAL_MAPLIBRE_CENTER[0],
          latitude: INITIAL_MAPLIBRE_CENTER[1],
          zoom: 15,
          pitch: 40,
          bearing: 0,
        }}
        mapStyle={MAPLIBRE_STYLE_URL}
        attributionControl
        boxZoom
        doubleClickZoom
        dragPan
        dragRotate
        keyboard
        maxPitch={60}
        pitchWithRotate
        scrollZoom
        touchPitch
        touchZoomRotate
        reuseMaps
        onClick={handleMapClick}
        onLoad={handleMapLoad}
        onError={handleMapError}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        {canRenderRoute && (
          <MapLibreRouteLayer
            coordinates={routeCoordinates}
            isChaseActive={Boolean(selectedCreatureId)}
          />
        )}
        <MapLibrePrototypeMarkers
          playerPosition={PLAYER_POSITION}
          playerName="Delhi Ranger"
          creatures={SAMPLE_CREATURES}
          pendingDestination={pendingDestination}
          selectedCreatureId={selectedCreatureId}
          routingCreatureId={routingCreatureId}
          onCreatureClick={handleCreatureClick}
        />
      </Map>

      <aside className="maplibre-prototype-status" aria-live="polite">
        <div className="maplibre-prototype-status-heading">
          <span className="maplibre-prototype-kicker">Renderer lab</span>
          <strong>Delhi chase map</strong>
        </div>

        {styleState.errorMessage && (
          <p className="maplibre-prototype-alert is-error" role="alert">
            {styleState.errorMessage}
          </p>
        )}

        {isRouteLoading && (
          <p className="maplibre-prototype-alert is-loading">
            Finding the best street route…
          </p>
        )}

        {routeError && (
          <p className="maplibre-prototype-alert is-error" role="alert">
            {routeError}
          </p>
        )}

        <dl className="maplibre-prototype-metrics">
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(routeMetrics?.distanceMeters)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(routeMetrics?.durationSeconds)}</dd>
          </div>
        </dl>

        <p
          className={`maplibre-prototype-building-status is-${styleState.status}`}
        >
          {styleState.label}
        </p>

        <div className="maplibre-prototype-actions">
          <button
            type="button"
            onClick={() => handleCreatureClick(SAMPLE_CREATURES[2])}
          >
            Chase legend
          </button>
          <button type="button" onClick={clearPrototypeRoute}>
            Clear route
          </button>
        </div>
      </aside>

      <div className="maplibre-prototype-hint">
        Click the map to route, or choose a creature to start a chase.
      </div>
    </section>
  )
}

export default MapLibrePrototypeMap
