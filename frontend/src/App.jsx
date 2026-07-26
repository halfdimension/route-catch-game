import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { useAuth } from './context/authContextCore'
import {
  catchRoomCreature,
  listRoomCreatures,
} from './api/multiplayerRoomClient'
import { useBackendGameSession } from './hooks/useBackendGameSession'
import { useCatchDetection } from './hooks/useCatchDetection'
import { useGameSession } from './hooks/useGameSession'
import { useMultiplayerPresence } from './hooks/useMultiplayerPresence'
import { useMovementPlanRenderer } from './hooks/useMovementPlanRenderer'
import { usePlayerProgression } from './hooks/usePlayerProgression'
import { usePlayerName } from './hooks/usePlayerName'
import { usePlayerState } from './hooks/usePlayerState'
import { useTargetSpawner } from './hooks/useTargetSpawner'
import {
  DEFAULT_SIMULATION_SPEED,
  INITIAL_PLAYER_POSITION,
  MIN_SIMULATION_SPEED,
} from './config/gameConfig'
import HomePage from './pages/HomePage'
import LeaderboardPage from './pages/LeaderboardPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import RegisterPage from './pages/RegisterPage'
import RoomLobbyPage from './pages/RoomLobbyPage'
import RoomPlayPage from './pages/RoomPlayPage'
import RoomsPage from './pages/RoomsPage'
import SoloPlayPage from './pages/SoloPlayPage'
import StatsPage from './pages/StatsPage'
import { playCatchSound } from './utils/soundEffects'
import {
  createSharedCreatureMovementIntent,
  MOVEMENT_ARCHITECTURE,
  startMovementForArchitecture,
} from './utils/movementArchitecture'

const MapLibrePrototypePage = import.meta.env.DEV
  ? lazy(() => import('./pages/MapLibrePrototypePage'))
  : null

const TARGET_EXPIRED_MESSAGE = 'Target expired'

const ROOM_CREATURE_CATCH_ERROR_MESSAGES = {
  ROOM_CREATURE_TOO_FAR: 'Too far from this creature.',
  ROOM_CREATURE_ALREADY_CAUGHT: 'Already caught by another player.',
  ROOM_CREATURE_EXPIRED: 'Creature expired.',
  ROOM_CREATURE_NOT_FOUND: 'Already caught by another player.',
  ROOM_GAME_NOT_RUNNING: 'Room game is not running.',
}

const SHARED_ROOM_CREATURE_CATCH_RADIUS_METERS = 75
const EARTH_RADIUS_METERS = 6371000

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function getDistanceMeters(source, target) {
  const latDelta = toRadians(target.lat - source.lat)
  const lonDelta = toRadians(target.lon - source.lon)
  const sourceLatRadians = toRadians(source.lat)
  const targetLatRadians = toRadians(target.lat)

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(sourceLatRadians) *
      Math.cos(targetLatRadians) *
      Math.sin(lonDelta / 2) ** 2

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  )
}

function getSharedRoomCreaturePosition(creature) {
  const lat = Number(creature?.latitude)
  const lon = Number(creature?.longitude)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  return { lat, lon }
}

function isVisibleSharedRoomCreature(creature) {
  if (!creature || creature.status === 'CAUGHT' || creature.status === 'EXPIRED') {
    return false
  }

  return (
    creature.remainingSeconds === undefined ||
    Number(creature.remainingSeconds) > 0
  )
}

function sortSharedRoomCreatures(creatures) {
  return [...creatures].sort((firstCreature, secondCreature) =>
    String(firstCreature.spawnedAt || '').localeCompare(
      String(secondCreature.spawnedAt || ''),
    ),
  )
}

function RootRedirect() {
  const { isAuthenticated, loadingAuth } = useAuth()

  if (loadingAuth) {
    return <main className="route-loading">Checking account...</main>
  }

  return <Navigate to={isAuthenticated ? '/home' : '/login'} replace />
}

function ProtectedRoutes() {
  const { isAuthenticated, loadingAuth } = useAuth()

  if (loadingAuth) {
    return <main className="route-loading">Checking account...</main>
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <AppLayout />
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
  const [chasedSharedRoomCreatureId, setChasedSharedRoomCreatureId] =
    useState(null)
  const [routingSharedRoomCreatureId, setRoutingSharedRoomCreatureId] =
    useState(null)
  const chasedTargetIdRef = useRef(null)
  const routingTargetIdRef = useRef(null)
  const chasedSharedRoomCreatureIdRef = useRef(null)
  const routingSharedRoomCreatureIdRef = useRef(null)
  const cancelRoomMovementRef = useRef(() => false)
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

  const updateChasedSharedRoomCreatureId = useCallback((instanceId) => {
    chasedSharedRoomCreatureIdRef.current = instanceId
    setChasedSharedRoomCreatureId(instanceId)
  }, [])

  const updateRoutingSharedRoomCreatureId = useCallback((instanceId) => {
    routingSharedRoomCreatureIdRef.current = instanceId
    setRoutingSharedRoomCreatureId(instanceId)
  }, [])

  const clearSharedRoomCreatureChaseState = useCallback(() => {
    updateChasedSharedRoomCreatureId(null)
    updateRoutingSharedRoomCreatureId(null)
  }, [updateChasedSharedRoomCreatureId, updateRoutingSharedRoomCreatureId])

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
  const sharedRoomCreaturesRef = useRef(sharedRoomCreatures)
  const pendingSharedRoomCatchIdsRef = useRef(new Set())
  const sharedRoomCatchRetryAfterRef = useRef(new Map())
  const speedInitializedRoomCodeRef = useRef('')
  const activeRoomCode = activeMultiplayerRoom?.roomCode
  const activeRoomStatus =
    activeRoomGameState?.roomStatus || activeMultiplayerRoom?.status
  const activeRoomGameStatus = activeRoomGameState?.gameStatus
  const handleRoomCreatureEvent = useCallback(
    (event) => {
      if (!event?.creature || event.roomCode !== activeRoomCode) {
        return
      }

      const creature = event.creature

      if (event.eventType === 'CREATED' && isVisibleSharedRoomCreature(creature)) {
        setSharedRoomCreatures((currentCreatures) => {
          const nextCreatures = currentCreatures.filter(
            (currentCreature) =>
              currentCreature.instanceId !== creature.instanceId,
          )
          return sortSharedRoomCreatures([...nextCreatures, creature])
        })
        return
      }

      if (event.eventType === 'CAUGHT' || event.eventType === 'EXPIRED') {
        setSharedRoomCreatures((currentCreatures) =>
          currentCreatures.filter(
            (currentCreature) =>
              currentCreature.instanceId !== creature.instanceId,
          ),
        )

        if (
          chasedSharedRoomCreatureIdRef.current === creature.instanceId ||
          routingSharedRoomCreatureIdRef.current === creature.instanceId
        ) {
          cancelRoomMovementRef.current()
          clearSharedRoomCreatureChaseState()
        }
      }
    },
    [activeRoomCode, clearSharedRoomCreatureChaseState],
  )
  const {
    cancelRoomMovement,
    connectionStatus: multiplayerConnectionStatus,
    movementCommandPending,
    movementErrorMessage,
    movementNeedsSnapshot,
    movementPlans,
    movementRoomSequence,
    movementServerOffsetMs,
    movementSnapshotStatus,
    onlinePlayers,
    roomEvent: multiplayerRoomEvent,
    errorMessage: multiplayerErrorMessage,
    connectPresence,
    disconnectPresence,
    sendPresenceUpdate,
    startRoomMovement,
  } = useMultiplayerPresence({
    token,
    currentUser,
    playerPosition: INITIAL_PLAYER_POSITION,
    status: 'IDLE',
    onRoomCreatureEvent: handleRoomCreatureEvent,
  })
  useEffect(() => {
    cancelRoomMovementRef.current = cancelRoomMovement
  }, [cancelRoomMovement])
  const {
    getCurrentPlayerPosition: getCurrentRoomPlayerPosition,
    positionsByPlayerId: roomPositionsByPlayerId,
    preparedPlans: preparedRoomMovementPlans,
  } = useMovementPlanRenderer({
    movementPlans,
    serverOffsetMs: movementServerOffsetMs,
  })
  const localRoomMovementPlan = useMemo(
    () => movementPlans.find(
      (plan) => String(plan.playerId) === String(currentUser?.userId),
    ) ?? null,
    [currentUser?.userId, movementPlans],
  )
  const localPresencePosition = useMemo(() => {
    const localPresence = onlinePlayers.find(
      (player) => String(player.userId) === String(currentUser?.userId),
    )
    const lat = Number(localPresence?.lat)
    const lon = Number(localPresence?.lon)
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : null
  }, [currentUser?.userId, onlinePlayers])
  const roomPlayerPosition =
    roomPositionsByPlayerId.get(String(currentUser?.userId)) ||
    localPresencePosition ||
    INITIAL_PLAYER_POSITION
  const roomRouteCoordinates = useMemo(() => {
    if (localRoomMovementPlan?.status !== 'MOVING') {
      return []
    }

    return preparedRoomMovementPlans
      .get(String(currentUser?.userId))
      ?.route.coordinates ?? []
  }, [
    currentUser?.userId,
    localRoomMovementPlan?.status,
    preparedRoomMovementPlans,
  ])
  const roomMovementStatus = localRoomMovementPlan?.status ?? 'IDLE'
  const roomIsMoving = roomMovementStatus === 'MOVING'
  const roomMovementSpeed = roomIsMoving
    ? localRoomMovementPlan?.simulationSpeedMps ?? 0
    : 0
  const otherOnlinePlayers = useMemo(
    () => onlinePlayers
      .filter((player) => String(player.userId) !== String(currentUser?.userId))
      .map((player) => ({
        ...player,
        renderPosition:
          roomPositionsByPlayerId.get(String(player.userId)) || null,
      })),
    [currentUser?.userId, onlinePlayers, roomPositionsByPlayerId],
  )

  useEffect(() => {
    targetsRef.current = targets
  }, [targets])

  useLayoutEffect(() => {
    const maxSpeedMps = Number(activeMultiplayerRoom?.settings?.maxSpeedMps)

    if (!activeRoomCode || !Number.isFinite(maxSpeedMps)) {
      speedInitializedRoomCodeRef.current = ''
      return
    }

    const speedCeiling = Math.max(MIN_SIMULATION_SPEED, maxSpeedMps)

    if (speedInitializedRoomCodeRef.current !== activeRoomCode) {
      speedInitializedRoomCodeRef.current = activeRoomCode
      setSimulationSpeed(Math.min(DEFAULT_SIMULATION_SPEED, speedCeiling))
      return
    }

    setSimulationSpeed((currentSpeedMps) =>
      Math.min(speedCeiling, Math.max(MIN_SIMULATION_SPEED, currentSpeedMps)),
    )
  }, [
    activeMultiplayerRoom?.settings?.maxSpeedMps,
    activeRoomCode,
    setSimulationSpeed,
  ])

  useEffect(() => {
    sharedRoomCreaturesRef.current = sharedRoomCreatures

    const activeCreatureIds = new Set(
      sharedRoomCreatures.map((creature) => creature.instanceId),
    )
    pendingSharedRoomCatchIdsRef.current.forEach((instanceId) => {
      if (!activeCreatureIds.has(instanceId)) {
        pendingSharedRoomCatchIdsRef.current.delete(instanceId)
      }
    })
    sharedRoomCatchRetryAfterRef.current.forEach((_, instanceId) => {
      if (!activeCreatureIds.has(instanceId)) {
        sharedRoomCatchRetryAfterRef.current.delete(instanceId)
      }
    })

    if (
      chasedSharedRoomCreatureIdRef.current &&
      !activeCreatureIds.has(chasedSharedRoomCreatureIdRef.current)
    ) {
      cancelRoomMovementRef.current()
      clearSharedRoomCreatureChaseState()
    }
  }, [clearSharedRoomCreatureChaseState, sharedRoomCreatures])

  useEffect(() => {
    if (!localRoomMovementPlan) {
      const timerId = window.setTimeout(
        clearSharedRoomCreatureChaseState,
        0,
      )
      return () => window.clearTimeout(timerId)
    }

    const targetCreatureInstanceId =
      localRoomMovementPlan.targetCreatureInstanceId

    const timerId = window.setTimeout(() => {
      if (
        (
          localRoomMovementPlan.status === 'MOVING' ||
          localRoomMovementPlan.status === 'COMPLETED'
        ) &&
        localRoomMovementPlan.destinationType === 'CREATURE' &&
        targetCreatureInstanceId
      ) {
        updateChasedSharedRoomCreatureId(targetCreatureInstanceId)
        updateRoutingSharedRoomCreatureId(null)
      } else if (
        localRoomMovementPlan.status === 'CANCELLED' ||
        localRoomMovementPlan.destinationType !== 'CREATURE'
      ) {
        clearSharedRoomCreatureChaseState()
      }
    }, 0)

    const authoritativePosition = getCurrentRoomPlayerPosition(
      currentUser?.userId,
    )

    if (authoritativePosition) {
      sendPresenceUpdate({
        force: true,
        position: authoritativePosition,
        reason: 'authoritative-movement-transition',
        status:
          localRoomMovementPlan.status === 'MOVING'
            ? targetCreatureInstanceId ? 'CHASING' : 'MOVING'
            : 'IDLE',
      })
    }

    return () => window.clearTimeout(timerId)
  }, [
    clearSharedRoomCreatureChaseState,
    currentUser?.userId,
    getCurrentRoomPlayerPosition,
    localRoomMovementPlan,
    sendPresenceUpdate,
    updateChasedSharedRoomCreatureId,
    updateRoutingSharedRoomCreatureId,
  ])

  useEffect(() => {
    if (movementCommandPending || !movementErrorMessage) {
      return undefined
    }

    const timerId = window.setTimeout(
      () => updateRoutingSharedRoomCreatureId(null),
      0,
    )
    return () => window.clearTimeout(timerId)
  }, [
    movementCommandPending,
    movementErrorMessage,
    updateRoutingSharedRoomCreatureId,
  ])

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
    clearSharedRoomCreatureChaseState()
    void finishSession(
      'Round ended locally, but the backend session could not be closed.',
    ).then((didEndSession) => {
      if (didEndSession) {
        setHistoryRefreshVersion((version) => version + 1)
      }
    })
  }, [
    clearChaseState,
    clearSharedRoomCreatureChaseState,
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
    clearSharedRoomCreatureChaseState()
  }

  function resetGame() {
    void finishSession()
    resetPlayerState()
    clearChaseState()
    clearSharedRoomCreatureChaseState()
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
    clearSharedRoomCreatureChaseState()
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
    clearSharedRoomCreatureChaseState()
    await startMovementForArchitecture({
      architecture: MOVEMENT_ARCHITECTURE.SOLO,
      startAuthoritativePlan: () => false,
      startLocalRoute: confirmPendingMove,
    })
  }

  function handleRoomConfirmPendingMove() {
    clearChaseState()

    if (!pendingDestination || activeRoomGameStatus !== 'RUNNING') {
      return false
    }

    const commandId = startMovementForArchitecture({
      architecture: MOVEMENT_ARCHITECTURE.MULTIPLAYER,
      startAuthoritativePlan: () => startRoomMovement({
        destinationLat: pendingDestination.lat,
        destinationLon: pendingDestination.lon,
        requestedSpeedMps: simulationSpeed,
        destinationType: 'MAP',
        targetCreatureInstanceId: null,
      }),
      startLocalRoute: () => false,
    })

    if (commandId) {
      clearPendingDestination()
      return true
    }

    return false
  }

  function handleCancelChase() {
    stopPlayerMovement()
    clearChaseState()
    clearSharedRoomCreatureChaseState()
  }

  const cleanupRoomMovement = useCallback(() => {
    pendingSharedRoomCatchIdsRef.current.clear()
    sharedRoomCatchRetryAfterRef.current.clear()
    stopPlayerMovement()
    clearSharedRoomCreatureChaseState()
  }, [clearSharedRoomCreatureChaseState, stopPlayerMovement])

  const prepareRoomMovement = useCallback(() => {
    stopPlayerMovement()
    clearChaseState()
  }, [clearChaseState, stopPlayerMovement])

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
      const nextCreatures = Array.isArray(creatures)
        ? creatures.filter(isVisibleSharedRoomCreature)
        : []
      setSharedRoomCreatures(nextCreatures)
      return nextCreatures
    } catch (error) {
      if (error.status === 401) {
        logout()
      }

      return []
    }
  }, [activeRoomCode, activeRoomGameStatus, isAuthenticated, logout, token])

  const isSharedRoomCreatureActive = useCallback((instanceId) => {
    return sharedRoomCreaturesRef.current.some(
      (creature) =>
        creature.instanceId === instanceId &&
        isVisibleSharedRoomCreature(creature),
    )
  }, [])

  const attemptSharedRoomCreatureCatch = useCallback(
    async (creature) => {
      const instanceId = creature?.instanceId
      const retryAfterMs =
        sharedRoomCatchRetryAfterRef.current.get(instanceId) ?? 0

      if (
        !instanceId ||
        pendingSharedRoomCatchIdsRef.current.has(instanceId) ||
        retryAfterMs > Date.now()
      ) {
        return false
      }

      sharedRoomCatchRetryAfterRef.current.delete(instanceId)
      pendingSharedRoomCatchIdsRef.current.add(instanceId)

      const currentAuthoritativePosition =
        getCurrentRoomPlayerPosition(currentUser?.userId) ||
        roomPlayerPosition
      const playerLat = Number(currentAuthoritativePosition?.lat)
      const playerLon = Number(currentAuthoritativePosition?.lon)

      if (!Number.isFinite(playerLat) || !Number.isFinite(playerLon)) {
        setSharedRoomCatchMessage({
          type: 'error',
          text: 'Player position unavailable.',
        })
        pendingSharedRoomCatchIdsRef.current.delete(instanceId)
        return false
      }

      if (!token || !activeRoomCode) {
        setSharedRoomCatchMessage({
          type: 'error',
          text: 'Could not catch creature.',
        })
        pendingSharedRoomCatchIdsRef.current.delete(instanceId)
        return false
      }

      try {
        const caughtCreature = await catchRoomCreature(
          activeRoomCode,
          instanceId,
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
        playCatchSound(caughtCreature?.rarity || creature.rarity)
        setSharedRoomCreatures((currentCreatures) =>
          currentCreatures.filter(
            (currentCreature) => currentCreature.instanceId !== instanceId,
          ),
        )
        sharedRoomCatchRetryAfterRef.current.delete(instanceId)
        cancelRoomMovement()
        if (
          chasedSharedRoomCreatureIdRef.current === instanceId ||
          routingSharedRoomCreatureIdRef.current === instanceId
        ) {
          clearSharedRoomCreatureChaseState()
        }
        await refreshSharedRoomCreatures()
        return true
      } catch (error) {
        if (error.status === 401) {
          logout()
        }

        const wasUnavailable = [
          'ROOM_CREATURE_ALREADY_CAUGHT',
          'ROOM_CREATURE_EXPIRED',
          'ROOM_CREATURE_NOT_FOUND',
        ].includes(error.errorCode)
        const message = wasUnavailable
          ? 'Already caught by another player.'
          : ROOM_CREATURE_CATCH_ERROR_MESSAGES[error.errorCode] ||
            error.message ||
            'Could not catch creature.'

        setSharedRoomCatchMessage({
          type: 'error',
          text: message,
        })

        if (wasUnavailable) {
          sharedRoomCatchRetryAfterRef.current.delete(instanceId)
          setSharedRoomCreatures((currentCreatures) =>
            currentCreatures.filter(
              (currentCreature) => currentCreature.instanceId !== instanceId,
            ),
          )
          cancelRoomMovement()
          if (
            chasedSharedRoomCreatureIdRef.current === instanceId ||
            routingSharedRoomCreatureIdRef.current === instanceId
          ) {
            clearSharedRoomCreatureChaseState()
          }
          await refreshSharedRoomCreatures()
        } else {
          sharedRoomCatchRetryAfterRef.current.set(
            instanceId,
            Date.now() + 2000,
          )
        }

        return false
      } finally {
        pendingSharedRoomCatchIdsRef.current.delete(instanceId)
      }
    },
    [
      activeRoomCode,
      cancelRoomMovement,
      clearSharedRoomCreatureChaseState,
      currentUser?.userId,
      getCurrentRoomPlayerPosition,
      logout,
      refreshSharedRoomCreatures,
      roomPlayerPosition,
      token,
    ],
  )

  const handleSharedRoomCreatureCatch = useCallback(
    (creature) => {
      const instanceId = creature?.instanceId

      if (!instanceId) {
        setSharedRoomCatchMessage({
          type: 'error',
          text: 'Could not catch creature.',
        })
        return
      }

      clearPendingDestination()
      clearChaseState()

      if (!isSharedRoomCreatureActive(instanceId)) {
        setSharedRoomCatchMessage({
          type: 'error',
          text: 'Already caught by another player.',
        })
        void refreshSharedRoomCreatures()
        return
      }

      updateRoutingSharedRoomCreatureId(instanceId)

      const commandId = startRoomMovement(
        createSharedCreatureMovementIntent(instanceId, simulationSpeed),
      )

      if (!commandId) {
        updateRoutingSharedRoomCreatureId(null)
      }
    },
    [
      clearChaseState,
      clearPendingDestination,
      isSharedRoomCreatureActive,
      refreshSharedRoomCreatures,
      simulationSpeed,
      startRoomMovement,
      updateRoutingSharedRoomCreatureId,
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

  useEffect(() => {
    if (!chasedSharedRoomCreatureId) {
      return
    }

    const creature = sharedRoomCreatures.find(
      (currentCreature) =>
        currentCreature.instanceId === chasedSharedRoomCreatureId,
    )
    const creaturePosition = getSharedRoomCreaturePosition(creature)
    const playerLat = Number(roomPlayerPosition?.lat)
    const playerLon = Number(roomPlayerPosition?.lon)

    if (
      !creature ||
      !creaturePosition ||
      !Number.isFinite(playerLat) ||
      !Number.isFinite(playerLon)
    ) {
      return
    }

    const distanceMeters = getDistanceMeters(
      { lat: playerLat, lon: playerLon },
      creaturePosition,
    )

    if (distanceMeters <= SHARED_ROOM_CREATURE_CATCH_RADIUS_METERS) {
      const timerId = window.setTimeout(() => {
        void attemptSharedRoomCreatureCatch(creature)
      }, 0)

      return () => window.clearTimeout(timerId)
    }
  }, [
    attemptSharedRoomCreatureCatch,
    chasedSharedRoomCreatureId,
    roomPlayerPosition?.lat,
    roomPlayerPosition?.lon,
    sharedRoomCreatures,
  ])

  const isTargetActive = useCallback((targetId) => {
    return targetsRef.current.some(
      (currentTarget) =>
        currentTarget.id === targetId && currentTarget.expiresAt > Date.now(),
    )
  }, [])

  const handleTargetClick = useCallback(
    async (target) => {
      stopPlayerMovement()
      clearPendingDestination()
      clearChaseState()
      clearSharedRoomCreatureChaseState()

      if (!isTargetActive(target.id)) {
        showRouteMessage(TARGET_EXPIRED_MESSAGE)
        return
      }

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
      clearSharedRoomCreatureChaseState,
      isTargetActive,
      moveToDestination,
      showRouteMessage,
      stopPlayerMovement,
      clearChaseState,
      updateChasedTargetId,
      updateRoutingTargetId,
    ],
  )

  const gameplay = {
    activeRoomGameStatus,
    activeRoomStatus,
    activeMultiplayerRoom,
    backendCaughtCount,
    backendScore,
    backendSession,
    catchSubmissionWarning,
    catchToastTarget,
    chasedTargetId,
    chasedSharedRoomCreatureId,
    clearPendingDestination,
    clearTargets,
    cleanupRoomMovement,
    cancelRoomMovement,
    connectPresence,
    currentUser,
    disconnectPresence,
    effectivePlayerName,
    gameState,
    handleCancelChase,
    handleConfirmPendingMove,
    handleRoomConfirmPendingMove,
    handleMapClick,
    handleMultiplayerRoomContextChange,
    handleSharedRoomCreatureCatch,
    handleStartGame,
    handleEndGame,
    handleTargetClick,
    historyRefreshVersion,
    isAuthenticated,
    isMoving,
    isRouteLoading,
    isSessionPending,
    isSpawningPaused,
    level,
    logout,
    multiplayerConnectionStatus,
    multiplayerErrorMessage,
    multiplayerRoomEvent,
    movementCommandPending,
    movementErrorMessage,
    movementNeedsSnapshot,
    movementRoomSequence,
    movementSnapshotStatus,
    nextLevelXp,
    onlinePlayers,
    otherOnlinePlayers,
    pendingDestination,
    playerName,
    playerPosition,
    prepareRoomMovement,
    roomIsMoving,
    roomMovementSpeed,
    roomMovementStatus,
    roomPlayerPosition,
    roomRouteCoordinates,
    refreshSharedRoomCreatures,
    remainingSeconds,
    resetGame,
    resetPlayer,
    resetScore,
    restartGame,
    routeCoordinates,
    routeError,
    roundDurationOptions,
    routingTargetId,
    routingSharedRoomCreatureId,
    score,
    selectedRoundSeconds,
    sessionNotice,
    setPlayerName,
    setSelectedRoundSeconds,
    setSimulationSpeed,
    sharedRoomCatchMessage,
    sharedRoomCreatures,
    simulationSpeed,
    speedBonus,
    targets,
    token,
    toggleSpawning,
    caughtTargets,
    xp,
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {import.meta.env.DEV && MapLibrePrototypePage && (
          <Route
            path="/dev/maplibre"
            element={(
              <Suspense fallback={<main className="route-loading">Loading map lab…</main>}>
                <MapLibrePrototypePage />
              </Suspense>
            )}
          />
        )}
        <Route element={<ProtectedRoutes />}>
          <Route path="/home" element={<HomePage />} />
          <Route
            path="/play/solo"
            element={<SoloPlayPage gameplay={gameplay} />}
          />
          <Route
            path="/rooms"
            element={<RoomsPage gameplay={gameplay} />}
          />
          <Route
            path="/rooms/:roomCode/lobby"
            element={<RoomLobbyPage gameplay={gameplay} />}
          />
          <Route
            path="/rooms/:roomCode/play"
            element={<RoomPlayPage gameplay={gameplay} />}
          />
          <Route
            path="/stats"
            element={(
              <StatsPage
                activeSessionId={backendSession?.sessionId}
                playerName={effectivePlayerName}
                refreshVersion={historyRefreshVersion}
              />
            )}
          />
          <Route
            path="/leaderboard"
            element={(
              <LeaderboardPage refreshVersion={historyRefreshVersion} />
            )}
          />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
