import { useState } from 'react'
import MapLibreDevelopmentControls from './MapLibreDevelopmentControls'
import MapLibreDestinationSheet from './MapLibreDestinationSheet'
import {
  getMapLibreRoundViewState,
  MAPLIBRE_DEBUG_CONTROLS_ENABLED,
  stopMapLibreHudEvent,
} from './mapLibreGameHudState'
import MapLibreRecentCatchesDrawer from './MapLibreRecentCatchesDrawer'
import MapLibreSessionControls from './MapLibreSessionControls'
import MapLibreTargetPanel from './MapLibreTargetPanel'

function getPlayerInitial(playerName) {
  return playerName?.trim().charAt(0).toUpperCase() || 'G'
}

export function MapLibrePlayerStatus({
  playerName,
  isMoving,
  simulationSpeed,
  caughtCount,
  level,
  isRecentCatchesOpen,
  onToggleRecentCatches,
}) {
  const displayName = playerName?.trim() || 'Guest'

  return (
    <section className="maplibre-hud-panel maplibre-player-status maplibre-hud-interactive" aria-label="Player status">
      <span className="maplibre-player-avatar" aria-hidden="true">
        {getPlayerInitial(displayName)}
      </span>
      <span className="maplibre-player-copy">
        <strong>{displayName}</strong>
        <span>
          <i className={isMoving ? 'is-moving' : ''} aria-hidden="true" />
          {isMoving ? `Moving · ${simulationSpeed} m/s` : 'Standing by'}
        </span>
      </span>
      <span className="maplibre-player-level">
        <small>LVL</small>
        <strong>{level}</strong>
      </span>
      <button
        type="button"
        className="maplibre-player-catches"
        onClick={onToggleRecentCatches}
        aria-expanded={isRecentCatchesOpen}
        aria-controls="maplibre-recent-catches-drawer"
      >
        <span
          key={`caught-${caughtCount}`}
          className="maplibre-hud-value-feedback"
        >
          {caughtCount} caught
        </span>
        <span aria-hidden="true">{isRecentCatchesOpen ? '−' : '＋'}</span>
      </button>
    </section>
  )
}

export function MapLibreRoundStatus({
  gameState,
  remainingSeconds,
  selectedRoundSeconds,
  score,
}) {
  const viewState = getMapLibreRoundViewState({
    gameState,
    remainingSeconds,
    selectedRoundSeconds,
  })

  return (
    <section
      className={`maplibre-hud-panel maplibre-round-status${
        viewState.isWarning ? ' is-warning' : ''
      }`}
      aria-label="Round status"
    >
      <span className="maplibre-round-state">{viewState.stateLabel}</span>
      <strong className="maplibre-round-time">{viewState.timeLabel}</strong>
      <span className="maplibre-round-score">
        <small>Score</small>
        <strong
          key={`score-${score}`}
          className="maplibre-hud-value-feedback"
        >
          {score}
        </strong>
      </span>
    </section>
  )
}

function MapLibreGameHud({ gameplay }) {
  const [isRecentCatchesOpen, setIsRecentCatchesOpen] = useState(false)
  const chasedTarget = gameplay.targets.find(
    (target) => target.id === gameplay.chasedTargetId,
  )

  return (
    <div
      className="maplibre-game-hud"
      onClick={stopMapLibreHudEvent}
      onPointerDown={stopMapLibreHudEvent}
    >
      <MapLibrePlayerStatus
        playerName={gameplay.effectivePlayerName}
        isMoving={gameplay.isMoving}
        simulationSpeed={gameplay.simulationSpeed}
        caughtCount={gameplay.caughtTargets.length}
        level={gameplay.level}
        isRecentCatchesOpen={isRecentCatchesOpen}
        onToggleRecentCatches={() =>
          setIsRecentCatchesOpen((currentValue) => !currentValue)
        }
      />
      <MapLibreRoundStatus
        gameState={gameplay.gameState}
        remainingSeconds={gameplay.remainingSeconds}
        selectedRoundSeconds={gameplay.selectedRoundSeconds}
        score={gameplay.score}
      />
      <MapLibreTargetPanel
        targets={gameplay.targets}
        chasedTargetId={gameplay.chasedTargetId}
        routingTargetId={gameplay.routingTargetId}
        onTargetClick={gameplay.handleTargetClick}
        onCancelChase={gameplay.handleCancelChase}
      />

      <div className="maplibre-left-rail">
        <MapLibreSessionControls gameplay={gameplay} />
        {isRecentCatchesOpen && (
          <MapLibreRecentCatchesDrawer
            caughtTargets={gameplay.caughtTargets}
            onClose={() => setIsRecentCatchesOpen(false)}
          />
        )}
        {MAPLIBRE_DEBUG_CONTROLS_ENABLED && (
          <MapLibreDevelopmentControls gameplay={gameplay} />
        )}
      </div>

      {gameplay.pendingDestination && (
        <MapLibreDestinationSheet
          destination={gameplay.pendingDestination}
          chasedTarget={chasedTarget}
          isLoading={gameplay.isRouteLoading}
          onConfirm={gameplay.handleConfirmPendingMove}
          onCancel={gameplay.clearPendingDestination}
        />
      )}
    </div>
  )
}

export default MapLibreGameHud
