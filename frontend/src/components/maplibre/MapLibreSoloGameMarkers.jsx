import { Marker } from '@vis.gl/react-maplibre'
import { mockUserProfile } from '../../data/mockUserProfile'
import {
  getCaughtTargetEffectViewState,
  getSoloDestinationMarkerViewState,
  getSoloPlayerMarkerViewState,
  getSoloTargetMarkerViewState,
  handleSoloTargetMarkerClick,
} from './mapLibreSoloGameState'

function MapLibreSoloPlayerMarker({ position, playerName }) {
  const viewState = getSoloPlayerMarkerViewState(
    position,
    playerName,
    mockUserProfile.avatarUrl,
  )

  if (!viewState) {
    return null
  }

  return (
    <Marker
      longitude={viewState.mapPosition[0]}
      latitude={viewState.mapPosition[1]}
      anchor="center"
      style={{
        zIndex: 4,
        transition: 'transform 80ms linear',
      }}
    >
      <div
        className="maplibre-solo-player-marker"
        title={viewState.title}
        aria-label={viewState.title}
      >
        {viewState.avatarUrl ? (
          <img
            src={viewState.avatarUrl}
            alt={viewState.displayName}
          />
        ) : (
          <span aria-hidden="true">{viewState.initial}</span>
        )}
        <strong>{viewState.displayName}</strong>
      </div>
    </Marker>
  )
}

function MapLibreSoloDestinationMarker({ position }) {
  const viewState = getSoloDestinationMarkerViewState(position)

  if (!viewState) {
    return null
  }

  return (
    <Marker
      longitude={viewState.mapPosition[0]}
      latitude={viewState.mapPosition[1]}
      anchor="center"
      style={{ zIndex: 2, pointerEvents: 'none' }}
    >
      <div
        className="maplibre-solo-destination-marker"
        title={viewState.title}
        aria-label={viewState.title}
      >
        <span aria-hidden="true" />
      </div>
    </Marker>
  )
}

function MapLibreSoloTargetMarker({
  target,
  chasedTargetId,
  routingTargetId,
  onTargetClick,
}) {
  const viewState = getSoloTargetMarkerViewState(
    target,
    chasedTargetId,
    routingTargetId,
  )

  if (!viewState) {
    return null
  }

  return (
    <Marker
      longitude={viewState.mapPosition[0]}
      latitude={viewState.mapPosition[1]}
      anchor="center"
      style={{ zIndex: 3 }}
    >
      <button
        type="button"
        className={viewState.className}
        onClick={(event) =>
          handleSoloTargetMarkerClick(event, target, onTargetClick)
        }
        title={viewState.title}
        aria-label={viewState.ariaLabel}
        aria-pressed={viewState.isChased}
      >
        <span className="maplibre-solo-target-ring" aria-hidden="true" />
        <span className="maplibre-solo-target-core" aria-hidden="true">
          {target.symbol}
        </span>
        <span className="maplibre-solo-target-card" aria-hidden="true">
          <span className="maplibre-solo-target-heading">
            <strong>{viewState.name}</strong>
            <small>{viewState.rarityLabel}</small>
          </span>
          <span className="maplibre-solo-target-stats">
            <span>
              <small>Score</small>
              <strong>{viewState.score}</strong>
            </span>
            <span>
              <small>Time</small>
              <strong>{viewState.remainingSeconds}s</strong>
            </span>
            <span>
              <small>Difficulty</small>
              <strong>{viewState.difficultyLabel}</strong>
            </span>
          </span>
        </span>
      </button>
    </Marker>
  )
}

function MapLibreCaughtTargetEffect({ caughtTarget }) {
  const viewState = getCaughtTargetEffectViewState(caughtTarget)

  if (!viewState) {
    return null
  }

  return (
    <Marker
      longitude={viewState.mapPosition[0]}
      latitude={viewState.mapPosition[1]}
      anchor="center"
      style={{ zIndex: 5, pointerEvents: 'none' }}
    >
      <span className={viewState.className} aria-hidden="true">
        <span className="maplibre-solo-catch-ring" />
        <strong>+{viewState.score}</strong>
      </span>
    </Marker>
  )
}

function MapLibreSoloGameMarkers({
  playerPosition,
  playerName,
  pendingDestination,
  targets,
  chasedTargetId,
  routingTargetId,
  caughtTarget,
  onTargetClick,
}) {
  return (
    <>
      <MapLibreSoloPlayerMarker
        position={playerPosition}
        playerName={playerName}
      />
      {targets.map((target) => (
        <MapLibreSoloTargetMarker
          key={target.id}
          target={target}
          chasedTargetId={chasedTargetId}
          routingTargetId={routingTargetId}
          onTargetClick={onTargetClick}
        />
      ))}
      {pendingDestination && (
        <MapLibreSoloDestinationMarker position={pendingDestination} />
      )}
      <MapLibreCaughtTargetEffect caughtTarget={caughtTarget} />
    </>
  )
}

export default MapLibreSoloGameMarkers
