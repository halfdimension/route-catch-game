import { useState } from 'react'

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
              {recentCaughtTargets.map((target) => (
                <li key={`${target.id}-${target.caughtAt}`}>
                  <strong>
                    <span className="creature-symbol">{target.symbol}</span>
                    {target.name}
                  </strong>
                  <span>
                    +{target.score} · {target.rarity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export default CaughtInventoryPanel
