import { divIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getRarityClassName } from '../utils/rarityStyles'

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

function getCreatureInitial(name) {
  return String(name || 'S').trim().charAt(0).toUpperCase() || 'S'
}

function SharedRoomCreatureMarkers({ creatures = [] }) {
  return creatures.map((creature) => {
    const latitude = Number(creature.latitude)
    const longitude = Number(creature.longitude)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null
    }

    const rarityClassName = getRarityClassName(creature.rarity)
    const icon = divIcon({
      className: `shared-room-creature-marker ${rarityClassName}`,
      html: `
        <span class="shared-room-creature-marker-core">
          <span class="shared-room-creature-marker-symbol">
            ${escapeHtml(getCreatureInitial(creature.name))}
          </span>
        </span>
      `,
      iconAnchor: [16, 16],
      iconSize: [32, 32],
    })

    return (
      <Marker
        key={creature.instanceId}
        position={[latitude, longitude]}
        icon={icon}
        title={`${creature.name}, ${creature.rarity} shared creature`}
      >
        <Tooltip direction="top" offset={[0, -12]} opacity={0.95}>
          <span className="shared-room-creature-tooltip">
            <strong>{creature.name}</strong>
            <span>{creature.rarity}</span>
            <span>{creature.scoreValue} points</span>
            <span>{creature.remainingSeconds}s left</span>
          </span>
        </Tooltip>
      </Marker>
    )
  })
}

export default SharedRoomCreatureMarkers
