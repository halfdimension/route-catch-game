import L from 'leaflet'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM } from '../config/mapConfig'
import CatchMapEffect from './CatchMapEffect'
import PlayerMarker from './PlayerMarker'
import RouteLine from './RouteLine'
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
  caughtTarget,
  onMapClick,
  onTargetClick,
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
      <RouteLine coordinates={routeCoordinates} />
      <TargetLayer targets={targets} onTargetClick={onTargetClick} />
      <CatchMapEffect caughtTarget={caughtTarget} />
      <PlayerMarker position={playerPosition} />

      {pendingDestination && (
        <PlayerMarker position={pendingDestination} variant="destination" />
      )}
    </MapContainer>
  )
}

export default GameMap
