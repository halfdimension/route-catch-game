import GameMap from './components/GameMap'
import MovementStatusPanel from './components/MovementStatusPanel'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import TargetInfoPanel from './components/TargetInfoPanel'
import { usePlayerState } from './hooks/usePlayerState'
import { useTargetSpawner } from './hooks/useTargetSpawner'

function App() {
  const {
    playerPosition,
    pendingDestination,
    routeCoordinates,
    routeError,
    isRouteLoading,
    isMoving,
    simulationSpeed,
    setPendingDestination,
    clearPendingDestination,
    confirmPendingMove,
  } = usePlayerState()
  const { targets } = useTargetSpawner(playerPosition)

  function handleTargetClick(target) {
    console.log('Target clicked:', target)
  }

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={playerPosition}
        pendingDestination={pendingDestination}
        routeCoordinates={routeCoordinates}
        targets={targets}
        onMapClick={setPendingDestination}
        onTargetClick={handleTargetClick}
      />

      {routeError && <div className="route-status route-error">{routeError}</div>}

      <MovementStatusPanel
        isMoving={isMoving}
        simulationSpeed={simulationSpeed}
      />
      <TargetInfoPanel targets={targets} />

      {pendingDestination && (
        <MoveConfirmPanel
          destination={pendingDestination}
          onConfirm={confirmPendingMove}
          onCancel={clearPendingDestination}
          isLoading={isRouteLoading}
        />
      )}
    </main>
  )
}

export default App
