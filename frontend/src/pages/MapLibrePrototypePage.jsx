import 'maplibre-gl/dist/maplibre-gl.css'
import '../styles/maplibrePrototype.css'
import MapLibrePrototypeMap from '../components/maplibre/MapLibrePrototypeMap'

function MapLibrePrototypePage() {
  return (
    <main className="maplibre-prototype-page">
      <MapLibrePrototypeMap />
    </main>
  )
}

export default MapLibrePrototypePage
