import { useCallback, useEffect, useRef, useState } from 'react'
import CaughtInventoryPanel from './components/CaughtInventoryPanel'
import GameControlsPanel from './components/GameControlsPanel'
import GameSessionPanel from './components/GameSessionPanel'
import GameMap from './components/GameMap'
import MovementStatusPanel from './components/MovementStatusPanel'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import ScorePanel from './components/ScorePanel'
import TargetConfirmPanel from './components/TargetConfirmPanel'
import TargetInfoPanel from './components/TargetInfoPanel'
import { useCatchDetection } from './hooks/useCatchDetection'
import { useGameSession } from './hooks/useGameSession'
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
    setSimulationSpeed,
    setPendingDestination,
    clearPendingDestination,
    confirmPendingMove,
    moveToDestination,
    resetPlayerState,
    stopPlayerMovement,
  } = usePlayerState()
  const {
    gameState,
    remainingSeconds,
    startGame,
    endGame,
    restartGame: restartGameSession,
    resetGameSession,
  } = useGameSession()
  const {
    targets,
    isSpawningPaused,
    removeTarget,
    clearTargets,
    toggleSpawning,
  } = useTargetSpawner(playerPosition, simulationSpeed, gameState === 'running')
  const [pendingTarget, setPendingTarget] = useState(null)
  const [caughtTargets, setCaughtTargets] = useState([])
  const [score, setScore] = useState(0)
  const [caughtNotice, setCaughtNotice] = useState('')
  const previousGameStateRef = useRef(gameState)
  const activePendingTarget = pendingTarget
    ? targets.find((target) => target.id === pendingTarget.id)
    : null
  const lastCaughtTarget = caughtTargets[0]

  const handleCatchTarget = useCallback(
    (target) => {
      removeTarget(target.id)
      setPendingTarget((currentTarget) =>
        currentTarget?.id === target.id ? null : currentTarget,
      )
      setCaughtTargets((currentCaughtTargets) => [
        { ...target, caughtAt: Date.now() },
        ...currentCaughtTargets,
      ])
      setScore((currentScore) => currentScore + target.score)
      setCaughtNotice(`Caught ${target.name}!`)
    },
    [removeTarget],
  )

  useCatchDetection({
    playerPosition,
    targets,
    isMoving,
    onCatchTarget: handleCatchTarget,
  })

  useEffect(() => {
    if (!caughtNotice) {
      return undefined
    }

    const timerId = setTimeout(() => {
      setCaughtNotice('')
    }, 2500)

    return () => clearTimeout(timerId)
  }, [caughtNotice])

  useEffect(() => {
    const previousGameState = previousGameStateRef.current
    previousGameStateRef.current = gameState

    if (gameState !== 'ended' || previousGameState === 'ended') {
      return
    }

    setPendingTarget(null)
    clearTargets()
    stopPlayerMovement()
  }, [clearTargets, gameState, stopPlayerMovement])

  function resetScore() {
    setCaughtTargets([])
    setScore(0)
    setCaughtNotice('')
  }

  function resetPlayer() {
    setPendingTarget(null)
    resetPlayerState()
  }

  function resetGame() {
    setPendingTarget(null)
    resetPlayerState()
    clearTargets()
    resetScore()
    resetGameSession()
  }

  function restartGame() {
    setPendingTarget(null)
    resetPlayerState()
    clearTargets()
    resetScore()
    restartGameSession()
  }

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
      <ScorePanel
        score={score}
        caughtCount={caughtTargets.length}
        lastCaughtName={lastCaughtTarget?.name}
        caughtNotice={caughtNotice}
      />
      <GameSessionPanel
        gameState={gameState}
        remainingSeconds={remainingSeconds}
        onStartGame={startGame}
        onEndGame={endGame}
        onRestartGame={restartGame}
      />
      <GameControlsPanel
        isSpawningPaused={isSpawningPaused}
        simulationSpeed={simulationSpeed}
        onToggleSpawning={toggleSpawning}
        onClearTargets={clearTargets}
        onResetScore={resetScore}
        onResetPlayer={resetPlayer}
        onResetGame={resetGame}
        onSimulationSpeedChange={setSimulationSpeed}
      />
      <TargetInfoPanel targets={targets} />
      <CaughtInventoryPanel caughtTargets={caughtTargets} />

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
