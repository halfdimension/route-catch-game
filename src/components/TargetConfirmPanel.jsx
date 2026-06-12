function getRemainingSeconds(target) {
  return Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000))
}

function formatMeters(meters) {
  if (meters === null || meters === undefined) {
    return null
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`
  }

  return `${Math.round(meters)} m`
}

function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined) {
    return null
  }

  return `${Math.ceil(seconds)}s`
}

function TargetConfirmPanel({ target, onConfirm, onCancel, isLoading }) {
  const routeDistance = formatMeters(target.routeDistanceMeters)
  const estimatedTravelSeconds = formatSeconds(
    target.estimatedGameTravelSeconds,
  )

  return (
    <section className="move-confirm-panel" aria-label="Confirm target movement">
      <p>{isLoading ? 'Fetching route...' : 'Move to target?'}</p>
      <div className="target-confirm-details">
        <strong>{target.name}</strong>
        <span>Rarity: {target.rarity}</span>
        <span>Score: {target.score}</span>
        <span>Expires in: {getRemainingSeconds(target)}s</span>
        <span>Difficulty: {target.difficulty}</span>
        {routeDistance && <span>Route: {routeDistance}</span>}
        {estimatedTravelSeconds && <span>ETA: {estimatedTravelSeconds}</span>}
      </div>
      <div className="move-confirm-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onConfirm}
          disabled={isLoading}
        >
          {isLoading ? 'Loading' : 'Yes'}
        </button>
        <button type="button" onClick={onCancel} disabled={isLoading}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export default TargetConfirmPanel
