import { DomEvent, divIcon } from 'leaflet'
import { Marker } from 'react-leaflet'
import { getRarityClassName } from '../utils/rarityStyles'

function TargetMarker({ target, onClick, isChased, isRouting }) {
  const rarityClassName = getRarityClassName(target.rarity)
  const chaseClassName = isChased
    ? ` is-chased${isRouting ? ' is-routing' : ''}`
    : ''
  const icon = divIcon({
    className: `target-creature-marker ${rarityClassName}${chaseClassName}`,
    html: `
      <span class="target-creature-marker-core">
        <span class="target-creature-marker-symbol">${target.symbol}</span>
      </span>
    `,
    iconAnchor: [20, 20],
    iconSize: [40, 40],
  })

  return (
    <Marker
      position={[target.lat, target.lon]}
      icon={icon}
      title={`${target.name}, ${target.rarity} target${
        isChased ? ', currently chased' : ''
      }`}
      eventHandlers={{
        click(event) {
          DomEvent.stop(event.originalEvent)
          onClick(target)
        },
      }}
    />
  )
}

export default TargetMarker
