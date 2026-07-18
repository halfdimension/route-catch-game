import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import GameMap from '../components/GameMap'
import MoveConfirmPanel from '../components/MoveConfirmPanel'
import MovementStatusPanel from '../components/MovementStatusPanel'
import MultiplayerPanel from '../components/MultiplayerPanel'
import RoomSpeedControl from '../components/RoomSpeedControl'
import { DEFAULT_SIMULATION_SPEED } from '../config/gameConfig'

function RoomPlayPage({ gameplay }) {
  const { roomCode } = useParams()
  const { cleanupRoomMovement } = gameplay
  const activeRoomGameStatus = gameplay.activeRoomGameStatus || 'WAITING'
  const activeRoomStatus = gameplay.activeRoomStatus || 'OPEN'
  const roomSettings = gameplay.activeMultiplayerRoom?.settings || {}
  const roomMaxSpeedMps = roomSettings.maxSpeedMps || DEFAULT_SIMULATION_SPEED
  const allowPlayerSpeedControl =
    roomSettings.allowPlayerSpeedControl === true
  const canMoveInRoom =
    activeRoomStatus !== 'CLOSED' && activeRoomGameStatus === 'RUNNING'

  useEffect(() => {
    if (activeRoomGameStatus === 'ENDED' || activeRoomStatus === 'CLOSED') {
      cleanupRoomMovement()
    }
  }, [activeRoomGameStatus, activeRoomStatus, cleanupRoomMovement])

  useEffect(() => {
    return () => {
      cleanupRoomMovement()
    }
  }, [cleanupRoomMovement, roomCode])

  function handleRoomMapClick(destination) {
    if (!canMoveInRoom) {
      return
    }

    gameplay.handleMapClick(destination)
  }

  function handleRoomSharedCreatureCatch(creature) {
    if (!canMoveInRoom) {
      cleanupRoomMovement()
      return
    }

    gameplay.handleSharedRoomCreatureCatch(creature)
  }

  function handleRoomConfirmPendingMove() {
    if (!canMoveInRoom) {
      cleanupRoomMovement()
      return
    }

    void gameplay.handleConfirmPendingMove()
  }

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={gameplay.playerPosition}
        pendingDestination={gameplay.pendingDestination}
        routeCoordinates={gameplay.routeCoordinates}
        targets={[]}
        sharedRoomCreatures={gameplay.sharedRoomCreatures}
        caughtTarget={null}
        chasedTargetId={null}
        routingTargetId={null}
        chasedSharedRoomCreatureId={gameplay.chasedSharedRoomCreatureId}
        routingSharedRoomCreatureId={gameplay.routingSharedRoomCreatureId}
        playerName={gameplay.effectivePlayerName}
        otherPlayers={gameplay.otherOnlinePlayers}
        onMapClick={handleRoomMapClick}
        onTargetClick={gameplay.handleTargetClick}
        onSharedRoomCreatureCatch={handleRoomSharedCreatureCatch}
      />

      {gameplay.routeError && (
        <div className="route-status route-error">{gameplay.routeError}</div>
      )}
      {gameplay.sharedRoomCatchMessage && (
        <div
          className={`shared-room-catch-status is-${gameplay.sharedRoomCatchMessage.type}`}
        >
          {gameplay.sharedRoomCatchMessage.text}
        </div>
      )}

      <MovementStatusPanel
        isMoving={gameplay.isMoving}
        simulationSpeed={gameplay.simulationSpeed}
      />
      <div className="room-play-panel-stack">
        <RoomSpeedControl
          currentSpeedMps={gameplay.simulationSpeed}
          maxSpeedMps={roomMaxSpeedMps}
          allowPlayerSpeedControl={allowPlayerSpeedControl}
          onSpeedChange={gameplay.setSimulationSpeed}
        />
        <MultiplayerPanel
          view="play"
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
      </div>

      {gameplay.pendingDestination && canMoveInRoom && (
        <MoveConfirmPanel
          destination={gameplay.pendingDestination}
          onConfirm={handleRoomConfirmPendingMove}
          onCancel={gameplay.clearPendingDestination}
          isLoading={gameplay.isRouteLoading}
        />
      )}
    </main>
  )
}

export default RoomPlayPage
