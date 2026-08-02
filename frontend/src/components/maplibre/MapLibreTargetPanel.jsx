import { useState } from 'react'
import {
  getNonChasedMapLibreTargets,
  getMapLibreTargetViewState,
  handleMapLibreHudCancelChase,
  handleMapLibreHudTargetClick,
} from './mapLibreGameHudState'

function MapLibreTargetPanel({
  targets,
  chasedTargetId,
  routingTargetId,
  onTargetClick,
  onCancelChase,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const chasedTarget = targets.find((target) => target.id === chasedTargetId)
  const remainingTargets = getNonChasedMapLibreTargets(
    targets,
    chasedTargetId,
  )
  const chasedTargetViewState = chasedTarget
    ? getMapLibreTargetViewState(
        chasedTarget,
        chasedTargetId,
        routingTargetId,
      )
    : null

  return (
    <section
      className={`maplibre-hud-panel maplibre-target-panel maplibre-hud-interactive${
        isCollapsed ? ' is-collapsed' : ''
      }`}
      aria-label="Nearby creatures"
    >
      <header className="maplibre-target-panel-header">
        <div>
          <span className="maplibre-hud-eyebrow">Field signals</span>
          <strong>Nearby creatures</strong>
        </div>
        <span className="maplibre-target-count" aria-label={`${targets.length} creatures`}>
          <span
            key={`targets-${targets.length}`}
            className="maplibre-hud-value-feedback"
          >
            {targets.length}
          </span>
        </span>
        <button
          type="button"
          className="maplibre-target-collapse"
          onClick={() => setIsCollapsed((currentValue) => !currentValue)}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} target panel`}
        >
          <span aria-hidden="true">{isCollapsed ? '＋' : '−'}</span>
        </button>
      </header>

      {!isCollapsed && (
        <div className="maplibre-target-panel-content">
          {chasedTarget && (
            <article
              className={`maplibre-active-target ${chasedTargetViewState.rarityClassName}`}
              aria-label={`Active target: ${chasedTarget.name}`}
            >
              <span className="maplibre-target-card-symbol" aria-hidden="true">
                {chasedTarget.symbol}
              </span>
              <span className="maplibre-target-card-copy">
                <span className="maplibre-active-target-state">
                  {chasedTargetViewState.isRouting
                    ? 'Plotting route'
                    : 'Chase active'}
                </span>
                <strong>{chasedTarget.name}</strong>
                <span>
                  <span className={`maplibre-rarity ${chasedTargetViewState.rarityClassName}`}>
                    {chasedTarget.rarity}
                  </span>
                  <span>{chasedTargetViewState.remainingSeconds}s left</span>
                </span>
              </span>
              <span className="maplibre-active-target-actions">
                <strong>+{chasedTarget.score}</strong>
                <button
                  type="button"
                  onClick={(event) =>
                    handleMapLibreHudCancelChase(event, onCancelChase)
                  }
                >
                  Cancel chase
                </button>
              </span>
            </article>
          )}

          {targets.length === 0 ? (
            <p className="maplibre-target-empty">Scanning nearby streets…</p>
          ) : remainingTargets.length > 0 ? (
            <ul className="maplibre-target-list">
              {remainingTargets.map((target) => {
                const viewState = getMapLibreTargetViewState(
                  target,
                  chasedTargetId,
                  routingTargetId,
                )

                return (
                  <li key={target.id}>
                    <button
                      type="button"
                      className={`maplibre-target-card ${viewState.rarityClassName}${
                        viewState.isChased ? ' is-chased' : ''
                      }${viewState.isRouting ? ' is-routing' : ''}`}
                      onClick={(event) =>
                        handleMapLibreHudTargetClick(
                          event,
                          target,
                          onTargetClick,
                        )
                      }
                      disabled={viewState.isRouting}
                      aria-pressed={viewState.isChased}
                    >
                      <span className="maplibre-target-card-symbol" aria-hidden="true">
                        {target.symbol}
                      </span>
                      <span className="maplibre-target-card-copy">
                        <strong>{target.name}</strong>
                        <span>
                          <span className={`maplibre-rarity ${viewState.rarityClassName}`}>
                            {target.rarity}
                          </span>
                          <span>{viewState.statusLabel}</span>
                        </span>
                      </span>
                      <span className="maplibre-target-card-stats">
                        <strong>+{target.score}</strong>
                        <span>{viewState.remainingSeconds}s</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  )
}

export default MapLibreTargetPanel
