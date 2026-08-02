import { Component } from 'react'
import '../../styles/maplibreSoloGameMap.css'

class MapLibreMapErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="game-map maplibre-solo-load-fallback is-error"
          role="alert"
        >
          <strong>MapLibre map unavailable</strong>
          <span>
            Set VITE_SOLO_MAP_RENDERER=leaflet and restart the frontend to use
            the Leaflet fallback.
          </span>
        </div>
      )
    }

    return this.props.children
  }
}

export default MapLibreMapErrorBoundary
