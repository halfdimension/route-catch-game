import { useCallback, useEffect, useState } from 'react'
import {
  closeRoom,
  createRoom,
  endRoomGame,
  getRoomGame,
  getRoom,
  joinRoom,
  leaveRoom,
  listMyRooms,
  spawnRoomCreatures,
  startRoomGame,
} from '../api/multiplayerRoomClient'

const DEFAULT_ROOM_NAME = 'Delhi Room'
const DEFAULT_GAME_DURATION_SECONDS = 60
const GAME_DURATION_OPTIONS = [30, 60, 90, 120]
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

function MultiplayerPanel({
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
  const activeRoomCode = activeRoom?.roomCode

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

  useEffect(() => {
    onRoomContextChange?.({ activeRoom, gameState })
  }, [activeRoom, gameState, onRoomContextChange])

  useEffect(() => {
    if (!isAuthenticated) {
      const timerId = window.setTimeout(() => {
        setActiveRoom(null)
        setMyRooms([])
        setGameState(null)
        setGameRemainingSeconds(null)
        setRoomMessage('')
        setRoomError('')
        onDisconnectPresence()
      }, 0)

      return () => window.clearTimeout(timerId)
    }

    const timerId = window.setTimeout(() => {
      void refreshMyRooms()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [isAuthenticated, onDisconnectPresence, refreshMyRooms])

  useEffect(() => {
    if (!activeRoomCode || !token || !isAuthenticated) {
      return
    }

    let isMounted = true

    getRoom(activeRoomCode, token)
      .then((room) => {
        if (!isMounted) {
          return
        }

        if (room?.status === 'CLOSED') {
          setActiveRoom(null)
          setRoomMessage('Room closed.')
          onDisconnectPresence()
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
    isAuthenticated,
    onDisconnectPresence,
    onSessionExpired,
    onlinePlayerCount,
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
  }, [activeRoomCode, isAuthenticated, onSessionExpired, token])

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

  function handleRoomError(error, fallbackMessage) {
    if (error.status === 401) {
      setRoomError('Session expired. Please sign in again.')
      onSessionExpired?.()
      return
    }

    setRoomError(error.message || fallbackMessage)
  }

  async function activateRoom(room, message) {
    setActiveRoom(room)
    setGameState(null)
    setGameRemainingSeconds(null)
    setJoinCode(room.roomCode)
    setRoomMessage(message)
    setRoomError('')
    onConnectPresence(room.roomCode)
    await refreshMyRooms()
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
      await activateRoom(room, 'Joined room.')
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
      onDisconnectPresence()
      await refreshMyRooms()
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
      onDisconnectPresence()
      await refreshMyRooms()
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
      setGameState(nextGameState)
      setGameRemainingSeconds(nextGameState?.remainingSeconds ?? null)
      setRoomMessage('Room game started.')
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
    } catch (error) {
      handleRoomError(error, 'Could not end room game.')
    } finally {
      setIsActionPending(false)
    }
  }

  async function handleSpawnRoomCreatures() {
    if (!activeRoom?.roomCode) {
      return
    }

    if (!isHost) {
      setRoomError('Only host can spawn creatures')
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

  const isHost = Boolean(
    activeRoom?.hostUserId && activeRoom.hostUserId === currentUser?.userId,
  )
  const memberCount = activeRoom?.members?.length || 0
  const gameStatus = gameState?.gameStatus || 'WAITING'
  const roomStatus = gameState?.roomStatus || activeRoom?.status
  const canStartRoomGame = Boolean(
    isHost && roomStatus === 'OPEN' && gameStatus === 'WAITING',
  )
  const canEndRoomGame = Boolean(isHost && gameStatus === 'RUNNING')
  const canCloseRoom = Boolean(isHost && gameStatus !== 'RUNNING')
  const canSpawnRoomCreatures = Boolean(isHost && gameStatus === 'RUNNING')

  return (
    <section className="multiplayer-panel" aria-label="Multiplayer rooms">
      <div className="multiplayer-panel-header">
        <p>Multiplayer</p>
        <span className={`multiplayer-status is-${connectionStatus}`}>
          {connectionStatus}
        </span>
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
            <span>
              Online <strong>{onlinePlayerCount}</strong>
            </span>
          </div>

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
            {canStartRoomGame && (
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
                      : 'Spawn Room Creatures'}
                  </button>
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

          <ul className="multiplayer-member-list" aria-label="Room members">
            {(activeRoom.members || []).map((member) => (
              <li key={member.userId}>
                <span>{member.displayName || member.username}</span>
                {member.host && <strong>Host</strong>}
              </li>
            ))}
          </ul>

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
        </div>
      ) : (
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
      )}

      {(roomMessage || roomError || errorMessage) && (
        <p className={roomError || errorMessage ? 'multiplayer-error' : 'multiplayer-muted'}>
          {roomError || errorMessage || roomMessage}
        </p>
      )}
    </section>
  )
}

export default MultiplayerPanel
