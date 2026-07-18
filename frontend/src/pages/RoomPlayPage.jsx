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
  const {
    cancelRoomMovement,
    cleanupRoomMovement,
    prepareRoomMovement,
  } = gameplay
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
      cancelRoomMovement()
      cleanupRoomMovement()
    }
  }, [
    activeRoomGameStatus,
    activeRoomStatus,
    cancelRoomMovement,
    cleanupRoomMovement,
  ])

  useEffect(() => {
    const timerId = window.setTimeout(prepareRoomMovement, 0)

    return () => {
      window.clearTimeout(timerId)
      cleanupRoomMovement()
    }
  }, [cleanupRoomMovement, prepareRoomMovement, roomCode])

  function handleRoomMapClick(destination) {
    if (!canMoveInRoom) {
      return
    }

    gameplay.handleMapClick(destination)
  }

  function handleRoomSharedCreatureCatch(creature) {
    if (!canMoveInRoom) {
      cancelRoomMovement()
      cleanupRoomMovement()
      return
    }

    gameplay.handleSharedRoomCreatureCatch(creature)
  }

  function handleRoomConfirmPendingMove() {
    if (!canMoveInRoom) {
      cancelRoomMovement()
      cleanupRoomMovement()
      return
    }

    gameplay.handleRoomConfirmPendingMove()
  }

  return (
    <main className="game-shell">
      <GameMap
        playerPosition={gameplay.roomPlayerPosition}
        pendingDestination={gameplay.pendingDestination}
        routeCoordinates={gameplay.roomRouteCoordinates}
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
      {gameplay.movementErrorMessage && (
        <div className="route-status route-error">
          {gameplay.movementErrorMessage}
        </div>
      )}
      {gameplay.sharedRoomCatchMessage && (
        <div
          className={`shared-room-catch-status is-${gameplay.sharedRoomCatchMessage.type}`}
        >
          {gameplay.sharedRoomCatchMessage.text}
        </div>
      )}

      <MovementStatusPanel
        isMoving={gameplay.roomIsMoving}
        status={gameplay.roomMovementStatus}
        simulationSpeed={gameplay.roomMovementSpeed}
        onCancel={cancelRoomMovement}
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
          playerPosition={gameplay.roomPlayerPosition}
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
          isLoading={
            gameplay.movementCommandPending ||
            gameplay.movementSnapshotStatus === 'loading'
          }
        />
      )}
    </main>
  )
}

export default RoomPlayPage
