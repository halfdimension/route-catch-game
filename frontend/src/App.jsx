import { useCallback, useEffect, useRef, useState } from 'react'
import CatchToast from './components/CatchToast'
import CaughtInventoryPanel from './components/CaughtInventoryPanel'
import GameControlsPanel from './components/GameControlsPanel'
import GameSessionPanel from './components/GameSessionPanel'
import GameMap from './components/GameMap'
import MovementStatusPanel from './components/MovementStatusPanel'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import PlayerHudPanel from './components/PlayerHudPanel'
import RoundSummaryPanel from './components/RoundSummaryPanel'
import StatsDrawer from './components/StatsDrawer'
import TargetInfoPanel from './components/TargetInfoPanel'
import { MAX_SIMULATION_SPEED } from './config/gameConfig'
import { useBackendGameSession } from './hooks/useBackendGameSession'
import { useCatchDetection } from './hooks/useCatchDetection'
import { useGameSession } from './hooks/useGameSession'
import { usePlayerProgression } from './hooks/usePlayerProgression'
import { usePlayerState } from './hooks/usePlayerState'
import { useTargetSpawner } from './hooks/useTargetSpawner'
import { playCatchSound } from './utils/soundEffects'

const TARGET_EXPIRED_MESSAGE = 'Target expired'

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
    showRouteMessage,
    clearPendingDestination,
    confirmPendingMove,
    moveToDestination,
    resetPlayerState,
    stopPlayerMovement,
  } = usePlayerState()
  const {
    gameState,
    remainingSeconds,
    selectedRoundSeconds,
    roundDurationOptions,
    setSelectedRoundSeconds,
    startGame,
    endGame,
    restartGame: restartGameSession,
    resetGameSession,
  } = useGameSession()
  const {
    backendSession,
    backendScore,
    backendCaughtCount,
    sessionNotice,
    catchSubmissionWarning,
    isSessionPending,
    beginSession,
    finishSession,
    replaceSession,
    submitBackendCatch,
  } = useBackendGameSession()
  const {
    xp,
    level,
    nextLevelXp,
    speedBonus,
    addXp,
    resetProgression,
  } = usePlayerProgression()
  const {
    targets,
    isSpawningPaused,
    removeTarget,
    clearTargets,
    toggleSpawning,
  } = useTargetSpawner(
    playerPosition,
    simulationSpeed,
    gameState === 'running',
    level,
  )
  const [caughtTargets, setCaughtTargets] = useState([])
  const [score, setScore] = useState(0)
  const [catchToastTarget, setCatchToastTarget] = useState(null)
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0)
  const previousGameStateRef = useRef(gameState)
  const targetsRef = useRef(targets)

  useEffect(() => {
    targetsRef.current = targets
  }, [targets])

  const handleCatchTarget = useCallback(
    (target) => {
      removeTarget(target.id)
      setCaughtTargets((currentCaughtTargets) => [
        { ...target, caughtAt: Date.now() },
        ...currentCaughtTargets,
      ])
      setScore((currentScore) => currentScore + target.score)
      addXp(target.score)
      setCatchToastTarget(target)
      playCatchSound(target.rarity)

      void submitBackendCatch(target.creatureId).then((response) => {
        if (response) {
          setHistoryRefreshVersion((version) => version + 1)
        }
      })
    },
    [addXp, removeTarget, submitBackendCatch],
  )

  useCatchDetection({
    playerPosition,
    targets,
    isMoving,
    onCatchTarget: handleCatchTarget,
  })

  useEffect(() => {
    if (!catchToastTarget) {
      return undefined
    }

    const timerId = setTimeout(() => {
      setCatchToastTarget(null)
    }, 1500)

    return () => clearTimeout(timerId)
  }, [catchToastTarget])

  useEffect(() => {
    const previousGameState = previousGameStateRef.current
    previousGameStateRef.current = gameState

    if (gameState !== 'ended' || previousGameState === 'ended') {
      return
    }

    clearTargets()
    stopPlayerMovement()
    void finishSession(
      'Round ended locally, but the backend session could not be closed.',
    ).then((didEndSession) => {
      if (didEndSession) {
        setHistoryRefreshVersion((version) => version + 1)
      }
    })
  }, [clearTargets, finishSession, gameState, stopPlayerMovement])

  function resetScore() {
    setCaughtTargets([])
    setScore(0)
    setCatchToastTarget(null)
  }

  function resetPlayer() {
    resetPlayerState()
  }

  function resetGame() {
    void finishSession()
    resetPlayerState()
    clearTargets()
    resetScore()
    resetProgression()
    resetGameSession()
  }

  async function handleStartGame() {
    const didStartBackendSession = await beginSession(selectedRoundSeconds)

    if (didStartBackendSession) {
      startGame()
      setHistoryRefreshVersion((version) => version + 1)
    }
  }

  async function handleEndGame() {
    const didEndBackendSession = await finishSession()
    endGame()

    if (didEndBackendSession) {
      setHistoryRefreshVersion((version) => version + 1)
    }
  }

  async function restartGame() {
    const didStartBackendSession = await replaceSession(selectedRoundSeconds)

    if (!didStartBackendSession) {
      return
    }

    resetPlayerState()
    clearTargets()
    resetScore()
    resetProgression()
    restartGameSession()
    setHistoryRefreshVersion((version) => version + 1)
  }

  function handleMapClick(destination) {
    setPendingDestination(destination)
  }

  const isTargetActive = useCallback((targetId) => {
    return targetsRef.current.some(
      (currentTarget) =>
        currentTarget.id === targetId && currentTarget.expiresAt > Date.now(),
    )
  }, [])

  const handleTargetClick = useCallback(
    async (target) => {
      if (!isTargetActive(target.id)) {
        showRouteMessage(TARGET_EXPIRED_MESSAGE)
        return
      }

      clearPendingDestination()
      await moveToDestination(
        {
          lat: target.lat,
          lon: target.lon,
        },
        {
          blockedMessage: TARGET_EXPIRED_MESSAGE,
          shouldStart: () => isTargetActive(target.id),
        },
      )
    },
    [clearPendingDestination, isTargetActive, moveToDestination, showRouteMessage],
  )

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
      <PlayerHudPanel
        score={score}
        caughtCount={caughtTargets.length}
        level={level}
        xp={xp}
        nextLevelXp={nextLevelXp}
        gameState={gameState}
        remainingSeconds={remainingSeconds}
        selectedRoundSeconds={selectedRoundSeconds}
      />
      <CatchToast caughtTarget={catchToastTarget} />
      <GameSessionPanel
        gameState={gameState}
        selectedRoundSeconds={selectedRoundSeconds}
        roundDurationOptions={roundDurationOptions}
        onRoundDurationChange={setSelectedRoundSeconds}
        onStartGame={handleStartGame}
        onEndGame={handleEndGame}
        backendSession={backendSession}
        backendScore={backendScore}
        backendCaughtCount={backendCaughtCount}
        sessionNotice={sessionNotice}
        catchSubmissionWarning={catchSubmissionWarning}
        isSessionPending={isSessionPending}
      />
      <GameControlsPanel
        gameState={gameState}
        isSpawningPaused={isSpawningPaused}
        simulationSpeed={simulationSpeed}
        onToggleSpawning={toggleSpawning}
        onClearTargets={clearTargets}
        onResetScore={resetScore}
        onResetPlayer={resetPlayer}
        onResetGame={resetGame}
        onSimulationSpeedChange={setSimulationSpeed}
        maxSimulationSpeed={MAX_SIMULATION_SPEED + speedBonus}
      />
      <TargetInfoPanel targets={targets} onTargetClick={handleTargetClick} />
      <CaughtInventoryPanel caughtTargets={caughtTargets} />
      <StatsDrawer
        activeSessionId={backendSession?.sessionId}
        refreshVersion={historyRefreshVersion}
      />

      {gameState === 'ended' && (
        <RoundSummaryPanel
          score={score}
          caughtTargets={caughtTargets}
          level={level}
          onRestartGame={restartGame}
          isRestarting={isSessionPending}
        />
      )}

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
