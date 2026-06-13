import { getRarityClassName } from '../utils/rarityStyles'

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
          {targets.map((target) => {
            const rarityClassName = getRarityClassName(target.rarity)

            return (
              <li key={target.id}>
                <button
                  type="button"
                  className={`target-info-row ${rarityClassName}`}
                  onClick={() => onTargetClick(target)}
                >
                  <strong>
                    <span className="creature-symbol">{target.symbol}</span>
                    {target.name}
                  </strong>
                  <span className="target-info-meta">
                    <span className={`rarity-badge ${rarityClassName}`}>
                      {target.rarity}
                    </span>
                    <span>{getRemainingSeconds(target)}s</span>
                  </span>
                  <span className="target-difficulty">{target.difficulty}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default TargetInfoPanel
