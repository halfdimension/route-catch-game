import L from 'leaflet'
import { MapContainer, Pane, TileLayer, useMapEvents } from 'react-leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM } from '../config/mapConfig'
import { MAP_PANE } from '../config/mapPaneConfig'
import CatchMapEffect from './CatchMapEffect'
import OtherPlayerMarkers from './OtherPlayerMarkers'
import PlayerMarker from './PlayerMarker'
import RouteLine from './RouteLine'
import SharedRoomCreatureMarkers from './SharedRoomCreatureMarkers'
import TargetLayer from './TargetLayer'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick({
        lat: event.latlng.lat,
        lon: event.latlng.lng,
      })
    },
  })

  return null
}

function GameMap({
  playerPosition,
  pendingDestination,
  routeCoordinates,
  targets,
  sharedRoomCreatures = [],
  caughtTarget,
  chasedTargetId,
  routingTargetId,
  chasedSharedRoomCreatureId,
  routingSharedRoomCreatureId,
  playerName,
  otherPlayers = [],
  onMapClick,
  onTargetClick,
  onSharedRoomCreatureCatch,
}) {
  return (
    <MapContainer
      center={INITIAL_MAP_CENTER}
      zoom={INITIAL_MAP_ZOOM}
      className="game-map"
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapClickHandler onMapClick={onMapClick} />
      <Pane name={MAP_PANE.ROUTE.name} style={{ zIndex: MAP_PANE.ROUTE.zIndex }}>
        <RouteLine
          coordinates={routeCoordinates}
          isChaseActive={Boolean(
            chasedTargetId || chasedSharedRoomCreatureId,
          )}
        />
      </Pane>
      <Pane
        name={MAP_PANE.CREATURE.name}
        style={{ zIndex: MAP_PANE.CREATURE.zIndex }}
      >
        <TargetLayer
          targets={targets}
          onTargetClick={onTargetClick}
          chasedTargetId={chasedTargetId}
          routingTargetId={routingTargetId}
        />
        <CatchMapEffect caughtTarget={caughtTarget} />
      </Pane>
      <Pane
        name={MAP_PANE.PLAYER.name}
        style={{ zIndex: MAP_PANE.PLAYER.zIndex }}
      >
        <OtherPlayerMarkers players={otherPlayers} />
        <PlayerMarker position={playerPosition} playerName={playerName} />
      </Pane>
      <Pane
        name={MAP_PANE.SHARED_ROOM_CREATURE.name}
        style={{ zIndex: MAP_PANE.SHARED_ROOM_CREATURE.zIndex }}
      >
        <SharedRoomCreatureMarkers
          creatures={sharedRoomCreatures}
          onCatchCreature={onSharedRoomCreatureCatch}
          chasedCreatureId={chasedSharedRoomCreatureId}
          routingCreatureId={routingSharedRoomCreatureId}
        />
      </Pane>

      {pendingDestination && (
        <PlayerMarker position={pendingDestination} variant="destination" />
      )}
    </MapContainer>
  )
}

export default GameMap
