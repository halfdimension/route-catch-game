import { Client } from '@stomp/stompjs'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { API_BASE_URL } from '../config/apiConfig'
import {
  createPresencePublishScheduler,
  isCurrentPresenceSubscription,
  normalizePresencePlayers,
  reconcilePresencePlayers,
  shouldPublishPresence,
} from './presenceSync'

const DEFAULT_ROOM_ID = 'delhi'
const RECONNECT_DELAY_MS = 1000

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
  const connectionIdRef = useRef(0)
  const subscriptionGenerationRef = useRef(0)
  const roomIdRef = useRef(roomId)
  const requestedRoomIdRef = useRef(requestedRoomId)
  const activeRoomIdRef = useRef('')
  const connectionStatusRef = useRef(connectionStatus)
  const playerPositionRef = useRef(playerPosition)
  const statusRef = useRef(status)
  const lastSentPositionRef = useRef(null)
  const lastSentStatusRef = useRef('')
  const manualDisconnectRef = useRef(false)
  const roomCreatureEventHandlerRef = useRef(onRoomCreatureEvent)
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
    roomIdRef.current = roomId
  }, [roomId])

  useEffect(() => {
    requestedRoomIdRef.current = requestedRoomId
  }, [requestedRoomId])

  const updateConnectionStatus = useCallback((nextStatus) => {
    connectionStatusRef.current = nextStatus
    setConnectionStatus(nextStatus)
  }, [])

  const publishPresence = useCallback((options = {}) => {
    const {
      force = false,
      reason = 'position-change',
    } = options
    const client = clientRef.current
    const currentPosition = playerPositionRef.current
    const currentRoomId = activeRoomIdRef.current

    if (
      !client?.connected ||
      !currentRoomId ||
      !currentPosition
    ) {
      return false
    }

    const nextStatus = statusRef.current || 'IDLE'
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

  const schedulePresencePublish = useCallback(() => {
    if (connectionStatusRef.current !== 'connected') {
      return
    }

    publishScheduler.schedule()
  }, [publishScheduler])

  const disconnectPresence = useCallback(() => {
    manualDisconnectRef.current = true
    const client = clientRef.current
    const subscription = subscriptionRef.current
    const creatureSubscription = creatureSubscriptionRef.current
    const currentRoomId = activeRoomIdRef.current
    const hadActivePresence = Boolean(
      client ||
      subscription ||
      currentRoomId ||
      requestedRoomIdRef.current ||
      connectionStatusRef.current !== 'disconnected',
    )

    if (!hadActivePresence) {
      return
    }

    clientRef.current = null
    subscriptionRef.current = null
    creatureSubscriptionRef.current = null
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

    if (subscription && client?.connected) {
      subscription.unsubscribe()
    }

    if (creatureSubscription && client?.connected) {
      creatureSubscription.unsubscribe()
    }

    if (client?.active) {
      void client.deactivate()
    }
  }, [publishScheduler, updateConnectionStatus])

  const connectPresence = useCallback((nextRequestedRoomId, options = {}) => {
    const { enabled = true } = options

    if (!enabled) {
      disconnectPresence()
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
    updateConnectionStatus('connecting')
  }, [
    currentUser?.userId,
    disconnectPresence,
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
        subscriptionRef.current = null
        creatureSubscriptionRef.current = null

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
        subscriptionGenerationRef.current += 1
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

      if (ownsClient && subscription && client.connected) {
        subscription.unsubscribe()
      }

      if (ownsClient && creatureSubscription && client.connected) {
        creatureSubscription.unsubscribe()
      }

      if (ownsClient) {
        subscriptionRef.current = null
        creatureSubscriptionRef.current = null
        clientRef.current = null
        activeRoomIdRef.current = ''
        lastSentPositionRef.current = null
        lastSentStatusRef.current = ''
        publishScheduler.reset()
        connectionIdRef.current += 1
        subscriptionGenerationRef.current += 1
      }

      if (client.active) {
        void client.deactivate()
      }
    }
  }, [
    connectionRequestVersion,
    currentUser?.userId,
    publishPresence,
    publishScheduler,
    requestedRoomId,
    token,
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
    if (connectionStatus === 'connected') {
      schedulePresencePublish()
    }
  }, [
    connectionStatus,
    playerPosition?.lat,
    playerPosition?.lon,
    schedulePresencePublish,
    status,
  ])

  return {
    multiplayerEnabled: connectionStatus === 'connected',
    roomId,
    activeRoomId,
    connectionStatus,
    onlinePlayers,
    errorMessage,
    setRoomId,
    connectPresence,
    disconnectPresence,
    sendPresenceUpdate: publishPresence,
  }
}
