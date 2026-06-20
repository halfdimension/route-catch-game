function MultiplayerPanel({
  isAuthenticated,
  roomId,
  connectionStatus,
  onlinePlayerCount,
  errorMessage,
  onRoomIdChange,
  onJoinRoom,
  onLeaveRoom,
}) {
  const isConnected = connectionStatus === 'connected'
  const isConnecting = connectionStatus === 'connecting'

  return (
    <section className="multiplayer-panel" aria-label="Multiplayer presence">
      <div className="multiplayer-panel-header">
        <p>Multiplayer</p>
        <span className={`multiplayer-status is-${connectionStatus}`}>
          {connectionStatus}
        </span>
      </div>

      {!isAuthenticated ? (
        <p className="multiplayer-muted">Sign in to use multiplayer</p>
      ) : (
        <>
          <label className="multiplayer-room-control">
            <span>Room</span>
            <input
              type="text"
              value={roomId}
              onChange={(event) => onRoomIdChange(event.target.value)}
              disabled={isConnected || isConnecting}
            />
          </label>

          <div className="multiplayer-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onJoinRoom}
              disabled={isConnected || isConnecting}
            >
              {isConnecting ? 'Joining...' : 'Join'}
            </button>
            <button
              type="button"
              onClick={onLeaveRoom}
              disabled={!isConnected && !isConnecting}
            >
              Leave
            </button>
          </div>

          <p className="multiplayer-count">
            Online: <strong>{onlinePlayerCount}</strong>
          </p>
        </>
      )}

      {errorMessage && (
        <p className="multiplayer-error">{errorMessage}</p>
      )}
    </section>
  )
}

export default MultiplayerPanel
