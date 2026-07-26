import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  closeRoom,
  createRoom,
  endRoomGame,
  getRoomGame,
  getRoom,
  getRoomSettingsEndpoint,
  joinRoom,
  leaveRoom,
  listMyRooms,
  spawnRoomCreatures,
  startRoomGame,
  updateRoomSettings,
} from '../api/multiplayerRoomClient'
import RoomSettingsPanel from './RoomSettingsPanel'

const DEFAULT_ROOM_NAME = 'Delhi Room'
const DEFAULT_GAME_DURATION_SECONDS = 60
const GAME_DURATION_OPTIONS = [30, 60, 90, 120]
const LOBBY_ROOM_POLL_INTERVAL_MS = 2000
const LOBBY_ROOM_POLL_MAX_RETRY_MS = 15000
const ROOM_POLL_CONNECTION_STATUS = {
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
}
const DEFAULT_SPAWN_CENTER = {
  centerLat: 28.6139,
  centerLon: 77.209,
}
const DEFAULT_SPAWN_REQUEST = {
  count: 5,
  ttlSeconds: 120,
  radiusMeters: 500,
}

function normalizeRoomCode(roomCode) {
  return roomCode.trim().toUpperCase()
}

function getRoomStatusClass(status) {
  return `is-${(status || 'unknown').toLowerCase().replaceAll('_', '-')}`
}

function formatRemainingTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function getMemberCount(room) {
  return Array.isArray(room?.members) ? room.members.length : 0
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function isNetworkFetchError(error) {
  return !error?.status && !isAbortError(error)
}

function isExplicitRoomClosedError(error) {
  if (
    error?.errorCode === 'ROOM_NOT_FOUND' &&
    [404, 410].includes(error.status)
  ) {
    return true
  }

  return (
    error?.errorCode === 'ROOM_CLOSED' &&
    [404, 409, 410].includes(error.status)
  )
}

function MultiplayerPanel({
  view = 'rooms',
  roomCode,
  isAuthenticated,
  currentUser,
  token,
  connectionStatus,
  onlinePlayerCount,
  errorMessage,
  playerPosition,
  sharedRoomCreatures = [],
  onConnectPresence,
  onDisconnectPresence,
  onRoomContextChange,
  onRefreshSharedRoomCreatures,
  onSessionExpired,
}) {
  const navigate = useNavigate()
  const [roomName, setRoomName] = useState(DEFAULT_ROOM_NAME)
  const [joinCode, setJoinCode] = useState('')
  const [activeRoom, setActiveRoom] = useState(null)
  const [myRooms, setMyRooms] = useState([])
  const [isActionPending, setIsActionPending] = useState(false)
  const [isRoomsLoading, setIsRoomsLoading] = useState(false)
  const [roomMessage, setRoomMessage] = useState('')
  const [roomError, setRoomError] = useState('')
  const [gameState, setGameState] = useState(null)
  const [gameRemainingSeconds, setGameRemainingSeconds] = useState(null)
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_GAME_DURATION_SECONDS)
  const [isSpawningRoomCreatures, setIsSpawningRoomCreatures] = useState(false)
  const [isSavingRoomSettings, setIsSavingRoomSettings] = useState(false)
  const [roomSettingsError, setRoomSettingsError] = useState('')
  const [roomPollConnectionStatus, setRoomPollConnectionStatus] = useState(
    ROOM_POLL_CONNECTION_STATUS.CONNECTED,
  )
  const routeRoomCode = roomCode ? normalizeRoomCode(roomCode) : ''
  const isPlayView = view === 'play'
  const isLobbyView = view === 'lobby'
  const activeRoomCode = activeRoom?.roomCode
  const currentPlayerId = currentUser?.userId
  const routeCleanupRef = useRef({
    activeRoomCode: '',
    currentPlayerId: '',
    onDisconnectPresence,
    view,
  })
  const autoEnteredRoomGameRef = useRef('')
  const isSavingRoomSettingsRef = useRef(false)

  const handleRoomError = useCallback((error, fallbackMessage) => {
    if (error.status === 401) {
      setRoomError('Session expired. Please sign in again.')
      onSessionExpired?.()
      return
    }

    setRoomError(error.message || fallbackMessage)
  }, [onSessionExpired])

  const refreshMyRooms = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setMyRooms([])
      return
    }

    setIsRoomsLoading(true)
    try {
      const rooms = await listMyRooms(token)
      setMyRooms(Array.isArray(rooms) ? rooms : [])
    } catch (error) {
      if (error.status === 401) {
        setRoomError('Session expired. Please sign in again.')
        onSessionExpired?.()
      }
    } finally {
      setIsRoomsLoading(false)
    }
  }, [isAuthenticated, onSessionExpired, token])

  const refreshRoomState = useCallback(
    async (
      roomCodeToFetch,
      {
        reason = 'room-refresh',
        shouldLogLobbyFetch = false,
        shouldSyncJoinCode = false,
        signal,
      } = {},
    ) => {
      if (!roomCodeToFetch || !isAuthenticated || !token) {
        return null
      }

      if (shouldLogLobbyFetch) {
        console.debug('[multiplayer-lobby]', 'lobby room fetch start', {
          roomCode: roomCodeToFetch,
          reason,
        })
      }

      const room = await getRoom(roomCodeToFetch, token, { signal })
      console.debug('[multiplayer-room-settings]', 'room settings from refresh', {
        roomCode: room?.roomCode || roomCodeToFetch,
        reason,
        settings: room?.settings,
      })

      if (room?.status === 'CLOSED') {
        console.debug('[multiplayer-lobby]', 'room explicitly closed', {
          roomCode: room?.roomCode || roomCodeToFetch,
          reason,
        })
      }

      if (shouldLogLobbyFetch) {
        console.debug('[multiplayer-lobby]', 'lobby room fetch success', {
          roomCode: room?.roomCode || roomCodeToFetch,
          memberCount: getMemberCount(room),
          reason,
        })
      }

      setActiveRoom(room)
      if (shouldSyncJoinCode && room?.roomCode) {
        setJoinCode(room.roomCode)
      }
      setRoomError('')

      return room
    },
    [isAuthenticated, token],
  )

  useEffect(() => {
    onRoomContextChange?.({ activeRoom, gameState })
  }, [activeRoom, gameState, onRoomContextChange])

  useEffect(() => {
    if (
      !routeRoomCode ||
      isLobbyView ||
      isPlayView ||
      !isAuthenticated ||
      !token ||
      activeRoom?.roomCode === routeRoomCode
    ) {
      return
    }

    let isMounted = true
    const timerId = window.setTimeout(() => {
      refreshRoomState(routeRoomCode, {
        reason: 'route-room-load',
        shouldLogLobbyFetch: view === 'lobby',
        shouldSyncJoinCode: true,
      })
        .then((room) => {
          if (!isMounted || !room) {
            return
          }

          setRoomMessage('')
        })
        .catch((error) => {
          if (!isMounted) {
            return
          }

          handleRoomError(error, 'Could not load room.')
        })
    }, 0)

    return () => {
      isMounted = false
      window.clearTimeout(timerId)
    }
  }, [
    activeRoom?.roomCode,
    handleRoomError,
    isAuthenticated,
    isLobbyView,
    isPlayView,
    onConnectPresence,
    refreshRoomState,
    routeRoomCode,
    token,
    view,
  ])

  useEffect(() => {
    if (!isAuthenticated) {
      const timerId = window.setTimeout(() => {
        setActiveRoom(null)
        setMyRooms([])
        setGameState(null)
        setGameRemainingSeconds(null)
        setRoomMessage('')
        setRoomError('')
        onDisconnectPresence('not-authenticated')
      }, 0)

      return () => window.clearTimeout(timerId)
    }

    const timerId = window.setTimeout(() => {
      void refreshMyRooms()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [isAuthenticated, onDisconnectPresence, refreshMyRooms])

  useEffect(() => {
    if (
      isLobbyView ||
      isPlayView ||
      !activeRoomCode ||
      !token ||
      !isAuthenticated
    ) {
      return
    }

    let isMounted = true

    getRoom(activeRoomCode, token)
      .then((room) => {
        if (!isMounted) {
          return
        }

        if (room?.status === 'CLOSED') {
          console.debug('[multiplayer-presence]', 'received room closed event', {
            roomId: activeRoomCode,
            playerId: currentPlayerId,
            source: 'getRoom',
          })
          setActiveRoom(room)
          setRoomMessage('Room closed.')
          onDisconnectPresence('room-closed:getRoom')
          void refreshMyRooms()
          return
        }

        setActiveRoom(room)
      })
      .catch((error) => {
        if (!isMounted || error.status !== 401) {
          return
        }

        setRoomError('Session expired. Please sign in again.')
        onSessionExpired?.()
      })

    return () => {
      isMounted = false
    }
  }, [
    activeRoomCode,
    currentPlayerId,
    isAuthenticated,
    isLobbyView,
    isPlayView,
    onDisconnectPresence,
    onSessionExpired,
    refreshMyRooms,
    token,
  ])

  const refreshRoomGame = useCallback(async () => {
    if (!activeRoomCode || !token || !isAuthenticated) {
      return
    }

    try {
      const nextGameState = await getRoomGame(activeRoomCode, token)
      setGameState(nextGameState)
      setGameRemainingSeconds(nextGameState?.remainingSeconds ?? null)

      if (nextGameState?.roomStatus) {
        if (nextGameState.roomStatus === 'CLOSED') {
          console.debug('[multiplayer-presence]', 'received room closed event', {
            roomId: activeRoomCode,
            playerId: currentPlayerId,
            source: 'getRoomGame',
          })
        }

        setActiveRoom((currentRoom) => (
          currentRoom?.roomCode === nextGameState.roomCode
            ? { ...currentRoom, status: nextGameState.roomStatus }
            : currentRoom
        ))
      }
    } catch (error) {
      if (error.status === 401) {
        setRoomError('Session expired. Please sign in again.')
        onSessionExpired?.()
      }
    }
  }, [
    activeRoomCode,
    currentPlayerId,
    isAuthenticated,
    onSessionExpired,
    token,
  ])

  useEffect(() => {
    if (!activeRoomCode || !token || !isAuthenticated) {
      return
    }

    let isPolling = true

    const pollRoomGame = async () => {
      if (!isPolling) {
        return
      }

      await refreshRoomGame()
    }

    void pollRoomGame()
    const intervalId = window.setInterval(() => {
      void pollRoomGame()
    }, 2000)

    return () => {
      isPolling = false
      window.clearInterval(intervalId)
    }
  }, [activeRoomCode, isAuthenticated, refreshRoomGame, token])

  useEffect(() => {
    if (gameState?.gameStatus !== 'RUNNING') {
      return
    }

    const intervalId = window.setInterval(() => {
      setGameRemainingSeconds((currentSeconds) => {
        if (currentSeconds === null || currentSeconds === undefined) {
          return currentSeconds
        }

        return Math.max(0, currentSeconds - 1)
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [gameState?.gameStatus, gameState?.startedAt, gameState?.endsAt])

  async function activateRoom(room, message) {
    setActiveRoom(room)
    setGameState(null)
    setGameRemainingSeconds(null)
    setJoinCode(room.roomCode)
    setRoomMessage(message)
    setRoomError('')
    await refreshMyRooms()

    if (view === 'rooms') {
      navigate(`/rooms/${room.roomCode}/lobby`)
    }
  }

  async function handleCreateRoom() {
    const nextRoomName = roomName.trim() || DEFAULT_ROOM_NAME
    setIsActionPending(true)
    setRoomMessage('')
    setRoomError('')

    try {
      const room = await createRoom({ roomName: nextRoomName }, token)
      await activateRoom(room, 'Room created.')
    } catch (error) {
      handleRoomError(error, 'Could not create room.')
    } finally {
      setIsActionPending(false)
    }
  }

  async function handleJoinRoom(roomCode = joinCode) {
    const normalizedRoomCode = normalizeRoomCode(roomCode)

    if (!normalizedRoomCode) {
      setRoomError('Enter a room code.')
      return
    }

    setIsActionPending(true)
    setRoomMessage('')
    setRoomError('')

    try {
      const room = await joinRoom(normalizedRoomCode, token)
      console.debug('[multiplayer-lobby]', 'join room success', {
        roomCode: room?.roomCode || normalizedRoomCode,
        memberCount: getMemberCount(room),
      })
      const freshRoom = await refreshRoomState(room?.roomCode || normalizedRoomCode, {
        reason: 'join-room-success',
        shouldLogLobbyFetch: view === 'lobby',
        shouldSyncJoinCode: true,
      })
      await activateRoom(freshRoom || room, 'Joined room.')
    } catch (error) {
      handleRoomError(error, 'Could not join room.')
    } finally {
      setIsActionPending(false)
    }
  }

  async function handleLeaveRoom() {
    if (!activeRoom?.roomCode) {
      return
    }

    setIsActionPending(true)
    setRoomMessage('')
    setRoomError('')

    try {
      await leaveRoom(activeRoom.roomCode, token)
      setActiveRoom(null)
      setGameState(null)
      setGameRemainingSeconds(null)
      setRoomMessage('Left room.')
      onDisconnectPresence('left-room')
      await refreshMyRooms()
      navigate('/rooms')
    } catch (error) {
      handleRoomError(error, 'Could not leave room.')
    } finally {
      setIsActionPending(false)
    }
  }

  async function handleCloseRoom() {
    if (!activeRoom?.roomCode) {
      return
    }

    setIsActionPending(true)
    setRoomMessage('')
    setRoomError('')

    try {
      await closeRoom(activeRoom.roomCode, token)
      setActiveRoom(null)
      setGameState(null)
      setGameRemainingSeconds(null)
      setRoomMessage('Room closed.')
      onDisconnectPresence('closed-room')
      await refreshMyRooms()
      navigate('/rooms')
    } catch (error) {
      handleRoomError(error, 'Could not close room.')
    } finally {
      setIsActionPending(false)
    }
  }

  async function handleStartRoomGame() {
    if (!activeRoom?.roomCode) {
      return
    }

    setIsActionPending(true)
    setRoomMessage('')
    setRoomError('')

    try {
      const nextGameState = await startRoomGame(
        activeRoom.roomCode,
        { durationSeconds: Number(durationSeconds) || DEFAULT_GAME_DURATION_SECONDS },
        token,
      )
      const startedRoomCode = nextGameState?.roomCode || activeRoom.roomCode
      setGameState(nextGameState)
      setGameRemainingSeconds(nextGameState?.remainingSeconds ?? null)
      setRoomMessage('Room game started.')

      try {
        await refreshRoomState(startedRoomCode, {
          reason: 'start-room-game-success',
          shouldLogLobbyFetch: view === 'lobby',
          shouldSyncJoinCode: true,
        })
      } catch (refreshError) {
        if (refreshError.status === 401) {
          onSessionExpired?.()
        }
      }

      navigate(`/rooms/${startedRoomCode}/play`)
    } catch (error) {
      handleRoomError(error, 'Could not start room game.')
    } finally {
      setIsActionPending(false)
    }
  }

  async function handleEndRoomGame() {
    if (!activeRoom?.roomCode) {
      return
    }

    setIsActionPending(true)
    setRoomMessage('')
    setRoomError('')

    try {
      const nextGameState = await endRoomGame(activeRoom.roomCode, token)
      setGameState(nextGameState)
      setGameRemainingSeconds(nextGameState?.remainingSeconds ?? null)
      setRoomMessage('Room game ended.')
      navigate(`/rooms/${activeRoom.roomCode}/lobby`)
    } catch (error) {
      handleRoomError(error, 'Could not end room game.')
    } finally {
      setIsActionPending(false)
    }
  }

  function handleEnterRoomGame() {
    if (!activeRoom?.roomCode) {
      return
    }

    navigate(`/rooms/${activeRoom.roomCode}/play`)
  }

  async function handleSpawnRoomCreatures() {
    if (!activeRoom?.roomCode) {
      return
    }

    if (!isHost) {
      setRoomError('Only host can spawn creatures')
      return
    }

    if (activeRoom.settings?.allowManualCreatureSpawn === false) {
      setRoomError('Manual creature spawning is disabled for this room.')
      return
    }

    if (gameStatus !== 'RUNNING') {
      setRoomError('Room game is not running')
      return
    }

    const playerLat = Number(playerPosition?.lat)
    const playerLon = Number(playerPosition?.lon)
    const hasPlayerCenter = Number.isFinite(playerLat) && Number.isFinite(playerLon)
    const spawnRequest = {
      ...(hasPlayerCenter
        ? { centerLat: playerLat, centerLon: playerLon }
        : DEFAULT_SPAWN_CENTER),
      ...DEFAULT_SPAWN_REQUEST,
    }

    setIsSpawningRoomCreatures(true)
    setRoomMessage('')
    setRoomError('')

    try {
      await spawnRoomCreatures(activeRoom.roomCode, spawnRequest, token)
      await onRefreshSharedRoomCreatures?.()
      setRoomMessage('Room creatures spawned.')
    } catch (error) {
      handleRoomError(error, 'Could not spawn room creatures.')
    } finally {
      setIsSpawningRoomCreatures(false)
    }
  }

  async function handleSaveRoomSettings(nextSettings) {
    if (!activeRoom?.roomCode || isSavingRoomSettingsRef.current) {
      return
    }

    const roomCodeToSave = activeRoom.roomCode
    const endpoint = getRoomSettingsEndpoint(roomCodeToSave)
    isSavingRoomSettingsRef.current = true
    setIsSavingRoomSettings(true)
    setRoomSettingsError('')
    setRoomMessage('')

    try {
      console.debug('[multiplayer-room-settings]', 'settings save started', {
        roomCode: roomCodeToSave,
        endpoint,
        payload: nextSettings,
      })
      const savedRoom = await updateRoomSettings(roomCodeToSave, nextSettings, token)
      console.debug('[multiplayer-room-settings]', 'settings save succeeded', {
        roomCode: savedRoom?.roomCode || roomCodeToSave,
        endpoint,
        settings: savedRoom?.settings,
      })
      if (savedRoom?.roomCode) {
        setActiveRoom(savedRoom)
      }
      setRoomSettingsError('')
      setRoomMessage('Room settings saved.')
    } catch (error) {
      if (isAbortError(error)) {
        console.debug('[multiplayer-room-settings]', 'request aborted', {
          roomCode: roomCodeToSave,
          endpoint,
        })
        return
      }

      console.debug('[multiplayer-room-settings]', 'settings save failed', {
        roomCode: roomCodeToSave,
        endpoint,
        status: error.status,
        errorCode: error.errorCode,
        message: error.message,
      })

      if (error.status === 401) {
        setRoomSettingsError('Session expired. Please sign in again.')
        onSessionExpired?.()
        return
      }

      if (error.status === 403) {
        setRoomSettingsError('Only the host can update room settings.')
        return
      }

      setRoomSettingsError(error.message || 'Could not save room settings.')
    } finally {
      isSavingRoomSettingsRef.current = false
      setIsSavingRoomSettings(false)
    }
  }

  const isHost = Boolean(
    activeRoom?.hostUserId && activeRoom.hostUserId === currentUser?.userId,
  )
  const isCurrentUserRoomMember = Boolean(
    currentPlayerId &&
    activeRoom?.members?.some((member) => member.userId === currentPlayerId),
  )
  const memberCount = activeRoom?.members?.length || 0
  const gameStatus = gameState?.gameStatus || 'WAITING'
  const roomStatus = gameState?.roomStatus || activeRoom?.status
  const canStartRoomGame = Boolean(
    isHost &&
    roomStatus === 'OPEN' &&
    (gameStatus === 'WAITING' || gameStatus === 'ENDED'),
  )
  const canEndRoomGame = Boolean(isHost && gameStatus === 'RUNNING')
  const canCloseRoom = Boolean(isHost && gameStatus !== 'RUNNING')
  const isManualCreatureSpawnAllowed =
    activeRoom?.settings?.allowManualCreatureSpawn !== false
  const canSpawnRoomCreatures = Boolean(
    isHost &&
    gameStatus === 'RUNNING' &&
    isManualCreatureSpawnAllowed,
  )

  const shouldShowRoomSetup = view === 'rooms'
  const shouldShowMemberList = view === 'lobby'
  const shouldShowRoomLinks = Boolean(activeRoom?.roomCode && view === 'rooms')
  const canEnterRoomGame = Boolean(isLobbyView && gameStatus === 'RUNNING')
  const presenceEnabled = Boolean(
    isAuthenticated &&
    token &&
    isPlayView &&
    activeRoomCode &&
    roomStatus !== 'CLOSED' &&
    gameStatus === 'RUNNING',
  )
  const presenceDecisionRoomCode = activeRoomCode || routeRoomCode
  const presenceDecisionReason = !isAuthenticated
    ? 'not-authenticated'
    : !isPlayView
      ? 'not-room-play-page'
      : !presenceDecisionRoomCode
        ? 'missing-room-code'
        : roomStatus === 'CLOSED'
          ? 'room-closed'
          : gameStatus === 'ENDED'
            ? 'game-ended'
            : gameStatus !== 'RUNNING'
              ? `game-${String(gameStatus).toLowerCase()}`
              : 'room-play-running'
  const displayedConnectionStatus = presenceEnabled
    ? connectionStatus
    : 'disconnected'
  const statusBadgeLabel = isLobbyView
    ? roomPollConnectionStatus === ROOM_POLL_CONNECTION_STATUS.RECONNECTING
      ? 'Reconnecting'
      : 'Lobby'
    : displayedConnectionStatus
  const statusBadgeClassName = isLobbyView
    ? roomPollConnectionStatus === ROOM_POLL_CONNECTION_STATUS.RECONNECTING
      ? 'reconnecting'
      : 'lobby'
    : displayedConnectionStatus
  const shouldShowStatusBadge = isPlayView || isLobbyView
  const visibleConnectionMessage =
    presenceEnabled && connectionStatus !== 'connected' ? errorMessage : ''
  const lobbyRoomCode = isLobbyView ? activeRoomCode || routeRoomCode : ''
  const playRoomCode = isPlayView ? activeRoomCode || routeRoomCode : ''
  const roomPollView = isLobbyView ? 'lobby' : isPlayView ? 'play' : ''
  const roomPollCode = roomPollView === 'lobby' ? lobbyRoomCode : playRoomCode
  const visibleRoomPollConnectionMessage =
    roomPollView &&
    roomPollConnectionStatus === ROOM_POLL_CONNECTION_STATUS.RECONNECTING
      ? 'Server unavailable. Reconnecting...'
      : ''

  useEffect(() => {
    if (!activeRoom?.roomCode) {
      return
    }

    console.debug('[multiplayer-room-settings]', 'settings displayed by panel', {
      roomCode: activeRoom.roomCode,
      isHost,
      view,
      settings: activeRoom.settings,
    })
  }, [activeRoom?.roomCode, activeRoom?.settings, isHost, view])

  useEffect(() => {
    if (
      autoEnteredRoomGameRef.current &&
      autoEnteredRoomGameRef.current !== activeRoomCode
    ) {
      autoEnteredRoomGameRef.current = ''
    }

    if (
      !isLobbyView ||
      !activeRoomCode ||
      !isCurrentUserRoomMember ||
      roomStatus === 'CLOSED' ||
      gameStatus !== 'RUNNING' ||
      autoEnteredRoomGameRef.current === activeRoomCode
    ) {
      return
    }

    autoEnteredRoomGameRef.current = activeRoomCode
    navigate(`/rooms/${activeRoomCode}/play`)
  }, [
    activeRoomCode,
    gameStatus,
    isCurrentUserRoomMember,
    isLobbyView,
    navigate,
    roomStatus,
  ])

  useEffect(() => {
    if (!roomPollView || !roomPollCode || !token || !isAuthenticated) {
      return
    }

    let isPolling = true
    let retryDelayMs = LOBBY_ROOM_POLL_INTERVAL_MS
    let timeoutId = null
    let abortController = null

    const scheduleNextPoll = (delayMs, isRetry = false) => {
      if (!isPolling) {
        return
      }

      if (isRetry) {
        console.debug('[multiplayer-lobby]', 'retry scheduled', {
          roomCode: roomPollCode,
          delayMs,
        })
      }

      timeoutId = window.setTimeout(() => {
        void pollRoom()
      }, delayMs)
    }

    const markRoomExplicitlyClosed = (source) => {
      console.debug('[multiplayer-lobby]', 'room explicitly closed', {
        roomCode: roomPollCode,
        source,
      })
      setActiveRoom((currentRoom) => (
        currentRoom?.roomCode === roomPollCode
          ? { ...currentRoom, status: 'CLOSED' }
          : currentRoom
      ))
      setGameState((currentGameState) => (
        currentGameState
          ? { ...currentGameState, roomStatus: 'CLOSED' }
          : currentGameState
      ))
      setRoomPollConnectionStatus(ROOM_POLL_CONNECTION_STATUS.CONNECTED)
      setRoomMessage('Room closed.')
      setRoomError('')
      onDisconnectPresence(`room-closed:${source}`)
      void refreshMyRooms()
    }

    const pollRoom = async () => {
      if (!isPolling) {
        return
      }

      abortController = new AbortController()
      console.debug('[multiplayer-lobby]', 'poll started', {
        roomCode: roomPollCode,
        view: roomPollView,
      })

      try {
        const room = await refreshRoomState(roomPollCode, {
          reason: `${roomPollView}-poll`,
          shouldSyncJoinCode: true,
          signal: abortController.signal,
        })

        if (!isPolling) {
          return
        }

        retryDelayMs = LOBBY_ROOM_POLL_INTERVAL_MS
        setRoomPollConnectionStatus((currentStatus) => (
          currentStatus === ROOM_POLL_CONNECTION_STATUS.CONNECTED
            ? currentStatus
            : ROOM_POLL_CONNECTION_STATUS.CONNECTED
        ))
        console.debug('[multiplayer-lobby]', 'poll succeeded', {
          roomCode: room?.roomCode || roomPollCode,
          memberCount: getMemberCount(room),
          view: roomPollView,
        })

        if (room?.status === 'CLOSED') {
          console.debug('[multiplayer-lobby]', 'room explicitly closed', {
            roomCode: room?.roomCode || roomPollCode,
            source: `${roomPollView}-poll`,
          })
          setGameState((currentGameState) => (
            currentGameState
              ? { ...currentGameState, roomStatus: 'CLOSED' }
              : currentGameState
          ))
          setRoomMessage('Room closed.')
          onDisconnectPresence(`room-closed:${roomPollView}-poll`)
          void refreshMyRooms()
          return
        }

        scheduleNextPoll(LOBBY_ROOM_POLL_INTERVAL_MS)
      } catch (error) {
        if (!isPolling || isAbortError(error)) {
          return
        }

        console.debug('[multiplayer-lobby]', 'poll failed', {
          roomCode: roomPollCode,
          view: roomPollView,
          status: error.status,
          errorCode: error.errorCode,
          message: error.message,
        })

        if (error.status === 401) {
          setRoomError('Session expired. Please sign in again.')
          onSessionExpired?.()
          return
        }

        if (isExplicitRoomClosedError(error)) {
          markRoomExplicitlyClosed(`${roomPollView}-poll`)
          return
        }

        if (isNetworkFetchError(error)) {
          setRoomPollConnectionStatus((currentStatus) => (
            currentStatus === ROOM_POLL_CONNECTION_STATUS.RECONNECTING
              ? currentStatus
              : ROOM_POLL_CONNECTION_STATUS.RECONNECTING
          ))
          setRoomError('')
          scheduleNextPoll(retryDelayMs, true)
          retryDelayMs = Math.min(
            retryDelayMs * 2,
            LOBBY_ROOM_POLL_MAX_RETRY_MS,
          )
          return
        }

        setRoomError(error.message || 'Could not load room.')
        scheduleNextPoll(LOBBY_ROOM_POLL_INTERVAL_MS)
      } finally {
        abortController = null
      }
    }

    void pollRoom()

    return () => {
      isPolling = false
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      abortController?.abort()
      console.debug('[multiplayer-lobby]', 'lobby polling stop', {
        roomCode: roomPollCode,
        view: roomPollView,
      })
    }
  }, [
    isAuthenticated,
    onSessionExpired,
    onDisconnectPresence,
    refreshRoomState,
    refreshMyRooms,
    roomPollCode,
    roomPollView,
    token,
  ])

  useEffect(() => {
    routeCleanupRef.current = {
      activeRoomCode: presenceDecisionRoomCode,
      currentPlayerId,
      onDisconnectPresence,
      view,
    }
  }, [currentPlayerId, onDisconnectPresence, presenceDecisionRoomCode, view])

  useEffect(() => {
    console.debug('[multiplayer-presence]', 'room status / game status used for connection decision', {
      roomId: presenceDecisionRoomCode,
      playerId: currentPlayerId,
      view,
      roomStatus,
      gameStatus,
      enabled: presenceEnabled,
      reason: presenceDecisionReason,
    })

    onConnectPresence(presenceDecisionRoomCode, {
      enabled: presenceEnabled,
      reason: presenceDecisionReason,
    })
  }, [
    currentPlayerId,
    gameStatus,
    onConnectPresence,
    presenceDecisionReason,
    presenceDecisionRoomCode,
    presenceEnabled,
    roomStatus,
    view,
  ])

  useEffect(() => {
    return () => {
      const {
        activeRoomCode: cleanupRoomCode,
        currentPlayerId: cleanupPlayerId,
        onDisconnectPresence: disconnectOnCleanup,
        view: cleanupView,
      } = routeCleanupRef.current

      if (cleanupView !== 'play') {
        return
      }

      console.debug('[multiplayer-presence]', 'route/page changed away from room', {
        roomId: cleanupRoomCode,
        playerId: cleanupPlayerId,
        fromView: cleanupView,
      })
      disconnectOnCleanup('route-away-from-room-play')
    }
  }, [])

  return (
    <section
      className={`multiplayer-panel multiplayer-panel-${view}`}
      aria-label="Multiplayer rooms"
    >
      <div className="multiplayer-panel-header">
        <p>Multiplayer</p>
        {shouldShowStatusBadge && (
          <span className={`multiplayer-status is-${statusBadgeClassName}`}>
            {statusBadgeLabel}
          </span>
        )}
      </div>

      {!isAuthenticated ? (
        <p className="multiplayer-muted">Sign in to use multiplayer rooms.</p>
      ) : activeRoom ? (
        <div className="multiplayer-active-room">
          <div className="multiplayer-room-summary">
            <div>
              <strong>{activeRoom.roomName}</strong>
              <span>{activeRoom.roomCode}</span>
            </div>
            <span className={`multiplayer-room-status ${getRoomStatusClass(activeRoom.status)}`}>
              {activeRoom.status || 'UNKNOWN'}
            </span>
          </div>

          <div className="multiplayer-room-meta">
            <span>
              Members <strong>{memberCount}</strong>
            </span>
            {isPlayView && (
              <span>
                Online <strong>{onlinePlayerCount}</strong>
              </span>
            )}
          </div>

          <RoomSettingsPanel
            key={[
              activeRoom.roomCode,
              activeRoom.settings?.maxSpeedMps,
              activeRoom.settings?.allowPlayerSpeedControl,
              activeRoom.settings?.allowManualCreatureSpawn,
            ].join(':')}
            settings={activeRoom.settings}
            isHost={isHost}
            isSaving={isSavingRoomSettings}
            disabled={isActionPending}
            errorMessage={roomSettingsError}
            onSave={handleSaveRoomSettings}
          />

          <div className="multiplayer-game-state" aria-label="Room game state">
            <div className="multiplayer-game-summary">
              <span>Game</span>
              <strong>{gameStatus}</strong>
              {gameStatus === 'RUNNING' && (
                <time>{formatRemainingTime(gameRemainingSeconds)}</time>
              )}
            </div>
            {gameState?.startedByDisplayName && (
              <p>Started by {gameState.startedByDisplayName}</p>
            )}
            {gameStatus === 'ENDED' && (
              <p>Shared room game ended.</p>
            )}
            <p className="multiplayer-count">
              Shared creatures: <strong>{sharedRoomCreatures.length}</strong>
            </p>
            {canStartRoomGame && !isPlayView && (
              <div className="multiplayer-game-controls">
                <label className="multiplayer-room-control">
                  <span>Duration</span>
                  <select
                    value={durationSeconds}
                    onChange={(event) => setDurationSeconds(Number(event.target.value))}
                    disabled={isActionPending}
                  >
                    {GAME_DURATION_OPTIONS.map((optionSeconds) => (
                      <option key={optionSeconds} value={optionSeconds}>
                        {optionSeconds}s
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleStartRoomGame}
                  disabled={isActionPending}
                >
                  Start Room Game
                </button>
              </div>
            )}
            {canEnterRoomGame && (
              <button
                type="button"
                className="primary-button"
                onClick={handleEnterRoomGame}
              >
                Enter Game
              </button>
            )}
            {canEndRoomGame && (
              <div className="multiplayer-running-controls">
                {canSpawnRoomCreatures && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleSpawnRoomCreatures}
                    disabled={isActionPending || isSpawningRoomCreatures}
                  >
                    {isSpawningRoomCreatures
                      ? 'Spawning'
                      : 'Manual Spawn Override'}
                  </button>
                )}
                {isHost && !isManualCreatureSpawnAllowed && (
                  <p className="multiplayer-count">Manual spawn disabled.</p>
                )}
                <button
                  type="button"
                  onClick={handleEndRoomGame}
                  disabled={isActionPending || isSpawningRoomCreatures}
                >
                  End Room Game
                </button>
              </div>
            )}
          </div>

          {shouldShowMemberList && (
            <ul className="multiplayer-member-list" aria-label="Room members">
              {(activeRoom.members || []).map((member) => (
                <li key={member.userId}>
                  <span>{member.displayName || member.username}</span>
                  {member.host && <strong>Host</strong>}
                </li>
              ))}
            </ul>
          )}

          {shouldShowRoomLinks && (
            <div className="multiplayer-route-links">
              <Link to={`/rooms/${activeRoom.roomCode}/lobby`}>Lobby</Link>
              {gameStatus === 'RUNNING' && (
                <Link to={`/rooms/${activeRoom.roomCode}/play`}>Play</Link>
              )}
            </div>
          )}

          {!isPlayView && (
            <div className="multiplayer-actions">
              <button
                type="button"
                onClick={handleLeaveRoom}
                disabled={isActionPending}
              >
                Leave Room
              </button>
              {canCloseRoom && (
                <button
                  type="button"
                  onClick={handleCloseRoom}
                  disabled={isActionPending}
                >
                  Close Room
                </button>
              )}
            </div>
          )}
        </div>
      ) : shouldShowRoomSetup ? (
        <>
          <div className="multiplayer-section">
            <p>Create Room</p>
            <label className="multiplayer-room-control">
              <span>Room name</span>
              <input
                type="text"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder={DEFAULT_ROOM_NAME}
                disabled={isActionPending}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={handleCreateRoom}
              disabled={isActionPending}
            >
              Create
            </button>
          </div>

          <div className="multiplayer-section">
            <p>Join Room</p>
            <div className="multiplayer-join-row">
              <label className="multiplayer-room-control">
                <span>Room code</span>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="A8F3KQ"
                  disabled={isActionPending}
                />
              </label>
              <button
                type="button"
                onClick={() => handleJoinRoom()}
                disabled={isActionPending || !joinCode.trim()}
              >
                Join
              </button>
            </div>
          </div>

          <div className="multiplayer-section">
            <div className="multiplayer-section-heading">
              <p>My Rooms</p>
              <button
                type="button"
                onClick={refreshMyRooms}
                disabled={isRoomsLoading || isActionPending}
              >
                {isRoomsLoading ? 'Loading' : 'Refresh'}
              </button>
            </div>
            {myRooms.length > 0 ? (
              <ul className="multiplayer-my-rooms">
                {myRooms.slice(0, 3).map((room) => (
                  <li key={room.roomCode}>
                    <button
                      type="button"
                      onClick={() => handleJoinRoom(room.roomCode)}
                      disabled={isActionPending || room.status === 'CLOSED'}
                    >
                      <span>{room.roomName}</span>
                      <strong>{room.roomCode}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="multiplayer-muted">No rooms yet.</p>
            )}
          </div>
        </>
      ) : (
        <p className="multiplayer-muted">
          {routeRoomCode
            ? `Loading room ${routeRoomCode}...`
            : 'Choose or join a room first.'}
        </p>
      )}

      {(roomMessage ||
        roomError ||
        visibleRoomPollConnectionMessage ||
        visibleConnectionMessage) && (
        <p className={
          roomError || visibleRoomPollConnectionMessage || visibleConnectionMessage
            ? 'multiplayer-error'
            : 'multiplayer-muted'
        }>
          {roomError ||
            visibleRoomPollConnectionMessage ||
            visibleConnectionMessage ||
            roomMessage}
        </p>
      )}
    </section>
  )
}

export default MultiplayerPanel
