import { divIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character],
  )
}

function getInitial(displayName) {
  return displayName.trim().charAt(0).toUpperCase() || 'P'
}

function OtherPlayerMarkers({ players }) {
  return players.map((player) => {
    const displayName = player.displayName?.trim() || player.username || 'Player'
    const icon = divIcon({
      className: 'other-player-marker',
      html: `<span>${escapeHtml(getInitial(displayName))}</span>`,
      iconAnchor: [15, 15],
      iconSize: [30, 30],
    })
    const latitude = Number(player.renderPosition?.lat ?? player.lat)
    const longitude = Number(player.renderPosition?.lon ?? player.lon)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null
    }

    return (
      <Marker
        key={player.userId}
        position={[latitude, longitude]}
        icon={icon}
      >
        <Tooltip direction="top" offset={[0, -14]} opacity={0.95}>
          {displayName}
        </Tooltip>
      </Marker>
    )
  })
}

export default OtherPlayerMarkers
