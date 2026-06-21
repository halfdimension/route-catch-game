import { Client } from '@stomp/stompjs'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { API_BASE_URL } from '../config/apiConfig'

const DEFAULT_ROOM_ID = 'delhi'
const PRESENCE_THROTTLE_MS = 1500

function getWebSocketUrl() {
  const apiUrl = new URL(API_BASE_URL)
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  apiUrl.pathname = '/ws'
  apiUrl.search = ''
  apiUrl.hash = ''
  return apiUrl.toString()
}

function normalizePlayers(payload) {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload.filter((player) => (
    player &&
    player.userId &&
    Number.isFinite(Number(player.lat)) &&
    Number.isFinite(Number(player.lon))
  ))
}

export function useMultiplayerPresence({
  token,
  currentUser,
  playerPosition,
  status,
}) {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID)
  const [activeRoomId, setActiveRoomId] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [onlinePlayers, setOnlinePlayers] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const clientRef = useRef(null)
  const activeRoomIdRef = useRef('')
  const playerPositionRef = useRef(playerPosition)
  const statusRef = useRef(status)
  const lastSentAtRef = useRef(0)
  const manualDisconnectRef = useRef(false)

  useEffect(() => {
    playerPositionRef.current = playerPosition
  }, [playerPosition])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const publishPresence = useCallback(() => {
    const client = clientRef.current
    const currentPosition = playerPositionRef.current
    const currentRoomId = activeRoomIdRef.current

    if (
      !client?.connected ||
      !currentRoomId ||
      !currentPosition
    ) {
      return
    }

    client.publish({
      destination: `/app/rooms/${currentRoomId}/presence`,
      body: JSON.stringify({
        lat: currentPosition.lat,
        lon: currentPosition.lon,
        status: statusRef.current || 'IDLE',
      }),
    })
    lastSentAtRef.current = Date.now()
  }, [])

  const disconnectPresence = useCallback(() => {
    manualDisconnectRef.current = true
    const client = clientRef.current
    clientRef.current = null
    activeRoomIdRef.current = ''
    setActiveRoomId('')
    setOnlinePlayers([])
    setConnectionStatus('disconnected')

    if (client?.active) {
      void client.deactivate()
    }
  }, [])

  const connectPresence = useCallback((requestedRoomId) => {
    if (!token || !currentUser) {
      setErrorMessage('Sign in to use multiplayer')
      return
    }

    const nextRoomId = (requestedRoomId || roomId).trim() || DEFAULT_ROOM_ID
    disconnectPresence()
    manualDisconnectRef.current = false
    setRoomId(nextRoomId)
    setActiveRoomId(nextRoomId)
    activeRoomIdRef.current = nextRoomId
    setOnlinePlayers([])
    setErrorMessage('')
    setConnectionStatus('connecting')

    const client = new Client({
      brokerURL: getWebSocketUrl(),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      reconnectDelay: 0,
      debug: () => {},
      onConnect: () => {
        setConnectionStatus('connected')
        client.subscribe(
          `/topic/rooms/${nextRoomId}/presence`,
          (message) => {
            try {
              setOnlinePlayers(normalizePlayers(JSON.parse(message.body)))
            } catch {
              setOnlinePlayers([])
            }
          },
        )
        publishPresence()
      },
      onStompError: () => {
        setConnectionStatus('error')
        setErrorMessage('Multiplayer connection was rejected')
      },
      onWebSocketError: () => {
        setConnectionStatus('error')
        setErrorMessage('Multiplayer connection failed')
      },
      onWebSocketClose: () => {
        if (manualDisconnectRef.current) {
          return
        }

        setConnectionStatus('error')
        setErrorMessage('Multiplayer disconnected')
      },
    })

    clientRef.current = client
    client.activate()
  }, [currentUser, disconnectPresence, publishPresence, roomId, token])

  useEffect(() => {
    if (token && currentUser) {
      return undefined
    }

    const timerId = window.setTimeout(disconnectPresence, 0)

    return () => window.clearTimeout(timerId)
  }, [currentUser, disconnectPresence, token])

  useEffect(() => {
    return () => {
      disconnectPresence()
    }
  }, [disconnectPresence])

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return undefined
    }

    const elapsed = Date.now() - lastSentAtRef.current
    const delay = Math.max(0, PRESENCE_THROTTLE_MS - elapsed)
    const timerId = window.setTimeout(publishPresence, delay)

    return () => window.clearTimeout(timerId)
  }, [
    connectionStatus,
    playerPosition?.lat,
    playerPosition?.lon,
    publishPresence,
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
