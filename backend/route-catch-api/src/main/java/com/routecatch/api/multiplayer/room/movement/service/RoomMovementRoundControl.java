package com.routecatch.api.multiplayer.room.movement.service;

import java.time.Instant;
import java.util.UUID;

public interface RoomMovementRoundControl {

	int freezeRound(
		String roomCode,
		UUID expectedRoundId,
		long expectedGeneration,
		Instant frozenAt
	);
}
