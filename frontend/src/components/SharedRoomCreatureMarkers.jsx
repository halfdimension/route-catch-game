import { DomEvent, divIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getRarityClassName } from '../utils/rarityStyles'

const SHARED_CREATURE_ICON_SIZE = 36
const SHARED_CREATURE_ICON_ANCHOR = SHARED_CREATURE_ICON_SIZE / 2

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

function SharedRoomCreatureMarkers({
  creatures = [],
  onCatchCreature,
  chasedCreatureId,
  routingCreatureId,
}) {
  return creatures.map((creature) => {
    const latitude = Number(creature.latitude)
    const longitude = Number(creature.longitude)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null
    }

    const rarityClassName = getRarityClassName(creature.rarity)
    const isChased = creature.instanceId === chasedCreatureId
    const isRouting = creature.instanceId === routingCreatureId
    const chaseClassName = isChased
      ? ` is-chased${isRouting ? ' is-routing' : ''}`
      : ''
    const icon = divIcon({
      className: 'shared-room-creature-marker-icon',
      html: `
        <span class="shared-room-creature-marker ${rarityClassName}${chaseClassName}">
          <span class="shared-room-creature-marker-core">
            <span class="shared-room-creature-marker-symbol">
              ${escapeHtml(getCreatureInitial(creature.name))}
            </span>
          </span>
        </span>
      `,
      iconAnchor: [SHARED_CREATURE_ICON_ANCHOR, SHARED_CREATURE_ICON_ANCHOR],
      iconSize: [SHARED_CREATURE_ICON_SIZE, SHARED_CREATURE_ICON_SIZE],
    })

    return (
      <Marker
        key={creature.instanceId}
        position={[latitude, longitude]}
        icon={icon}
        pane="creature-marker-pane"
        bubblingMouseEvents={false}
        zIndexOffset={350}
        title={`${creature.name}, ${creature.rarity} shared creature`}
        eventHandlers={{
          click(event) {
            DomEvent.stop(event.originalEvent)
            onCatchCreature?.(creature)
          },
        }}
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
