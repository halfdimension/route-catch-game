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

function TargetInfoPanel({ targets }) {
  return (
    <section className="target-info-panel" aria-label="Active targets">
      <p>Targets</p>
      {targets.length === 0 ? (
        <span>No active targets</span>
      ) : (
        <ul>
          {targets.map((target) => {
            const routeDistance = formatMeters(target.routeDistanceMeters)
            const estimatedTravelSeconds = formatSeconds(
              target.estimatedGameTravelSeconds,
            )

            return (
              <li key={target.id}>
                <strong>{target.name}</strong>
                <span>
                  {target.rarity} · {getRemainingSeconds(target)}s
                </span>
                <span>Difficulty: {target.difficulty}</span>
                {routeDistance && <span>Route: {routeDistance}</span>}
                {estimatedTravelSeconds && (
                  <span>ETA: {estimatedTravelSeconds}</span>
                )}
                {target.snappedToRoad && (
                  <em className="road-snapped-label">road-snapped</em>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default TargetInfoPanel
