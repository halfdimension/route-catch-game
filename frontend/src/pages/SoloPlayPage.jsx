import { lazy, Suspense } from 'react'
import CatchToast from '../components/CatchToast'
import CaughtInventoryPanel from '../components/CaughtInventoryPanel'
import GameControlsPanel from '../components/GameControlsPanel'
import GameMap from '../components/GameMap'
import GameSessionPanel from '../components/GameSessionPanel'
import MapLibreGameHud from '../components/maplibre/MapLibreGameHud'
import MapLibreMapErrorBoundary from '../components/maplibre/MapLibreMapErrorBoundary'
import MovementStatusPanel from '../components/MovementStatusPanel'
import MoveConfirmPanel from '../components/MoveConfirmPanel'
import PlayerHudPanel from '../components/PlayerHudPanel'
import RoundSummaryPanel from '../components/RoundSummaryPanel'
import TargetInfoPanel from '../components/TargetInfoPanel'
import { MAX_SIMULATION_SPEED } from '../config/gameConfig'
import {
  SOLO_MAP_RENDERER,
  SOLO_MAP_RENDERERS,
} from '../config/soloMapRenderer'

const MapLibreSoloGameMap = lazy(
  () => import('../components/maplibre/MapLibreSoloGameMap'),
)

function SoloPlayPage({ gameplay }) {
  const isMapLibreExperience =
    SOLO_MAP_RENDERER === SOLO_MAP_RENDERERS.MAPLIBRE
  const soloMapProps = {
    playerPosition: gameplay.playerPosition,
    pendingDestination: gameplay.pendingDestination,
    routeCoordinates: gameplay.routeCoordinates,
    targets: gameplay.targets,
    caughtTarget: gameplay.catchToastTarget,
    chasedTargetId: gameplay.chasedTargetId,
    routingTargetId: gameplay.routingTargetId,
    playerName: gameplay.effectivePlayerName,
    onMapClick: gameplay.handleMapClick,
    onTargetClick: gameplay.handleTargetClick,
  }

  return (
    <main
      className={`game-shell${
        isMapLibreExperience ? ' is-maplibre-experience' : ''
      }`}
    >
      {isMapLibreExperience ? (
        <MapLibreMapErrorBoundary>
          <Suspense
            fallback={(
              <div
                className="game-map maplibre-solo-load-fallback"
                role="status"
              >
                Loading MapLibre renderer…
              </div>
            )}
          >
            <MapLibreSoloGameMap {...soloMapProps} />
          </Suspense>
        </MapLibreMapErrorBoundary>
      ) : (
        <GameMap
          {...soloMapProps}
          sharedRoomCreatures={[]}
          chasedSharedRoomCreatureId={null}
          routingSharedRoomCreatureId={null}
          otherPlayers={[]}
          onSharedRoomCreatureCatch={
            gameplay.handleSharedRoomCreatureCatch
          }
        />
      )}

      {gameplay.routeError && (
        isMapLibreExperience ? (
          <div
            className="maplibre-game-toast is-error"
            role="alert"
          >
            {gameplay.routeError}
          </div>
        ) : (
          <div className="route-status route-error">{gameplay.routeError}</div>
        )
      )}

      <CatchToast caughtTarget={gameplay.catchToastTarget} />

      {isMapLibreExperience ? (
        <MapLibreGameHud gameplay={gameplay} />
      ) : (
        <>
          <MovementStatusPanel
            isMoving={gameplay.isMoving}
            simulationSpeed={gameplay.simulationSpeed}
          />
          <PlayerHudPanel
            score={gameplay.score}
            caughtCount={gameplay.caughtTargets.length}
            level={gameplay.level}
            xp={gameplay.xp}
            nextLevelXp={gameplay.nextLevelXp}
            gameState={gameplay.gameState}
            remainingSeconds={gameplay.remainingSeconds}
            selectedRoundSeconds={gameplay.selectedRoundSeconds}
            playerName={gameplay.effectivePlayerName}
          />
          <div className="gameplay-setup-stack">
            <GameSessionPanel
              gameState={gameplay.gameState}
              selectedRoundSeconds={gameplay.selectedRoundSeconds}
              roundDurationOptions={gameplay.roundDurationOptions}
              onRoundDurationChange={gameplay.setSelectedRoundSeconds}
              playerName={gameplay.playerName}
              onPlayerNameChange={gameplay.setPlayerName}
              onStartGame={gameplay.handleStartGame}
              onEndGame={gameplay.handleEndGame}
              backendSession={gameplay.backendSession}
              backendScore={gameplay.backendScore}
              backendCaughtCount={gameplay.backendCaughtCount}
              sessionNotice={gameplay.sessionNotice}
              catchSubmissionWarning={gameplay.catchSubmissionWarning}
              isSessionPending={gameplay.isSessionPending}
              isAuthenticated={gameplay.isAuthenticated}
              authenticatedDisplayName={gameplay.currentUser?.displayName}
            />
            <GameControlsPanel
              isSpawningPaused={gameplay.isSpawningPaused}
              simulationSpeed={gameplay.simulationSpeed}
              onToggleSpawning={gameplay.toggleSpawning}
              onClearTargets={gameplay.clearTargets}
              onResetScore={gameplay.resetScore}
              onResetPlayer={gameplay.resetPlayer}
              onResetGame={gameplay.resetGame}
              onSimulationSpeedChange={gameplay.setSimulationSpeed}
              maxSimulationSpeed={MAX_SIMULATION_SPEED + gameplay.speedBonus}
            />
          </div>
          <TargetInfoPanel
            targets={gameplay.targets}
            onTargetClick={gameplay.handleTargetClick}
            chasedTargetId={gameplay.chasedTargetId}
            routingTargetId={gameplay.routingTargetId}
            onCancelChase={gameplay.handleCancelChase}
          />
          <CaughtInventoryPanel caughtTargets={gameplay.caughtTargets} />
        </>
      )}

      {gameplay.gameState === 'ended' && (
        <RoundSummaryPanel
          score={gameplay.score}
          caughtTargets={gameplay.caughtTargets}
          level={gameplay.level}
          onRestartGame={gameplay.restartGame}
          isRestarting={gameplay.isSessionPending}
        />
      )}

      {!isMapLibreExperience && gameplay.pendingDestination && (
        <MoveConfirmPanel
          destination={gameplay.pendingDestination}
          onConfirm={gameplay.handleConfirmPendingMove}
          onCancel={gameplay.clearPendingDestination}
          isLoading={gameplay.isRouteLoading}
        />
      )}
    </main>
  )
}

export default SoloPlayPage
