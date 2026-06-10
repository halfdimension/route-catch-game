import GameMap from './components/GameMap'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import { usePlayerState } from './hooks/usePlayerState'

function App() {
  const {
    playerPosition,
    pendingDestination,
    setPendingDestination,
    clearPendingDestination,
    confirmPendingMove,
  } = usePlayerState()

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={playerPosition}
        pendingDestination={pendingDestination}
        onMapClick={setPendingDestination}
      />

      {pendingDestination && (
        <MoveConfirmPanel
          destination={pendingDestination}
          onConfirm={confirmPendingMove}
          onCancel={clearPendingDestination}
        />
      )}
    </main>
  )
}

export default App
