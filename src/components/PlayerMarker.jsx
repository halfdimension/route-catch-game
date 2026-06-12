import { divIcon } from 'leaflet'
import { CircleMarker, Marker, Tooltip } from 'react-leaflet'
import { mockUserProfile } from '../data/mockUserProfile'

function getInitial(displayName) {
  return displayName.trim().charAt(0).toUpperCase()
}

function getAvatarHtml(profile) {
  if (profile.avatarUrl) {
    return `<img src="${profile.avatarUrl}" alt="${profile.displayName}" />`
  }

  return `<span>${getInitial(profile.displayName)}</span>`
}

function PlayerMarker({ position, variant = 'player' }) {
  const isDestination = variant === 'destination'

  if (!isDestination) {
    const profile = mockUserProfile
    const icon = divIcon({
      className: 'player-avatar-marker',
      html: getAvatarHtml(profile),
      iconAnchor: [18, 18],
      iconSize: [36, 36],
    })

    return (
      <Marker position={[position.lat, position.lon]} icon={icon}>
        <Tooltip direction="top" offset={[0, -16]} opacity={0.95}>
          {profile.displayName} @{profile.username}
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
