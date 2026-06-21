import { useCallback, useEffect, useState } from 'react'
import {
  closeRoom,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  listMyRooms,
} from '../api/multiplayerRoomClient'

const DEFAULT_ROOM_NAME = 'Delhi Room'

function normalizeRoomCode(roomCode) {
  return roomCode.trim().toUpperCase()
}

function getRoomStatusClass(status) {
  return `is-${(status || 'unknown').toLowerCase().replaceAll('_', '-')}`
}

function MultiplayerPanel({
  isAuthenticated,
  currentUser,
  token,
  connectionStatus,
  onlinePlayerCount,
  errorMessage,
  onConnectPresence,
  onDisconnectPresence,
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
    if (!isAuthenticated) {
      const timerId = window.setTimeout(() => {
        setActiveRoom(null)
        setMyRooms([])
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
    if (!activeRoom?.roomCode || !token || !isAuthenticated) {
      return
    }

    let isMounted = true

    getRoom(activeRoom.roomCode, token)
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
    activeRoom?.roomCode,
    isAuthenticated,
    onDisconnectPresence,
    onSessionExpired,
    onlinePlayerCount,
    refreshMyRooms,
    token,
  ])

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
      setRoomMessage('Room closed.')
      onDisconnectPresence()
      await refreshMyRooms()
    } catch (error) {
      handleRoomError(error, 'Could not close room.')
    } finally {
      setIsActionPending(false)
    }
  }

  const isHost = Boolean(
    activeRoom?.hostUserId && activeRoom.hostUserId === currentUser?.userId,
  )
  const memberCount = activeRoom?.members?.length || 0

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
            {isHost && (
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
