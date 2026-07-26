import { Client } from '@stomp/stompjs'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { API_BASE_URL } from '../config/apiConfig'
import {
  fetchMovementSnapshot,
  movementTopic,
  publishMovementCancel,
  publishMovementStart,
} from '../api/multiplayerMovementClient'
import {
  applyMovementEvent,
  createMovementPlanState,
  getMovementPlanForPlayer,
  isCurrentMovementSubscription,
  reconcileMovementSnapshot,
} from '../multiplayer/movementPlanState'
import { createServerClockOffsetEstimator } from '../utils/movementPlanTimeline'
import {
  createPresencePublishScheduler,
  isCurrentPresenceSubscription,
  normalizePresencePlayers,
  reconcilePresencePlayers,
  shouldPublishPresence,
} from './presenceSync'

const DEFAULT_ROOM_ID = 'delhi'
const RECONNECT_DELAY_MS = 1000
const MOVEMENT_SNAPSHOT_RETRY_BASE_DELAY_MS = 1000
const MOVEMENT_SNAPSHOT_RETRY_MAX_DELAY_MS = 10000

function getWebSocketUrl() {
  const apiUrl = new URL(API_BASE_URL)
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  apiUrl.pathname = '/ws'
  apiUrl.search = ''
  apiUrl.hash = ''
  return apiUrl.toString()
}

export function useMultiplayerPresence({
  token,
  currentUser,
  playerPosition,
  status,
  onRoomCreatureEvent,
}) {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID)
  const [requestedRoomId, setRequestedRoomId] = useState('')
  const [connectionRequestVersion, setConnectionRequestVersion] = useState(0)
  const [activeRoomId, setActiveRoomId] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [onlinePlayers, setOnlinePlayers] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const clientRef = useRef(null)
  const subscriptionRef = useRef(null)
  const creatureSubscriptionRef = useRef(null)
  const movementSubscriptionRef = useRef(null)
  const movementSnapshotAbortControllerRef = useRef(null)
  const movementSnapshotRequestIdRef = useRef(0)
  const movementSnapshotInFlightRef = useRef(null)
  const movementSnapshotRefreshQueuedRef = useRef(false)
  const movementSnapshotForcedRefreshQueuedRef = useRef(false)
  const movementSnapshotRetryAttemptRef = useRef(0)
  const movementSnapshotRetryTimerRef = useRef(null)
  const refreshMovementSnapshotRef = useRef(() => Promise.resolve(false))
  const connectionIdRef = useRef(0)
  const subscriptionGenerationRef = useRef(0)
  const roomIdRef = useRef(roomId)
  const requestedRoomIdRef = useRef(requestedRoomId)
  const activeRoomIdRef = useRef('')
  const connectionStatusRef = useRef(connectionStatus)
  const playerPositionRef = useRef(playerPosition)
  const statusRef = useRef(status)
  const currentUserIdRef = useRef(currentUser?.userId)
  const lastSentPositionRef = useRef(null)
  const lastSentStatusRef = useRef('')
  const manualDisconnectRef = useRef(false)
  const roomCreatureEventHandlerRef = useRef(onRoomCreatureEvent)
  const movementStateRef = useRef(createMovementPlanState())
  const movementClockEstimatorRef = useRef(
    createServerClockOffsetEstimator(),
  )
  const pendingMovementStartRef = useRef(null)
  const pendingMovementStartTimerRef = useRef(null)
  const [movementPlans, setMovementPlans] = useState([])
  const [movementRoomSequence, setMovementRoomSequence] = useState(0)
  const [movementServerOffsetMs, setMovementServerOffsetMs] = useState(0)
  const [movementNeedsSnapshot, setMovementNeedsSnapshot] = useState(true)
  const [movementSnapshotStatus, setMovementSnapshotStatus] =
    useState('idle')
  const [movementErrorMessage, setMovementErrorMessage] = useState('')
  const [movementCommandPending, setMovementCommandPending] = useState(false)
  const [publishScheduler] = useState(() => createPresencePublishScheduler({
    now: () => performance.now(),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (timerId) => window.clearTimeout(timerId),
    onAttempt: () => {},
  }))

  useEffect(() => {
    playerPositionRef.current = playerPosition
  }, [playerPosition])

  useEffect(() => {
    roomCreatureEventHandlerRef.current = onRoomCreatureEvent
  }, [onRoomCreatureEvent])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    currentUserIdRef.current = currentUser?.userId
  }, [currentUser?.userId])

  useEffect(() => {
    roomIdRef.current = roomId
  }, [roomId])

  useEffect(() => {
    requestedRoomIdRef.current = requestedRoomId
  }, [requestedRoomId])

  const updateConnectionStatus = useCallback((nextStatus) => {
    connectionStatusRef.current = nextStatus
    setConnectionStatus(nextStatus)
  }, [])

  const clearMovementSnapshotRetry = useCallback((resetAttempt = true) => {
    if (movementSnapshotRetryTimerRef.current !== null) {
      window.clearTimeout(movementSnapshotRetryTimerRef.current)
      movementSnapshotRetryTimerRef.current = null
    }

    if (resetAttempt) {
      movementSnapshotRetryAttemptRef.current = 0
    }
  }, [])

  const scheduleMovementSnapshotRetry = useCallback((context) => {
    if (movementSnapshotRetryTimerRef.current !== null) {
      return
    }

    const attempt = movementSnapshotRetryAttemptRef.current
    const delayMs = Math.min(
      MOVEMENT_SNAPSHOT_RETRY_BASE_DELAY_MS * (2 ** attempt),
      MOVEMENT_SNAPSHOT_RETRY_MAX_DELAY_MS,
    )
    movementSnapshotRetryAttemptRef.current = attempt + 1
    movementSnapshotRetryTimerRef.current = window.setTimeout(() => {
      movementSnapshotRetryTimerRef.current = null
      void refreshMovementSnapshotRef.current(context)
    }, delayMs)
  }, [])

  const clearPendingMovementStart = useCallback(() => {
    if (pendingMovementStartTimerRef.current !== null) {
      window.clearTimeout(pendingMovementStartTimerRef.current)
      pendingMovementStartTimerRef.current = null
    }
    pendingMovementStartRef.current = null
    setMovementCommandPending(false)
  }, [])

  const updateMovementState = useCallback((nextState) => {
    movementStateRef.current = nextState
    setMovementPlans(Object.values(nextState.plansByPlayerId))
    setMovementRoomSequence(nextState.roomSequence)
    setMovementNeedsSnapshot(
      nextState.needsSnapshot || !nextState.hasSnapshot,
    )
    const pendingStart = pendingMovementStartRef.current
    const currentPlan = getMovementPlanForPlayer(
      nextState,
      currentUserIdRef.current,
    )

    if (pendingStart && currentPlan?.version > pendingStart.expectedVersion) {
      clearPendingMovementStart()
    }
  }, [clearPendingMovementStart])

  const resetMovementState = useCallback((nextRoomId = null) => {
    movementSnapshotRequestIdRef.current += 1
    movementSnapshotAbortControllerRef.current?.abort()
    movementSnapshotAbortControllerRef.current = null
    movementSnapshotInFlightRef.current = null
    movementSnapshotRefreshQueuedRef.current = false
    movementSnapshotForcedRefreshQueuedRef.current = false
    clearMovementSnapshotRetry()
    movementClockEstimatorRef.current.reset()
    clearPendingMovementStart()
    updateMovementState(createMovementPlanState({ roomCode: nextRoomId }))
    setMovementServerOffsetMs(0)
    setMovementSnapshotStatus('idle')
    setMovementErrorMessage('')
  }, [
    clearMovementSnapshotRetry,
    clearPendingMovementStart,
    updateMovementState,
  ])

  const observeServerTimestamp = useCallback(
    (serverTimestamp, clientReceiveTimeMs) => {
      try {
        const nextOffsetMs = movementClockEstimatorRef.current.observe(
          serverTimestamp,
          clientReceiveTimeMs,
        )
        setMovementServerOffsetMs(nextOffsetMs)
      } catch (error) {
        console.warn('Ignored invalid movement server timestamp.', {
          serverTimestamp,
          error,
        })
      }
    },
    [],
  )

  const refreshMovementSnapshot = useCallback(async (context = {}) => {
    const client = context.client || clientRef.current
    const currentRoomId = context.roomId || activeRoomIdRef.current
    const connectionGeneration =
      context.connectionGeneration ?? connectionIdRef.current
    const subscriptionGeneration =
      context.subscriptionGeneration ?? subscriptionGenerationRef.current

    if (
      !token ||
      !currentUser?.userId ||
      !client?.connected ||
      !currentRoomId ||
      !isCurrentMovementSubscription({
        client,
        currentClient: clientRef.current,
        connectionGeneration,
        currentConnectionGeneration: connectionIdRef.current,
        subscriptionGeneration,
        currentSubscriptionGeneration: subscriptionGenerationRef.current,
        roomCode: currentRoomId,
        currentRoomCode: activeRoomIdRef.current,
      })
    ) {
      return false
    }

    if (
      movementSnapshotRetryTimerRef.current !== null &&
      context.force !== true
    ) {
      return false
    }

    const inFlightRequest = movementSnapshotInFlightRef.current

    if (inFlightRequest) {
      if (
        inFlightRequest.client === client &&
        inFlightRequest.connectionGeneration === connectionGeneration &&
        inFlightRequest.subscriptionGeneration === subscriptionGeneration &&
        inFlightRequest.roomId === currentRoomId
      ) {
        movementSnapshotRefreshQueuedRef.current = true
        movementSnapshotForcedRefreshQueuedRef.current =
          movementSnapshotForcedRefreshQueuedRef.current ||
          context.force === true
      }
      return false
    }

    movementSnapshotRequestIdRef.current += 1
    const requestId = movementSnapshotRequestIdRef.current
    const abortController = new AbortController()
    movementSnapshotAbortControllerRef.current = abortController
    movementSnapshotInFlightRef.current = {
      client,
      connectionGeneration,
      requestId,
      roomId: currentRoomId,
      subscriptionGeneration,
    }
    clearMovementSnapshotRetry(false)
    setMovementSnapshotStatus('loading')

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const snapshot = await fetchMovementSnapshot(currentRoomId, token, {
          signal: abortController.signal,
        })

        if (
          requestId !== movementSnapshotRequestIdRef.current ||
          !isCurrentMovementSubscription({
            client,
            currentClient: clientRef.current,
            connectionGeneration,
            currentConnectionGeneration: connectionIdRef.current,
            subscriptionGeneration,
            currentSubscriptionGeneration: subscriptionGenerationRef.current,
            roomCode: currentRoomId,
            currentRoomCode: activeRoomIdRef.current,
          })
        ) {
          return false
        }

        const reconciliation = reconcileMovementSnapshot(
          movementStateRef.current,
          snapshot,
        )

        if (reconciliation.accepted) {
          observeServerTimestamp(snapshot.serverTimestamp, Date.now())
          updateMovementState(reconciliation.state)
          clearMovementSnapshotRetry()
          setMovementSnapshotStatus('ready')
          setMovementErrorMessage('')
          return true
        }

        if (reconciliation.reason !== 'stale-snapshot') {
          throw new TypeError(
            `Invalid movement snapshot: ${reconciliation.reason}`,
          )
        }
      }

      setMovementSnapshotStatus('stale')
      scheduleMovementSnapshotRetry({
        client,
        connectionGeneration,
        roomId: currentRoomId,
        subscriptionGeneration,
      })
      return false
    } catch (error) {
      if (error?.name === 'AbortError') {
        return false
      }

      console.warn('Could not recover authoritative movement state.', {
        roomCode: currentRoomId,
        connectionGeneration,
        subscriptionGeneration,
        error,
      })
      setMovementSnapshotStatus('error')
      setMovementErrorMessage(
        error.status === 401
          ? 'Movement authorization expired'
          : 'Authoritative movement state is temporarily unavailable',
      )
      scheduleMovementSnapshotRetry({
        client,
        connectionGeneration,
        roomId: currentRoomId,
        subscriptionGeneration,
      })
      return false
    } finally {
      if (requestId === movementSnapshotRequestIdRef.current) {
        movementSnapshotAbortControllerRef.current = null
        movementSnapshotInFlightRef.current = null
        const forceRefreshAgain =
          movementSnapshotForcedRefreshQueuedRef.current
        const shouldRefreshAgain =
          forceRefreshAgain ||
          (
            movementSnapshotRefreshQueuedRef.current &&
            (
              movementStateRef.current.needsSnapshot ||
              !movementStateRef.current.hasSnapshot
            )
          )
        movementSnapshotRefreshQueuedRef.current = false
        movementSnapshotForcedRefreshQueuedRef.current = false

        if (
          shouldRefreshAgain &&
          (
            forceRefreshAgain ||
            movementSnapshotRetryTimerRef.current === null
          )
        ) {
          void Promise.resolve().then(() => refreshMovementSnapshotRef.current({
            client,
            connectionGeneration,
            force: forceRefreshAgain,
            roomId: currentRoomId,
            subscriptionGeneration,
          }))
        }
      }
    }
  }, [
    clearMovementSnapshotRetry,
    currentUser?.userId,
    observeServerTimestamp,
    scheduleMovementSnapshotRetry,
    token,
    updateMovementState,
  ])

  useEffect(() => {
    refreshMovementSnapshotRef.current = refreshMovementSnapshot
  }, [refreshMovementSnapshot])

  const publishPresence = useCallback((options = {}) => {
    const {
      force = false,
      position = playerPositionRef.current,
      reason = 'position-change',
      status: statusOverride,
    } = options
    const client = clientRef.current
    const currentPosition = position
    const currentRoomId = activeRoomIdRef.current

    if (
      !client?.connected ||
      !currentRoomId ||
      !currentPosition
    ) {
      return false
    }

    const nextStatus = statusOverride || statusRef.current || 'IDLE'
    publishScheduler.markAttempt()

    if (!shouldPublishPresence({
      force,
      lastSentPosition: lastSentPositionRef.current,
      lastSentStatus: lastSentStatusRef.current,
      position: currentPosition,
      status: nextStatus,
    })) {
      return false
    }

    const payload = {
      lat: currentPosition.lat,
      lon: currentPosition.lon,
      status: nextStatus,
    }

    try {
      client.publish({
        destination: `/app/rooms/${currentRoomId}/presence`,
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.warn('Could not publish multiplayer presence.', {
        roomCode: currentRoomId,
        playerId: currentUser?.userId,
        connectionId: connectionIdRef.current,
        reason,
        error,
      })
      return false
    }

    lastSentPositionRef.current = {
      lat: currentPosition.lat,
      lon: currentPosition.lon,
    }
    lastSentStatusRef.current = nextStatus
    return true
  }, [currentUser?.userId, publishScheduler])

  useEffect(() => {
    publishScheduler.setOnAttempt(publishPresence)
  }, [publishPresence, publishScheduler])

  const startRoomMovement = useCallback((intent) => {
    const client = clientRef.current
    const currentRoomId = activeRoomIdRef.current
    const movementState = movementStateRef.current

    if (
      !client?.connected ||
      !currentRoomId ||
      !movementState.hasSnapshot ||
      movementState.needsSnapshot ||
      pendingMovementStartRef.current
    ) {
      setMovementErrorMessage(
        'Waiting for authoritative movement state to synchronize',
      )
      return false
    }

    const currentPlan = getMovementPlanForPlayer(
      movementState,
      currentUser?.userId,
    )

    try {
      const expectedVersion = currentPlan?.version ?? 0
      const commandId = publishMovementStart(client, currentRoomId, {
        ...intent,
        expectedMovementVersion: expectedVersion,
      })

      if (!commandId) {
        throw new Error('Movement socket closed before the command was sent')
      }

      pendingMovementStartRef.current = { commandId, expectedVersion }
      setMovementCommandPending(true)
      pendingMovementStartTimerRef.current = window.setTimeout(() => {
        clearPendingMovementStart()
        setMovementErrorMessage(
          'Movement command was not confirmed; state is being refreshed',
        )
        void refreshMovementSnapshot({ force: true })
      }, 15000)
      setMovementErrorMessage('')
      return commandId
    } catch (error) {
      console.warn('Could not send authoritative movement intent.', {
        roomCode: currentRoomId,
        playerId: currentUser?.userId,
        error,
      })
      setMovementErrorMessage('Could not send movement command')
      return false
    }
  }, [
    clearPendingMovementStart,
    currentUser?.userId,
    refreshMovementSnapshot,
  ])

  const cancelRoomMovement = useCallback(() => {
    const client = clientRef.current
    const currentRoomId = activeRoomIdRef.current
    const currentPlan = getMovementPlanForPlayer(
      movementStateRef.current,
      currentUser?.userId,
    )

    if (
      !client?.connected ||
      !currentRoomId ||
      currentPlan?.status !== 'MOVING'
    ) {
      return false
    }

    try {
      const commandId = publishMovementCancel(
        client,
        currentRoomId,
        currentPlan,
      )

      if (!commandId) {
        throw new Error('Movement socket closed before cancellation was sent')
      }

      clearPendingMovementStart()
      setMovementErrorMessage('')
      return commandId
    } catch (error) {
      console.warn('Could not send authoritative movement cancellation.', {
        roomCode: currentRoomId,
        playerId: currentUser?.userId,
        movementId: currentPlan.movementId,
        error,
      })
      setMovementErrorMessage('Could not cancel movement')
      return false
    }
  }, [clearPendingMovementStart, currentUser?.userId])

  const disconnectPresence = useCallback((reason = 'manual') => {
    manualDisconnectRef.current = true
    const client = clientRef.current
    const subscription = subscriptionRef.current
    const creatureSubscription = creatureSubscriptionRef.current
    const movementSubscription = movementSubscriptionRef.current
    const currentRoomId = activeRoomIdRef.current
    const hadActivePresence = Boolean(
      client ||
      subscription ||
      movementSubscription ||
      currentRoomId ||
      requestedRoomIdRef.current ||
      connectionStatusRef.current !== 'disconnected',
    )

    if (!hadActivePresence) {
      return
    }

    if (
      reason === 'game-ended' ||
      reason === 'room-closed' ||
      String(reason).startsWith('room-closed:')
    ) {
      cancelRoomMovement()
    }

    clientRef.current = null
    subscriptionRef.current = null
    creatureSubscriptionRef.current = null
    movementSubscriptionRef.current = null
    connectionIdRef.current += 1
    subscriptionGenerationRef.current += 1
    activeRoomIdRef.current = ''
    requestedRoomIdRef.current = ''
    lastSentPositionRef.current = null
    lastSentStatusRef.current = ''
    publishScheduler.reset()
    setRequestedRoomId('')
    setActiveRoomId('')
    setOnlinePlayers([])
    updateConnectionStatus('disconnected')
    setErrorMessage('')
    resetMovementState()

    if (subscription && client?.connected) {
      subscription.unsubscribe()
    }

    if (creatureSubscription && client?.connected) {
      creatureSubscription.unsubscribe()
    }

    if (movementSubscription && client?.connected) {
      movementSubscription.unsubscribe()
    }

    if (client?.active) {
      void client.deactivate()
    }
  }, [
    cancelRoomMovement,
    publishScheduler,
    resetMovementState,
    updateConnectionStatus,
  ])

  const connectPresence = useCallback((nextRequestedRoomId, options = {}) => {
    const { enabled = true, reason = 'disabled' } = options

    if (!enabled) {
      disconnectPresence(reason)
      return
    }

    if (!token || !currentUser?.userId) {
      setErrorMessage('Sign in to use multiplayer')
      return
    }

    const nextRoomId =
      (nextRequestedRoomId || roomIdRef.current).trim() || DEFAULT_ROOM_ID

    if (
      requestedRoomIdRef.current === nextRoomId &&
      clientRef.current?.active
    ) {
      return
    }

    setRoomId(nextRoomId)
    requestedRoomIdRef.current = nextRoomId
    setRequestedRoomId(nextRoomId)
    setConnectionRequestVersion((version) => version + 1)
    setActiveRoomId(nextRoomId)
    activeRoomIdRef.current = nextRoomId
    setOnlinePlayers([])
    setErrorMessage('')
    resetMovementState(nextRoomId)
    updateConnectionStatus('connecting')
  }, [
    currentUser?.userId,
    disconnectPresence,
    resetMovementState,
    token,
    updateConnectionStatus,
  ])

  useEffect(() => {
    if (!token || !currentUser?.userId || !requestedRoomId) {
      return undefined
    }

    const nextRoomId = requestedRoomId.trim() || DEFAULT_ROOM_ID
    const connectionId = connectionIdRef.current + 1
    connectionIdRef.current = connectionId
    manualDisconnectRef.current = false
    activeRoomIdRef.current = nextRoomId

    const client = new Client({
      brokerURL: getWebSocketUrl(),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      reconnectDelay: RECONNECT_DELAY_MS,
      debug: () => {},
      onConnect: () => {
        if (
          clientRef.current !== client ||
          connectionIdRef.current !== connectionId
        ) {
          return
        }

        const subscriptionGeneration =
          subscriptionGenerationRef.current + 1
        subscriptionGenerationRef.current = subscriptionGeneration

        if (subscriptionRef.current && client.connected) {
          subscriptionRef.current.unsubscribe()
        }
        if (creatureSubscriptionRef.current && client.connected) {
          creatureSubscriptionRef.current.unsubscribe()
        }
        if (movementSubscriptionRef.current && client.connected) {
          movementSubscriptionRef.current.unsubscribe()
        }
        subscriptionRef.current = null
        creatureSubscriptionRef.current = null
        movementSubscriptionRef.current = null

        updateConnectionStatus('connected')
        setErrorMessage('')

        subscriptionRef.current = client.subscribe(
          `/topic/rooms/${nextRoomId}/presence`,
          (message) => {
            if (!isCurrentPresenceSubscription({
              client,
              currentClient: clientRef.current,
              connectionId,
              currentConnectionId: connectionIdRef.current,
              subscriptionGeneration,
              currentSubscriptionGeneration:
                subscriptionGenerationRef.current,
              roomId: nextRoomId,
              currentRoomId: activeRoomIdRef.current,
            })) {
              return
            }

            try {
              const payload = JSON.parse(message.body)

              if (!Array.isArray(payload)) {
                throw new TypeError('Presence payload must be an array')
              }

              const nextPlayers = normalizePresencePlayers(
                payload,
              )
              setOnlinePlayers((currentPlayers) => (
                reconcilePresencePlayers(currentPlayers, nextPlayers).players
              ))
            } catch (error) {
              console.warn('Ignored an invalid multiplayer presence update.', {
                roomCode: nextRoomId,
                playerId: currentUser?.userId,
                connectionId,
                subscriptionGeneration,
                error,
              })
            }
          },
        )

        creatureSubscriptionRef.current = client.subscribe(
          `/topic/rooms/${nextRoomId}/creatures`,
          (message) => {
            if (!isCurrentPresenceSubscription({
              client,
              currentClient: clientRef.current,
              connectionId,
              currentConnectionId: connectionIdRef.current,
              subscriptionGeneration,
              currentSubscriptionGeneration:
                subscriptionGenerationRef.current,
              roomId: nextRoomId,
              currentRoomId: activeRoomIdRef.current,
            })) {
              return
            }

            try {
              const creatureEvent = JSON.parse(message.body)
              console.debug('[multiplayer-creatures]', 'creature event received', {
                roomCode: nextRoomId,
                playerId: currentUser?.userId,
                eventType: creatureEvent?.eventType,
                creatureId: creatureEvent?.creature?.instanceId,
              })
              roomCreatureEventHandlerRef.current?.(creatureEvent)
            } catch (error) {
              console.warn('Ignored an invalid room creature update.', {
                roomCode: nextRoomId,
                playerId: currentUser?.userId,
                connectionId,
                subscriptionGeneration,
                error,
              })
            }
          },
        )

        movementSubscriptionRef.current = client.subscribe(
          movementTopic(nextRoomId),
          (message) => {
            if (!isCurrentMovementSubscription({
              client,
              currentClient: clientRef.current,
              connectionGeneration: connectionId,
              currentConnectionGeneration: connectionIdRef.current,
              subscriptionGeneration,
              currentSubscriptionGeneration:
                subscriptionGenerationRef.current,
              roomCode: nextRoomId,
              currentRoomCode: activeRoomIdRef.current,
            })) {
              return
            }

            try {
              const receiveTimeMs = Date.now()
              const movementEvent = JSON.parse(message.body)
              const result = applyMovementEvent(
                movementStateRef.current,
                movementEvent,
              )

              if (result.state !== movementStateRef.current) {
                updateMovementState(result.state)
              }

              if (result.accepted) {
                observeServerTimestamp(
                  movementEvent.serverTimestamp,
                  receiveTimeMs,
                )
                setMovementErrorMessage('')
              }

              if (result.needsSnapshot) {
                void refreshMovementSnapshot({
                  client,
                  connectionGeneration: connectionId,
                  roomId: nextRoomId,
                  subscriptionGeneration,
                })
              }
            } catch (error) {
              console.warn('Ignored invalid room movement event.', {
                roomCode: nextRoomId,
                playerId: currentUser?.userId,
                connectionGeneration: connectionId,
                subscriptionGeneration,
                error,
              })
            }
          },
        )

        void refreshMovementSnapshot({
          client,
          connectionGeneration: connectionId,
          roomId: nextRoomId,
          subscriptionGeneration,
        })
        publishPresence({ force: true, reason: 'connection-established' })
      },
      onStompError: () => {
        if (
          clientRef.current !== client ||
          connectionIdRef.current !== connectionId
        ) {
          return
        }

        publishScheduler.cancel()
        updateConnectionStatus('error')
        setErrorMessage('Multiplayer connection was rejected')
      },
      onWebSocketError: () => {
        if (
          clientRef.current !== client ||
          connectionIdRef.current !== connectionId
        ) {
          return
        }

        publishScheduler.cancel()
        updateConnectionStatus('error')
        setErrorMessage('Multiplayer connection failed')
      },
      onWebSocketClose: () => {
        if (
          manualDisconnectRef.current ||
          clientRef.current !== client ||
          connectionIdRef.current !== connectionId
        ) {
          return
        }

        subscriptionRef.current = null
        creatureSubscriptionRef.current = null
        movementSubscriptionRef.current = null
        subscriptionGenerationRef.current += 1
        movementSnapshotRequestIdRef.current += 1
        movementSnapshotAbortControllerRef.current?.abort()
        movementSnapshotAbortControllerRef.current = null
        movementSnapshotInFlightRef.current = null
        movementSnapshotRefreshQueuedRef.current = false
        movementSnapshotForcedRefreshQueuedRef.current = false
        clearMovementSnapshotRetry()
        updateMovementState({
          ...movementStateRef.current,
          hasSnapshot: false,
          needsSnapshot: true,
        })
        setMovementSnapshotStatus('stale')
        publishScheduler.cancel()
        updateConnectionStatus('connecting')
        setErrorMessage('Multiplayer reconnecting')
      },
    })

    clientRef.current = client
    client.activate()

    return () => {
      const ownsClient = clientRef.current === client
      const subscription = subscriptionRef.current
      const creatureSubscription = creatureSubscriptionRef.current
      const movementSubscription = movementSubscriptionRef.current

      if (ownsClient && subscription && client.connected) {
        subscription.unsubscribe()
      }

      if (ownsClient && creatureSubscription && client.connected) {
        creatureSubscription.unsubscribe()
      }

      if (ownsClient && movementSubscription && client.connected) {
        movementSubscription.unsubscribe()
      }

      if (ownsClient) {
        subscriptionRef.current = null
        creatureSubscriptionRef.current = null
        movementSubscriptionRef.current = null
        clientRef.current = null
        activeRoomIdRef.current = ''
        lastSentPositionRef.current = null
        lastSentStatusRef.current = ''
        publishScheduler.reset()
        connectionIdRef.current += 1
        subscriptionGenerationRef.current += 1
        resetMovementState()
      }

      if (client.active) {
        void client.deactivate()
      }
    }
  }, [
    connectionRequestVersion,
    clearMovementSnapshotRetry,
    currentUser?.userId,
    publishPresence,
    publishScheduler,
    observeServerTimestamp,
    refreshMovementSnapshot,
    requestedRoomId,
    resetMovementState,
    token,
    updateMovementState,
    updateConnectionStatus,
  ])

  useEffect(() => {
    if (token && currentUser?.userId) {
      return undefined
    }

    const timerId = window.setTimeout(disconnectPresence, 0)

    return () => window.clearTimeout(timerId)
  }, [currentUser?.userId, disconnectPresence, token])

  useEffect(() => {
    return () => {
      disconnectPresence()
    }
  }, [disconnectPresence])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        clientRef.current?.connected &&
        (
          movementStateRef.current.needsSnapshot ||
          !movementStateRef.current.hasSnapshot
        )
      ) {
        void refreshMovementSnapshot({ force: true })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshMovementSnapshot])

  return {
    multiplayerEnabled: connectionStatus === 'connected',
    roomId,
    activeRoomId,
    connectionStatus,
    movementErrorMessage,
    movementCommandPending,
    movementNeedsSnapshot,
    movementPlans,
    movementRoomSequence,
    movementServerOffsetMs,
    movementSnapshotStatus,
    onlinePlayers,
    errorMessage,
    setRoomId,
    connectPresence,
    startRoomMovement,
    cancelRoomMovement,
    refreshMovementSnapshot,
    disconnectPresence,
    sendPresenceUpdate: publishPresence,
  }
}
