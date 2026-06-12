function getRemainingSeconds(target) {
  return Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000))
}

function TargetInfoPanel({ targets, onTargetClick }) {
  return (
    <section className="target-info-panel" aria-label="Active targets">
      <p>Targets</p>
      {targets.length === 0 ? (
        <span>No active targets</span>
      ) : (
        <ul>
          {targets.map((target) => (
            <li key={target.id}>
              <button type="button" onClick={() => onTargetClick(target)}>
                <strong>
                  <span className="creature-symbol">{target.symbol}</span>
                  {target.name}
                </strong>
                <span>
                  {target.rarity} · {getRemainingSeconds(target)}s
                </span>
                <span>{target.difficulty}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default TargetInfoPanel
