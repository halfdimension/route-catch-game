import { DomEvent, divIcon } from 'leaflet'
import { Marker } from 'react-leaflet'

function TargetMarker({ target, onClick }) {
  const icon = divIcon({
    className: 'target-creature-marker',
    html: `<span style="background-color: ${target.color}">${target.symbol}</span>`,
    iconAnchor: [16, 16],
    iconSize: [32, 32],
  })

  return (
    <Marker
      position={[target.lat, target.lon]}
      icon={icon}
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
