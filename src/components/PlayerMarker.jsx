import { CircleMarker } from 'react-leaflet'

function PlayerMarker({ position, variant = 'player' }) {
  const isDestination = variant === 'destination'

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
