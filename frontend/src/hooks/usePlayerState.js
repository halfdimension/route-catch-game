import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRoute, isRouteUnavailableError } from '../api/osrmClient.js'
import { API_BASE_URL } from '../config/apiConfig.js'
import {
  DEFAULT_SIMULATION_SPEED,
  INITIAL_PLAYER_POSITION,
} from '../config/gameConfig.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
  createSoloMovementRecoveryId,
} from '../recovery/soloRecoveryCheckpoint.js'
import { resolveRecoveredSoloMovement } from '../recovery/soloRecoveryRuntime.js'
import {
  createNavigationFrameChannel,
  SOLO_NAVIGATION_START_KINDS,
} from './navigationFrameChannel.js'
import { useRouteAnimation } from './useRouteAnimation.js'

const ROUTE_UNAVAILABLE_MESSAGE = 'Could not find a route to this target.'

function isAbortError(error) {
  return error?.name === 'AbortError'
}

export function usePlayerState({
  routeAnimationStartDelayMs = 0,
  onMovementTransition,
  resolveRouteInterval,
  onRouteIntervalEvents,
  captureRouteOperation,
  getEpochTimeMs = Date.now,
} = {}) {
  const [playerPosition, setPlayerPosition] = useState(INITIAL_PLAYER_POSITION)
  const [simulationSpeed, setSimulationSpeedState] = useState(
    DEFAULT_SIMULATION_SPEED,
  )
  const [pendingDestination, setPendingDestination] = useState(null)
  const [routeCoordinates, setRouteCoordinates] = useState([])
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const routeRequestIdRef = useRef(0)
  const routeAbortControllerRef = useRef(null)
  const playerPositionRef = useRef(INITIAL_PLAYER_POSITION)
  const simulationSpeedRef = useRef(DEFAULT_SIMULATION_SPEED)
  const movementRef = useRef(null)
  const onMovementTransitionRef = useRef(onMovementTransition)
  const captureRouteOperationRef = useRef(captureRouteOperation)
  const mountedRef = useRef(false)
  const navigationFrameChannelRef = useRef(null)

  if (navigationFrameChannelRef.current == null) {
    navigationFrameChannelRef.current = createNavigationFrameChannel()
  }

  const notifyMovementTransition = useCallback((
    type,
    movement,
    position,
    speedMetersPerSecond,
  ) => {
    const transition = {
      type,
      movement: movement ? structuredClone(movement) : null,
      settledPosition: structuredClone(position),
    }

    if (Number.isFinite(speedMetersPerSecond)) {
      transition.simulationSpeedMetersPerSecond = speedMetersPerSecond
    }

    onMovementTransitionRef.current?.(transition)
  }, [])

  const publishNavigationFrame = useCallback((navigationFrame) => {
    navigationFrameChannelRef.current.publish(navigationFrame)
  }, [])

  const handleMovementAnchorChange = useCallback((movementAnchor) => {
    const movement = movementRef.current
    if (!movement || movement.phase !== SOLO_RECOVERY_MOVEMENT_PHASES.MOVING) {
      return
    }

    const nextMovement = {
      ...movement,
      anchorDistanceMeters: movementAnchor.anchorDistanceMeters,
      anchorTimeEpochMs: movementAnchor.anchorTimeEpochMs,
    }
    movementRef.current = nextMovement
    notifyMovementTransition(
      'SPEED_CHANGED',
      nextMovement,
      playerPositionRef.current,
      movementAnchor.speedMetersPerSecond,
    )
  }, [notifyMovementTransition])

  const {
    isMoving,
    startAnimation,
    cancelAnimation,
    getMovementAnchorSnapshot,
  } = useRouteAnimation({
    speedMetersPerSecond: simulationSpeed,
    startDelayMs: routeAnimationStartDelayMs,
    onPositionChange: (nextPosition) => {
      playerPositionRef.current = nextPosition
      setPlayerPosition(nextPosition)
    },
    onNavigationFrame: publishNavigationFrame,
    resolveRouteInterval,
    onRouteIntervalEvents,
    onMovementAnchorChange: handleMovementAnchorChange,
    getEpochTimeMs,
  })

  useEffect(() => {
    onMovementTransitionRef.current = onMovementTransition
    captureRouteOperationRef.current = captureRouteOperation
  }, [captureRouteOperation, onMovementTransition])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const setSimulationSpeed = useCallback((nextSpeedOrUpdater) => {
    setSimulationSpeedState((currentSpeed) => {
      const nextSpeed = typeof nextSpeedOrUpdater === 'function'
        ? nextSpeedOrUpdater(currentSpeed)
        : nextSpeedOrUpdater
      simulationSpeedRef.current = nextSpeed
      return nextSpeed
    })
  }, [])

  const subscribeToNavigationFrames = useCallback(
    (listener) => navigationFrameChannelRef.current.subscribe(listener),
    [],
  )

  useEffect(() => {
    const channel = navigationFrameChannelRef.current

    return () => {
      channel.clear()
    }
  }, [])

  function clearPendingDestination() {
    setPendingDestination(null)
  }

  function handlePendingDestinationChange(destination) {
    setPendingDestination(destination)
    setRouteError('')
  }

  function showRouteMessage(message) {
    setRouteError(message)
  }

  const clearMovementRuntime = useCallback(({
    notify = true,
    transitionType = 'CANCELLED',
    settleAtEpochMs,
  } = {}) => {
    routeRequestIdRef.current += 1
    routeAbortControllerRef.current?.abort()
    routeAbortControllerRef.current = null
    const previousMovement = movementRef.current
    const cancelled = cancelAnimation({ settleAtEpochMs })
    const settledPosition = cancelled?.position ?? playerPositionRef.current
    playerPositionRef.current = settledPosition
    setPlayerPosition(settledPosition)
    movementRef.current = null
    setPendingDestination(null)
    setRouteCoordinates([])
    setIsRouteLoading(false)
    setRouteError('')

    if (notify && previousMovement) {
      notifyMovementTransition(transitionType, null, settledPosition)
    }

    return settledPosition
  }, [cancelAnimation, notifyMovementTransition])

  const moveToDestination = useCallback(async (destination, options = {}) => {
    if (!destination) {
      return false
    }

    const lifecycleOperation = options.lifecycleOperation ??
      captureRouteOperationRef.current?.()
    const operationIsCurrent = () => (
      mountedRef.current &&
      lifecycleOperation?.isCurrent?.() !== false &&
      options.shouldStart?.() !== false
    )
    if (!operationIsCurrent()) {
      return false
    }

    const previousMovement = movementRef.current
    const cancelled = cancelAnimation()
    const sourcePosition = options.sourcePosition ||
      cancelled?.position || playerPositionRef.current

    if (previousMovement && options.notifyTransitions !== false) {
      notifyMovementTransition('REPLACED', null, sourcePosition)
    }

    routeAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    routeAbortControllerRef.current = abortController
    setIsRouteLoading(true)
    setRouteError('')
    playerPositionRef.current = sourcePosition
    setPlayerPosition(sourcePosition)
    setRouteCoordinates([])
    const routeRequestId = routeRequestIdRef.current + 1
    routeRequestIdRef.current = routeRequestId
    const routingMovement = {
      movementRecoveryId:
        options.movementRecoveryId ?? createSoloMovementRecoveryId(),
      phase: SOLO_RECOVERY_MOVEMENT_PHASES.ROUTING,
      purpose:
        options.purpose ?? SOLO_RECOVERY_MOVEMENT_PURPOSES.MAP,
      destination: structuredClone(destination),
      chasedTargetId: options.chasedTargetId ?? null,
      routeCoordinates: null,
      anchorDistanceMeters: null,
      anchorTimeEpochMs: null,
    }
    movementRef.current = routingMovement

    if (options.notifyTransitions !== false) {
      notifyMovementTransition('ROUTING', routingMovement, sourcePosition)
    }

    try {
      const route = await fetchRoute(sourcePosition, destination, {
        signal: abortController.signal,
      })
      const nextRouteCoordinates = route.coordinates

      if (routeRequestId !== routeRequestIdRef.current) {
        return false
      }

      if (!operationIsCurrent()) {
        if (options.blockedMessage) {
          setRouteError(options.blockedMessage)
        }
        movementRef.current = null
        if (options.notifyTransitions !== false) {
          notifyMovementTransition('CANCELLED', null, sourcePosition)
        }
        return false
      }

      setRouteCoordinates(nextRouteCoordinates)
      const didStart = startAnimation(
        nextRouteCoordinates,
        () => {
          if (!operationIsCurrent()) {
            return
          }
          movementRef.current = null
          notifyMovementTransition(
            'COMPLETED',
            null,
            playerPositionRef.current,
          )
          options.onComplete?.()
        },
        options.movementAnchor
          ? { movementAnchor: options.movementAnchor }
          : undefined,
      )

      if (!didStart) {
        movementRef.current = null
        return false
      }

      const movementAnchor = getMovementAnchorSnapshot()
      // A zero-length route, or a recovered anchor that reaches the end
      // between reconstruction and animation startup, completes synchronously.
      if (!movementAnchor) {
        return true
      }

      const movingMovement = {
        ...routingMovement,
        phase: SOLO_RECOVERY_MOVEMENT_PHASES.MOVING,
        routeCoordinates: structuredClone(nextRouteCoordinates),
        anchorDistanceMeters: movementAnchor.anchorDistanceMeters,
        anchorTimeEpochMs: movementAnchor.anchorTimeEpochMs,
      }
      movementRef.current = movingMovement

      if (options.notifyTransitions !== false) {
        notifyMovementTransition('MOVING', movingMovement, sourcePosition)
      }
      return true
    } catch (error) {
      if (routeRequestId !== routeRequestIdRef.current) {
        return false
      }

      movementRef.current = null
      if (isAbortError(error)) {
        return false
      }

      console.error('Route fetch failed:', error)
      setRouteError(
        isRouteUnavailableError(error)
          ? ROUTE_UNAVAILABLE_MESSAGE
          : `Could not fetch route. Is the API running at ${API_BASE_URL}?`,
      )
      if (options.notifyTransitions !== false) {
        notifyMovementTransition('CANCELLED', null, sourcePosition)
      }
      return false
    } finally {
      if (routeRequestId === routeRequestIdRef.current) {
        if (routeAbortControllerRef.current === abortController) {
          routeAbortControllerRef.current = null
        }
        setIsRouteLoading(false)
      }
    }
  }, [
    cancelAnimation,
    getMovementAnchorSnapshot,
    notifyMovementTransition,
    startAnimation,
  ])

  async function confirmPendingMove() {
    const didStartMoving = await moveToDestination(pendingDestination)

    if (didStartMoving) {
      clearPendingDestination()
    }
  }

  function resetPlayerState() {
    clearMovementRuntime({ transitionType: 'RESET' })
    playerPositionRef.current = INITIAL_PLAYER_POSITION
    setPlayerPosition(INITIAL_PLAYER_POSITION)
  }

  const resetPlayerRecoveryRuntime = useCallback(() => {
    clearMovementRuntime({ notify: false })
    playerPositionRef.current = INITIAL_PLAYER_POSITION
    setPlayerPosition(INITIAL_PLAYER_POSITION)
    simulationSpeedRef.current = DEFAULT_SIMULATION_SPEED
    setSimulationSpeedState(DEFAULT_SIMULATION_SPEED)
  }, [clearMovementRuntime])

  const stopPlayerMovement = useCallback(({
    notify = true,
    settleAtEpochMs,
  } = {}) => {
    return clearMovementRuntime({
      notify,
      settleAtEpochMs,
      transitionType: 'CANCELLED',
    })
  }, [clearMovementRuntime])

  const getMovementRecoverySnapshot = useCallback(({
    advance = true,
  } = {}) => {
    const movement = movementRef.current
    if (!movement) {
      return null
    }

    if (movement.phase !== SOLO_RECOVERY_MOVEMENT_PHASES.MOVING) {
      return structuredClone(movement)
    }

    const movementAnchor = getMovementAnchorSnapshot({
      resolveInterval: advance,
    })
    if (!movementAnchor) {
      return null
    }

    const snapshot = {
      ...movement,
      anchorDistanceMeters: movementAnchor.anchorDistanceMeters,
      anchorTimeEpochMs: movementAnchor.anchorTimeEpochMs,
    }
    movementRef.current = snapshot
    return structuredClone(snapshot)
  }, [getMovementAnchorSnapshot])

  const getSettledPlayerPosition = useCallback(
    () => structuredClone(playerPositionRef.current),
    [],
  )

  const hydratePlayerState = useCallback(async (
    checkpoint,
    { nowEpochMs = Date.now(), shouldStart } = {},
  ) => {
    clearMovementRuntime({ notify: false })
    const recovery = resolveRecoveredSoloMovement(checkpoint, nowEpochMs)
    const recoveredSpeed = checkpoint.player.simulationSpeedMetersPerSecond

    simulationSpeedRef.current = recoveredSpeed
    setSimulationSpeedState(recoveredSpeed)
    playerPositionRef.current = recovery.position
    setPlayerPosition(recovery.position)
    setPendingDestination(null)
    setRouteError('')
    setIsRouteLoading(false)

    if (recovery.kind === 'MOVING') {
      if (shouldStart?.() === false) {
        return {
          kind: 'SETTLED',
          position: recovery.position,
          movement: null,
        }
      }
      setRouteCoordinates(recovery.routeCoordinates)
      const restoredMovement = {
        ...recovery.movement,
        anchorDistanceMeters:
          recovery.movementAnchor.anchorDistanceMeters,
        anchorTimeEpochMs: recovery.movementAnchor.anchorTimeEpochMs,
      }
      movementRef.current = restoredMovement
      const didStart = startAnimation(
        recovery.routeCoordinates,
        () => {
          if (shouldStart?.() === false) {
            return
          }
          movementRef.current = null
          notifyMovementTransition(
            'COMPLETED',
            null,
            playerPositionRef.current,
          )
        },
        {
          movementAnchor: recovery.movementAnchor,
          navigationStartKind:
            SOLO_NAVIGATION_START_KINDS.RECOVERED_ACTIVE,
        },
      )

      if (!didStart || !getMovementAnchorSnapshot()) {
        movementRef.current = null
        setRouteCoordinates([])
        return {
          kind: 'COMPLETED',
          position: playerPositionRef.current,
          movement: null,
          routeCoordinates: recovery.routeCoordinates,
        }
      }

      return { ...recovery, movement: restoredMovement }
    }

    if (recovery.kind === 'ROUTING') {
      movementRef.current = structuredClone(recovery.movement)
      const didStart = await moveToDestination(recovery.movement.destination, {
        sourcePosition: recovery.position,
        movementRecoveryId: recovery.movement.movementRecoveryId,
        purpose: recovery.movement.purpose,
        chasedTargetId: recovery.movement.chasedTargetId,
        notifyTransitions: false,
        shouldStart,
        lifecycleOperation: {
          isCurrent: () => shouldStart?.() !== false,
        },
      })
      const restoredMovement = getMovementRecoverySnapshot()

      if (didStart && restoredMovement) {
        return {
          kind: 'MOVING',
          position: playerPositionRef.current,
          movement: restoredMovement,
          routeCoordinates: restoredMovement.routeCoordinates,
          movementAnchor: {
            anchorDistanceMeters: restoredMovement.anchorDistanceMeters,
            anchorTimeEpochMs: restoredMovement.anchorTimeEpochMs,
            speedMetersPerSecond: recoveredSpeed,
          },
        }
      }

      return {
        kind: 'SETTLED',
        position: playerPositionRef.current,
        movement: null,
      }
    }

    movementRef.current = null
    setRouteCoordinates([])
    return recovery
  }, [
    clearMovementRuntime,
    getMovementAnchorSnapshot,
    getMovementRecoverySnapshot,
    moveToDestination,
    notifyMovementTransition,
    startAnimation,
  ])

  return {
    playerPosition,
    pendingDestination,
    routeCoordinates,
    isRouteLoading,
    isMoving,
    simulationSpeed,
    routeError,
    setSimulationSpeed,
    setPendingDestination: handlePendingDestinationChange,
    showRouteMessage,
    clearPendingDestination,
    confirmPendingMove,
    moveToDestination,
    resetPlayerState,
    resetPlayerRecoveryRuntime,
    stopPlayerMovement,
    subscribeToNavigationFrames,
    getMovementRecoverySnapshot,
    getSettledPlayerPosition,
    hydratePlayerState,
  }
}
