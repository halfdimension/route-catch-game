function MapLibreDestinationSheet({
  destination,
  chasedTarget,
  isLoading,
  onConfirm,
  onCancel,
}) {
  return (
    <section
      className="maplibre-hud-panel maplibre-destination-sheet maplibre-hud-interactive"
      aria-label="Confirm movement"
    >
      <div className="maplibre-destination-icon" aria-hidden="true">⌖</div>
      <div className="maplibre-destination-copy">
        <span className="maplibre-hud-eyebrow">
          {isLoading ? 'Route calculation' : 'Destination selected'}
        </span>
        <strong>{isLoading ? 'Finding the best route…' : 'Move to this location?'}</strong>
        <span>
          {chasedTarget
            ? `Chasing ${chasedTarget.name}`
            : `${destination.lat.toFixed(5)}, ${destination.lon.toFixed(5)}`}
        </span>
      </div>
      <div className="maplibre-destination-actions">
        <button type="button" onClick={onCancel} disabled={isLoading}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={onConfirm}
          disabled={isLoading}
        >
          {isLoading ? 'Routing…' : 'Confirm'}
        </button>
      </div>
    </section>
  )
}

export default MapLibreDestinationSheet
