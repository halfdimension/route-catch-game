import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuthPanel from './components/AuthPanel'
import CatchToast from './components/CatchToast'
import CaughtInventoryPanel from './components/CaughtInventoryPanel'
import GameControlsPanel from './components/GameControlsPanel'
import GameSessionPanel from './components/GameSessionPanel'
import GameMap from './components/GameMap'
import MovementStatusPanel from './components/MovementStatusPanel'
import MoveConfirmPanel from './components/MoveConfirmPanel'
import MultiplayerPanel from './components/MultiplayerPanel'
import PlayerHudPanel from './components/PlayerHudPanel'
import RoundSummaryPanel from './components/RoundSummaryPanel'
import StatsDrawer from './components/StatsDrawer'
import TargetInfoPanel from './components/TargetInfoPanel'
import { MAX_SIMULATION_SPEED } from './config/gameConfig'
import { useAuth } from './context/authContextCore'
import {
  catchRoomCreature,
  listRoomCreatures,
} from './api/multiplayerRoomClient'
import { useBackendGameSession } from './hooks/useBackendGameSession'
import { useCatchDetection } from './hooks/useCatchDetection'
import { useGameSession } from './hooks/useGameSession'
import { useMultiplayerPresence } from './hooks/useMultiplayerPresence'
import { usePlayerProgression } from './hooks/usePlayerProgression'
import { usePlayerName } from './hooks/usePlayerName'
import { usePlayerState } from './hooks/usePlayerState'
import { useTargetSpawner } from './hooks/useTargetSpawner'
import { playCatchSound } from './utils/soundEffects'

const TARGET_EXPIRED_MESSAGE = 'Target expired'

const ROOM_CREATURE_CATCH_ERROR_MESSAGES = {
  ROOM_CREATURE_TOO_FAR: 'Too far from this creature.',
  ROOM_CREATURE_ALREADY_CAUGHT: 'Already caught by another player.',
  ROOM_CREATURE_EXPIRED: 'Creature expired.',
  ROOM_GAME_NOT_RUNNING: 'Room game is not running.',
}

function App() {
  const {
    currentUser,
    token,
    isAuthenticated,
    logout,
  } = useAuth()
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
  } = useBackendGameSession(token)
  const {
    xp,
    level,
    nextLevelXp,
    speedBonus,
    addXp,
    resetProgression,
  } = usePlayerProgression()
  const { playerName, setPlayerName } = usePlayerName()
  const effectivePlayerName =
    isAuthenticated && currentUser?.displayName
      ? currentUser.displayName
      : playerName
  const [chasedTargetId, setChasedTargetId] = useState(null)
  const [routingTargetId, setRoutingTargetId] = useState(null)
  const chasedTargetIdRef = useRef(null)
  const routingTargetIdRef = useRef(null)
  const multiplayerPresenceStatus = chasedTargetId
    ? 'CHASING'
    : isMoving
      ? 'MOVING'
      : 'IDLE'
  const {
    connectionStatus: multiplayerConnectionStatus,
    onlinePlayers,
    errorMessage: multiplayerErrorMessage,
    connectPresence,
    disconnectPresence,
  } = useMultiplayerPresence({
    token,
    currentUser,
    playerPosition,
    status: multiplayerPresenceStatus,
  })
  const otherOnlinePlayers = useMemo(
    () => onlinePlayers.filter((player) => player.userId !== currentUser?.userId),
    [currentUser?.userId, onlinePlayers],
  )

  const updateChasedTargetId = useCallback((targetId) => {
    chasedTargetIdRef.current = targetId
    setChasedTargetId(targetId)
  }, [])

  const updateRoutingTargetId = useCallback((targetId) => {
    routingTargetIdRef.current = targetId
    setRoutingTargetId(targetId)
  }, [])

  const clearChaseState = useCallback(() => {
    updateChasedTargetId(null)
    updateRoutingTargetId(null)
  }, [updateChasedTargetId, updateRoutingTargetId])

  const handleTargetExpired = useCallback(
    (target) => {
      if (chasedTargetIdRef.current !== target.id) {
        return
      }

      stopPlayerMovement()
      clearChaseState()
      showRouteMessage(TARGET_EXPIRED_MESSAGE)
    },
    [clearChaseState, showRouteMessage, stopPlayerMovement],
  )

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
    handleTargetExpired,
  )
  const [caughtTargets, setCaughtTargets] = useState([])
  const [score, setScore] = useState(0)
  const [catchToastTarget, setCatchToastTarget] = useState(null)
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0)
  const [activeMultiplayerRoom, setActiveMultiplayerRoom] = useState(null)
  const [activeRoomGameState, setActiveRoomGameState] = useState(null)
  const [sharedRoomCreatures, setSharedRoomCreatures] = useState([])
  const [sharedRoomCatchMessage, setSharedRoomCatchMessage] = useState(null)
  const previousGameStateRef = useRef(gameState)
  const targetsRef = useRef(targets)
  const activeRoomCode = activeMultiplayerRoom?.roomCode
  const activeRoomGameStatus = activeRoomGameState?.gameStatus

  useEffect(() => {
    targetsRef.current = targets
  }, [targets])

  const handleCatchTarget = useCallback(
    (target) => {
      removeTarget(target.id)
      if (chasedTargetIdRef.current === target.id) {
        stopPlayerMovement()
        clearChaseState()
      }
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
    [
      addXp,
      clearChaseState,
      removeTarget,
      stopPlayerMovement,
      submitBackendCatch,
    ],
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
    if (!sharedRoomCatchMessage) {
      return undefined
    }

    const timerId = window.setTimeout(() => {
      setSharedRoomCatchMessage(null)
    }, 2600)

    return () => window.clearTimeout(timerId)
  }, [sharedRoomCatchMessage])

  useEffect(() => {
    const previousGameState = previousGameStateRef.current
    previousGameStateRef.current = gameState

    if (gameState !== 'ended' || previousGameState === 'ended') {
      return
    }

    clearTargets()
    stopPlayerMovement()
    clearChaseState()
    void finishSession(
      'Round ended locally, but the backend session could not be closed.',
    ).then((didEndSession) => {
      if (didEndSession) {
        setHistoryRefreshVersion((version) => version + 1)
      }
    })
  }, [
    clearChaseState,
    clearTargets,
    finishSession,
    gameState,
    stopPlayerMovement,
  ])

  function resetScore() {
    setCaughtTargets([])
    setScore(0)
    setCatchToastTarget(null)
  }

  function resetPlayer() {
    resetPlayerState()
    clearChaseState()
  }

  function resetGame() {
    void finishSession()
    resetPlayerState()
    clearChaseState()
    clearTargets()
    resetScore()
    resetProgression()
    resetGameSession()
  }

  async function handleStartGame() {
    const didStartBackendSession = await beginSession(
      selectedRoundSeconds,
      effectivePlayerName,
    )

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
    const didStartBackendSession = await replaceSession(
      selectedRoundSeconds,
      effectivePlayerName,
    )

    if (!didStartBackendSession) {
      return
    }

    resetPlayerState()
    clearChaseState()
    clearTargets()
    resetScore()
    resetProgression()
    restartGameSession()
    setHistoryRefreshVersion((version) => version + 1)
  }

  function handleMapClick(destination) {
    setPendingDestination(destination)
  }

  async function handleConfirmPendingMove() {
    clearChaseState()
    await confirmPendingMove()
  }

  function handleCancelChase() {
    stopPlayerMovement()
    clearChaseState()
  }

  const handleMultiplayerRoomContextChange = useCallback((roomContext) => {
    setActiveMultiplayerRoom(roomContext?.activeRoom || null)
    setActiveRoomGameState(roomContext?.gameState || null)
  }, [])

  const refreshSharedRoomCreatures = useCallback(async () => {
    if (
      !isAuthenticated ||
      !token ||
      !activeRoomCode ||
      activeRoomGameStatus !== 'RUNNING'
    ) {
      setSharedRoomCreatures([])
      return []
    }

    try {
      const creatures = await listRoomCreatures(activeRoomCode, token)
      const nextCreatures = Array.isArray(creatures) ? creatures : []
      setSharedRoomCreatures(nextCreatures)
      return nextCreatures
    } catch (error) {
      if (error.status === 401) {
        logout()
      }

      return []
    }
  }, [activeRoomCode, activeRoomGameStatus, isAuthenticated, logout, token])

  const handleSharedRoomCreatureCatch = useCallback(
    async (creature) => {
      const playerLat = Number(playerPosition?.lat)
      const playerLon = Number(playerPosition?.lon)

      if (!Number.isFinite(playerLat) || !Number.isFinite(playerLon)) {
        setSharedRoomCatchMessage({
          type: 'error',
          text: 'Player position unavailable.',
        })
        return
      }

      if (!token || !activeRoomCode || !creature?.instanceId) {
        setSharedRoomCatchMessage({
          type: 'error',
          text: 'Could not catch creature.',
        })
        return
      }

      try {
        const caughtCreature = await catchRoomCreature(
          activeRoomCode,
          creature.instanceId,
          { playerLat, playerLon },
          token,
        )
        const catchName = caughtCreature?.name || creature.name || 'Creature'
        const scoreValue =
          caughtCreature?.scoreValue ?? creature.scoreValue ?? 0

        setSharedRoomCatchMessage({
          type: 'success',
          text: `Caught ${catchName} (+${scoreValue})`,
        })
        await refreshSharedRoomCreatures()
      } catch (error) {
        if (error.status === 401) {
          logout()
        }

        setSharedRoomCatchMessage({
          type: 'error',
          text:
            ROOM_CREATURE_CATCH_ERROR_MESSAGES[error.errorCode] ||
            error.message ||
            'Could not catch creature.',
        })
      }
    },
    [
      activeRoomCode,
      logout,
      playerPosition?.lat,
      playerPosition?.lon,
      refreshSharedRoomCreatures,
      token,
    ],
  )

  useEffect(() => {
    if (
      !isAuthenticated ||
      !token ||
      !activeRoomCode ||
      activeRoomGameStatus !== 'RUNNING'
    ) {
      const timerId = window.setTimeout(() => {
        setSharedRoomCreatures([])
      }, 0)

      return () => window.clearTimeout(timerId)
    }

    let isPolling = true

    const pollSharedCreatures = async () => {
      if (!isPolling) {
        return
      }

      await refreshSharedRoomCreatures()
    }

    void pollSharedCreatures()
    const intervalId = window.setInterval(() => {
      void pollSharedCreatures()
    }, 3000)

    return () => {
      isPolling = false
      window.clearInterval(intervalId)
    }
  }, [
    activeRoomCode,
    activeRoomGameStatus,
    isAuthenticated,
    refreshSharedRoomCreatures,
    token,
  ])

  const isTargetActive = useCallback((targetId) => {
    return targetsRef.current.some(
      (currentTarget) =>
        currentTarget.id === targetId && currentTarget.expiresAt > Date.now(),
    )
  }, [])

  const handleTargetClick = useCallback(
    async (target) => {
      if (
        routingTargetIdRef.current === target.id ||
        chasedTargetIdRef.current === target.id
      ) {
        return
      }

      if (!isTargetActive(target.id)) {
        showRouteMessage(TARGET_EXPIRED_MESSAGE)
        return
      }

      clearPendingDestination()
      updateChasedTargetId(target.id)
      updateRoutingTargetId(target.id)

      const didStartChase = await moveToDestination(
        {
          lat: target.lat,
          lon: target.lon,
        },
        {
          blockedMessage: TARGET_EXPIRED_MESSAGE,
          shouldStart: () => isTargetActive(target.id),
          onComplete: () => {
            if (chasedTargetIdRef.current === target.id) {
              stopPlayerMovement()
              clearChaseState()
            }
          },
        },
      )

      if (routingTargetIdRef.current !== target.id) {
        return
      }

      updateRoutingTargetId(null)

      if (!didStartChase) {
        updateChasedTargetId(null)
      }
    },
    [
      clearPendingDestination,
      isTargetActive,
      moveToDestination,
      showRouteMessage,
      stopPlayerMovement,
      clearChaseState,
      updateChasedTargetId,
      updateRoutingTargetId,
    ],
  )

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={playerPosition}
        pendingDestination={pendingDestination}
        routeCoordinates={routeCoordinates}
        targets={targets}
        sharedRoomCreatures={sharedRoomCreatures}
        caughtTarget={catchToastTarget}
        chasedTargetId={chasedTargetId}
        routingTargetId={routingTargetId}
        playerName={effectivePlayerName}
        otherPlayers={otherOnlinePlayers}
        onMapClick={handleMapClick}
        onTargetClick={handleTargetClick}
        onSharedRoomCreatureCatch={handleSharedRoomCreatureCatch}
      />

      {routeError && <div className="route-status route-error">{routeError}</div>}
      {sharedRoomCatchMessage && (
        <div
          className={`shared-room-catch-status is-${sharedRoomCatchMessage.type}`}
        >
          {sharedRoomCatchMessage.text}
        </div>
      )}

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
        playerName={effectivePlayerName}
      />
      <CatchToast caughtTarget={catchToastTarget} />
      <AuthPanel />
      <div className="gameplay-setup-stack">
        <GameSessionPanel
          gameState={gameState}
          selectedRoundSeconds={selectedRoundSeconds}
          roundDurationOptions={roundDurationOptions}
          onRoundDurationChange={setSelectedRoundSeconds}
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          onStartGame={handleStartGame}
          onEndGame={handleEndGame}
          backendSession={backendSession}
          backendScore={backendScore}
          backendCaughtCount={backendCaughtCount}
          sessionNotice={sessionNotice}
          catchSubmissionWarning={catchSubmissionWarning}
          isSessionPending={isSessionPending}
          isAuthenticated={isAuthenticated}
          authenticatedDisplayName={currentUser?.displayName}
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
          maxSimulationSpeed={MAX_SIMULATION_SPEED + speedBonus}
        />
        <MultiplayerPanel
          isAuthenticated={isAuthenticated}
          currentUser={currentUser}
          token={token}
          connectionStatus={multiplayerConnectionStatus}
          onlinePlayerCount={onlinePlayers.length}
          errorMessage={multiplayerErrorMessage}
          playerPosition={playerPosition}
          sharedRoomCreatures={sharedRoomCreatures}
          onConnectPresence={connectPresence}
          onDisconnectPresence={disconnectPresence}
          onRoomContextChange={handleMultiplayerRoomContextChange}
          onRefreshSharedRoomCreatures={refreshSharedRoomCreatures}
          onSessionExpired={logout}
        />
      </div>
      <TargetInfoPanel
        targets={targets}
        onTargetClick={handleTargetClick}
        chasedTargetId={chasedTargetId}
        routingTargetId={routingTargetId}
        onCancelChase={handleCancelChase}
      />
      <CaughtInventoryPanel caughtTargets={caughtTargets} />
      <StatsDrawer
        activeSessionId={backendSession?.sessionId}
        playerName={effectivePlayerName}
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
          onConfirm={handleConfirmPendingMove}
          onCancel={clearPendingDestination}
          isLoading={isRouteLoading}
        />
      )}

    </main>
  )
}

export default App
