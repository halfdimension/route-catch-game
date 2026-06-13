import { divIcon } from 'leaflet'
import { Marker } from 'react-leaflet'
import { getRarityClassName } from '../utils/rarityStyles'

function CatchMapEffect({ caughtTarget }) {
  if (!caughtTarget) {
    return null
  }

  const rarityClassName = getRarityClassName(caughtTarget.rarity)
  const icon = divIcon({
    className: `catch-map-effect ${rarityClassName}`,
    html: `
      <span class="catch-map-effect-ring"></span>
      <span class="catch-map-effect-score">+${caughtTarget.score}</span>
    `,
    iconAnchor: [32, 32],
    iconSize: [64, 64],
  })

  return (
    <Marker
      position={[caughtTarget.lat, caughtTarget.lon]}
      icon={icon}
      interactive={false}
      keyboard={false}
    />
  )
}

export default CatchMapEffect
