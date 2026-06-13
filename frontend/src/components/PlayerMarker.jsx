import { divIcon } from 'leaflet'
import { CircleMarker, Marker, Tooltip } from 'react-leaflet'
import { mockUserProfile } from '../data/mockUserProfile'

function getInitial(displayName) {
  return displayName.trim().charAt(0).toUpperCase() || 'G'
}

function escapeHtml(value) {
  return value.replace(
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

function getAvatarHtml(displayName, avatarUrl) {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" />`
  }

  return `<span>${escapeHtml(getInitial(displayName))}</span>`
}

function PlayerMarker({ position, variant = 'player', playerName = 'Guest' }) {
  const isDestination = variant === 'destination'
  const displayName = playerName.trim() || 'Guest'

  if (!isDestination) {
    const icon = divIcon({
      className: 'player-avatar-marker',
      html: getAvatarHtml(displayName, mockUserProfile.avatarUrl),
      iconAnchor: [18, 18],
      iconSize: [36, 36],
    })

    return (
      <Marker position={[position.lat, position.lon]} icon={icon}>
        <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
          {displayName}
        </Tooltip>
      </Marker>
    )
  }

  return (
    <CircleMarker
      center={[position.lat, position.lon]}
      radius={isDestination ? 7 : 9}
      pathOptions={{
        color: isDestination ? '#1f2937' : '#ffffff',
        fillColor: isDestination ? '#f59e0b' : '#2563eb',
        fillOpacity: 1,
        opacity: 1,
        weight: isDestination ? 2 : 3,
      }}
    />
  )
}

export default PlayerMarker
