import { CircleMarker } from 'react-leaflet'

const TARGET_COLORS = {
  common: '#f97316',
  rare: '#ef4444',
  legendary: '#9333ea',
}

function TargetMarker({ target, onClick }) {
  return (
    <CircleMarker
      center={[target.lat, target.lon]}
      radius={target.rarity === 'legendary' ? 11 : 9}
      bubblingMouseEvents={false}
      pathOptions={{
        color: '#ffffff',
        fillColor: TARGET_COLORS[target.rarity],
        fillOpacity: 0.95,
        opacity: 1,
        weight: 3,
      }}
      eventHandlers={{
        click(event) {
          event.originalEvent.stopPropagation()
          onClick(target)
        },
      }}
    />
  )
}

export default TargetMarker
