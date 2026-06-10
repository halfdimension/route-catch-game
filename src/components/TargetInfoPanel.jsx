function getRemainingSeconds(target) {
  return Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000))
}

function TargetInfoPanel({ targets }) {
  return (
    <section className="target-info-panel" aria-label="Active targets">
      <p>Targets</p>
      {targets.length === 0 ? (
        <span>No active targets</span>
      ) : (
        <ul>
          {targets.map((target) => (
            <li key={target.id}>
              <strong>{target.name}</strong>
              <span>
                {target.rarity} · {getRemainingSeconds(target)}s
              </span>
              {target.snappedToRoad && (
                <em className="road-snapped-label">road-snapped</em>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default TargetInfoPanel
