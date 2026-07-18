package com.routecatch.api.multiplayer.room.movement.dto;

import java.time.Instant;
import java.util.List;

public record RoomMovementSnapshotResponse(
	String roomCode,
	long roomSequence,
	Instant serverTimestamp,
	List<RoomMovementPlanResponse> movements
) {
}
