package com.routecatch.api.multiplayer.room.movement.service;

import java.util.Optional;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.movement.dto.CancelRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementSnapshotResponse;
import com.routecatch.api.multiplayer.room.movement.dto.StartRoomMovementRequest;

public interface RoomMovementService {

	RoomMovementPlanResponse startMovement(
		String roomCode,
		UserEntity currentUser,
		StartRoomMovementRequest request
	);

	Optional<RoomMovementPlanResponse> cancelMovement(
		String roomCode,
		UserEntity currentUser,
		CancelRoomMovementRequest request
	);

	RoomMovementSnapshotResponse getSnapshot(
		String roomCode,
		UserEntity currentUser
	);
}
