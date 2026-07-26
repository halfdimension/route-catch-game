package com.routecatch.api.multiplayer.room.round;

import java.util.UUID;

public interface RoomRoundFinalizationGateway {

	FinalizedRoomRound finalizeRound(
		String roomCode,
		UUID expectedRoundId,
		long expectedGeneration,
		RoundEndReason reason
	);
}
