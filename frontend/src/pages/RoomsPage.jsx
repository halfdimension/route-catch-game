import MultiplayerPanel from '../components/MultiplayerPanel'

function RoomsPage({ gameplay }) {
  return (
    <main className="page-shell rooms-page">
      <div className="page-header">
        <h1>Rooms</h1>
        <p>Create, join, or return to a multiplayer room.</p>
      </div>
      <MultiplayerPanel
        view="rooms"
        isAuthenticated={gameplay.isAuthenticated}
        currentUser={gameplay.currentUser}
        token={gameplay.token}
        connectionStatus={gameplay.multiplayerConnectionStatus}
        onlinePlayerCount={gameplay.onlinePlayers.length}
        errorMessage={gameplay.multiplayerErrorMessage}
        playerPosition={gameplay.playerPosition}
        sharedRoomCreatures={gameplay.sharedRoomCreatures}
        onConnectPresence={gameplay.connectPresence}
        onDisconnectPresence={gameplay.disconnectPresence}
        onRoomContextChange={gameplay.handleMultiplayerRoomContextChange}
        onRefreshSharedRoomCreatures={gameplay.refreshSharedRoomCreatures}
        onSessionExpired={gameplay.logout}
      />
    </main>
  )
}

export default RoomsPage
