import { Marker } from '@vis.gl/react-maplibre'
import { toMapLibreLngLat } from './mapLibreCoordinates'
import { getCreatureMarkerViewState } from './mapLibrePrototypeState'

function PlayerPrototypeMarker({ position, playerName }) {
  const mapPosition = toMapLibreLngLat(position)

  if (!mapPosition) {
    return null
  }

  return (
    <Marker
      longitude={mapPosition[0]}
      latitude={mapPosition[1]}
      anchor="center"
    >
      <div
        className="maplibre-prototype-player"
        title={`${playerName}, local player`}
        aria-label={`${playerName}, local player`}
      >
        <span aria-hidden="true">{playerName.charAt(0).toUpperCase()}</span>
        <strong>{playerName}</strong>
      </div>
    </Marker>
  )
}

function CreaturePrototypeMarker({
  creature,
  selectedCreatureId,
  routingCreatureId,
  onCreatureClick,
}) {
  const mapPosition = toMapLibreLngLat(creature)

  if (!mapPosition) {
    return null
  }

  const viewState = getCreatureMarkerViewState(
    creature,
    selectedCreatureId,
    routingCreatureId,
  )

  function handleClick(event) {
    event.stopPropagation()
    onCreatureClick(creature)
  }

  return (
    <Marker
      longitude={mapPosition[0]}
      latitude={mapPosition[1]}
      anchor="center"
    >
      <button
        type="button"
        className={viewState.className}
        onClick={handleClick}
        title={`Route to ${creature.name}`}
        aria-pressed={viewState.isSelected}
        aria-label={`${creature.name}, ${creature.rarity}. ${viewState.statusLabel}`}
      >
        <span className="maplibre-prototype-creature-ring" aria-hidden="true" />
        <span className="maplibre-prototype-creature-core" aria-hidden="true">
          {creature.symbol}
        </span>
        <span className="maplibre-prototype-creature-label">
          <strong>{creature.name}</strong>
          <small>{viewState.statusLabel}</small>
        </span>
      </button>
    </Marker>
  )
}

function DestinationPrototypeMarker({ position }) {
  const mapPosition = toMapLibreLngLat(position)

  if (!mapPosition) {
    return null
  }

  return (
    <Marker
      longitude={mapPosition[0]}
      latitude={mapPosition[1]}
      anchor="bottom"
    >
      <div
        className="maplibre-prototype-destination"
        title="Pending destination"
        aria-label="Pending destination"
      >
        <span aria-hidden="true" />
      </div>
    </Marker>
  )
}

function MapLibrePrototypeMarkers({
  playerPosition,
  playerName,
  creatures,
  pendingDestination,
  selectedCreatureId,
  routingCreatureId,
  onCreatureClick,
}) {
  return (
    <>
      <PlayerPrototypeMarker
        position={playerPosition}
        playerName={playerName}
      />
      {creatures.map((creature) => (
        <CreaturePrototypeMarker
          key={creature.id}
          creature={creature}
          selectedCreatureId={selectedCreatureId}
          routingCreatureId={routingCreatureId}
          onCreatureClick={onCreatureClick}
        />
      ))}
      {pendingDestination && (
        <DestinationPrototypeMarker position={pendingDestination} />
      )}
    </>
  )
}

export default MapLibrePrototypeMarkers
