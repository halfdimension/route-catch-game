import { useState } from 'react'
import { getRarityClassName } from '../utils/rarityStyles'

function CaughtInventoryPanel({ caughtTargets }) {
  const [isCollapsed, setIsCollapsed] = useState(caughtTargets.length === 0)
  const recentCaughtTargets = caughtTargets.slice(0, 3)

  return (
    <section
      className={`caught-inventory-panel${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label="Caught inventory"
    >
      <button
        type="button"
        className="caught-inventory-toggle"
        onClick={() => setIsCollapsed((currentValue) => !currentValue)}
        aria-expanded={!isCollapsed}
      >
        <span>Recent Catches</span>
        <span>{caughtTargets.length}</span>
        <span>{isCollapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!isCollapsed && (
        <div className="caught-inventory-content">
          {caughtTargets.length === 0 ? (
            <span>No catches yet</span>
          ) : (
            <ul>
              {recentCaughtTargets.map((target) => {
                const rarityClassName = getRarityClassName(target.rarity)

                return (
                  <li
                    key={`${target.id}-${target.caughtAt}`}
                    className={rarityClassName}
                  >
                    <strong>
                      <span className="creature-symbol">{target.symbol}</span>
                      {target.name}
                    </strong>
                    <span className="caught-inventory-meta">
                      <span>+{target.score}</span>
                      <span className={`rarity-badge ${rarityClassName}`}>
                        {target.rarity}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export default CaughtInventoryPanel
