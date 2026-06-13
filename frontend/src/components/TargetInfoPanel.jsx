import { getRarityClassName } from '../utils/rarityStyles'

function getRemainingSeconds(target) {
  return Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000))
}

function TargetInfoPanel({
  targets,
  onTargetClick,
  chasedTargetId,
  routingTargetId,
  onCancelChase,
}) {
  const chasedTarget = targets.find((target) => target.id === chasedTargetId)

  return (
    <section className="target-info-panel" aria-label="Active targets">
      <div className="target-info-header">
        <p>Targets</p>
        {chasedTarget && (
          <button type="button" onClick={onCancelChase}>
            Cancel chase
          </button>
        )}
      </div>
      {chasedTarget && (
        <div className="target-chase-status" role="status">
          <span>{chasedTarget.symbol}</span>
          <strong>
            {routingTargetId === chasedTarget.id ? 'Routing...' : 'Chasing'}
          </strong>
          <span>{chasedTarget.name}</span>
        </div>
      )}
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
                  disabled={routingTargetId === target.id}
                  aria-current={
                    chasedTargetId === target.id ? 'true' : undefined
                  }
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
                  <span className="target-difficulty">
                    {routingTargetId === target.id
                      ? 'Routing...'
                      : chasedTargetId === target.id
                        ? 'Chasing'
                        : target.difficulty}
                  </span>
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
