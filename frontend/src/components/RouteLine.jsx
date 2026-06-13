import { Polyline } from 'react-leaflet'

function RouteLine({ coordinates, isChaseActive = false }) {
  if (!coordinates.length) {
    return null
  }

  return (
    <Polyline
      positions={coordinates}
      pathOptions={{
        color: isChaseActive ? '#7c3aed' : '#2563eb',
        dashArray: isChaseActive ? '10 8' : undefined,
        opacity: isChaseActive ? 0.95 : 0.9,
        weight: isChaseActive ? 6 : 5,
      }}
    />
  )
}

export default RouteLine
