import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import Map, { NavigationControl } from '@vis.gl/react-maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { toMapLibreLngLat } from './mapLibreCoordinates'
import MapLibreRouteLayer from './MapLibreRouteLayer'
import MapLibreSoloGameMarkers from './MapLibreSoloGameMarkers'
import {
  createSoloInitialViewState,
  createSoloDestinationFromMapEvent,
  recenterSoloMap,
  SOLO_MAP_INTERACTION_PROPS,
} from './mapLibreSoloGameState'
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

function getMapErrorMessage(error) {
  const detail = String(error?.message || '').trim()

  return detail || 'MapLibre could not load the map style or its tiles.'
}

function MapLibreSoloGameMap({
  playerPosition,
  pendingDestination,
  routeCoordinates,
  targets,
  caughtTarget,
  chasedTargetId,
  routingTargetId,
  playerName,
  onMapClick,
  onTargetClick,
}) {
  const mapRef = useRef(null)
  const playerPositionRef = useRef(playerPosition)
  const [styleState, setStyleState] = useState(createLoadingStyleState)
  const [mapError, setMapError] = useState('')
  const [initialViewState] = useState(() =>
    createSoloInitialViewState(playerPosition),
  )
  const canRecenter = Boolean(toMapLibreLngLat(playerPosition))

  useEffect(() => {
    playerPositionRef.current = playerPosition
  }, [playerPosition])

  const handleMapClick = useCallback(
    (event) => {
      const destination = createSoloDestinationFromMapEvent(event)

      if (destination) {
        onMapClick(destination)
      }
    },
    [onMapClick],
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
    setMapError((currentError) =>
      currentError || getMapErrorMessage(event.error),
    )
  }, [])

  const handleRecenterPlayer = useCallback(() => {
    recenterSoloMap(mapRef.current, playerPositionRef.current)
  }, [])

  const canRenderRoute = isRouteEligible(
    styleState,
    routeCoordinates,
  )

  return (
    <div
      className="game-map maplibre-solo-game-map"
      aria-label="Solo game map"
    >
      <Map
        ref={mapRef}
        id="maplibre-solo-game-map"
        initialViewState={initialViewState}
        mapStyle={MAPLIBRE_STYLE_URL}
        attributionControl
        maxPitch={60}
        {...SOLO_MAP_INTERACTION_PROPS}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
        onError={handleMapError}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        {canRenderRoute && (
          <MapLibreRouteLayer
            coordinates={routeCoordinates}
            isChaseActive={Boolean(chasedTargetId)}
            sourceId="solo-route"
          />
        )}
        <MapLibreSoloGameMarkers
          playerPosition={playerPosition}
          playerName={playerName}
          pendingDestination={pendingDestination}
          targets={targets}
          chasedTargetId={chasedTargetId}
          routingTargetId={routingTargetId}
          caughtTarget={caughtTarget}
          onTargetClick={onTargetClick}
        />
      </Map>

      {canRecenter && (
        <button
          type="button"
          className="maplibre-solo-recenter-control"
          onClick={handleRecenterPlayer}
          title="Recenter map on current player"
          aria-label="Recenter map on current player"
        >
          <span aria-hidden="true">⌖</span>
          Player
        </button>
      )}

      {styleState.status === 'loading' && !mapError && (
        <div className="maplibre-solo-map-notice is-loading" role="status">
          Loading MapLibre map…
        </div>
      )}

      {mapError && (
        <div className="maplibre-solo-map-notice is-error" role="alert">
          <strong>MapLibre map unavailable</strong>
          <span>{mapError}</span>
          <small>
            Set VITE_SOLO_MAP_RENDERER=leaflet and restart the frontend to use
            the Leaflet fallback.
          </small>
        </div>
      )}
    </div>
  )
}

export default MapLibreSoloGameMap
