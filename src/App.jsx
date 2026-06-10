import { useState } from 'react'
import GameMap from './components/GameMap'
import MovementStatusPanel from './components/MovementStatusPanel'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import TargetConfirmPanel from './components/TargetConfirmPanel'
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
    moveToDestination,
  } = usePlayerState()
  const { targets } = useTargetSpawner(playerPosition)
  const [pendingTarget, setPendingTarget] = useState(null)
  const activePendingTarget = pendingTarget
    ? targets.find((target) => target.id === pendingTarget.id)
    : null

  function handleMapClick(destination) {
    setPendingTarget(null)
    setPendingDestination(destination)
  }

  function handleTargetClick(target) {
    clearPendingDestination()
    setPendingTarget(target)
  }

  async function confirmPendingTargetMove() {
    if (!activePendingTarget) {
      return
    }

    const didStartMoving = await moveToDestination({
      lat: activePendingTarget.lat,
      lon: activePendingTarget.lon,
    })

    if (didStartMoving) {
      setPendingTarget(null)
    }
  }

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={playerPosition}
        pendingDestination={pendingDestination}
        routeCoordinates={routeCoordinates}
        targets={targets}
        onMapClick={handleMapClick}
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

      {activePendingTarget && (
        <TargetConfirmPanel
          target={activePendingTarget}
          onConfirm={confirmPendingTargetMove}
          onCancel={() => setPendingTarget(null)}
          isLoading={isRouteLoading}
        />
      )}
    </main>
  )
}

export default App
