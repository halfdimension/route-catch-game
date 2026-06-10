import GameMap from './components/GameMap'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import { usePlayerState } from './hooks/usePlayerState'

function App() {
  const {
    playerPosition,
    pendingDestination,
    routeCoordinates,
    routeError,
    isRouteLoading,
    setPendingDestination,
    clearPendingDestination,
    confirmPendingMove,
  } = usePlayerState()

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={playerPosition}
        pendingDestination={pendingDestination}
        routeCoordinates={routeCoordinates}
        onMapClick={setPendingDestination}
      />

      {routeError && <div className="route-status route-error">{routeError}</div>}

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
