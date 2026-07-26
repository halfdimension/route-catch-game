import { useParams } from 'react-router-dom'
import MultiplayerPanel from '../components/MultiplayerPanel'

function RoomLobbyPage({ gameplay }) {
  const { roomCode } = useParams()

  return (
    <main className="page-shell rooms-page">
      <div className="page-header">
        <h1>Room Lobby</h1>
        <p>{roomCode}</p>
      </div>
      <MultiplayerPanel
        view="lobby"
        roomCode={roomCode}
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

export default RoomLobbyPage
