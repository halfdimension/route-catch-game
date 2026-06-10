import { Polyline } from 'react-leaflet'

function RouteLine({ coordinates }) {
  if (!coordinates.length) {
    return null
  }

  return (
    <Polyline
      positions={coordinates}
      pathOptions={{
        color: '#2563eb',
        opacity: 0.9,
        weight: 5,
      }}
    />
  )
}

export default RouteLine
