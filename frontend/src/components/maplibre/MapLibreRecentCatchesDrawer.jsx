import { getRarityClassName } from '../../utils/rarityStyles'

function MapLibreRecentCatchesDrawer({ caughtTargets, onClose }) {
  const recentCaughtTargets = caughtTargets.slice(0, 3)

  return (
    <section
      id="maplibre-recent-catches-drawer"
      className="maplibre-hud-panel maplibre-recent-catches maplibre-hud-interactive"
      aria-label="Recent catches"
    >
      <header>
        <div>
          <span className="maplibre-hud-eyebrow">Collection log</span>
          <strong>Recent catches</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close recent catches">
          Close
        </button>
      </header>

      <div className="maplibre-recent-catches-content">
        {recentCaughtTargets.length === 0 ? (
          <p>No catches yet</p>
        ) : (
          <ul>
            {recentCaughtTargets.map((target) => {
              const rarityClassName = getRarityClassName(target.rarity)

              return (
                <li
                  key={`${target.id}-${target.caughtAt}`}
                  className={rarityClassName}
                >
                  <span className="maplibre-recent-catch-symbol" aria-hidden="true">
                    {target.symbol}
                  </span>
                  <span>
                    <strong>{target.name}</strong>
                    <small className={`maplibre-rarity ${rarityClassName}`}>
                      {target.rarity}
                    </small>
                  </span>
                  <strong>+{target.score}</strong>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

export default MapLibreRecentCatchesDrawer
