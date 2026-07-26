package com.routecatch.api.multiplayer.room.round;

import java.util.Map;
import java.util.UUID;

public record FinalizedRoomRound(
	long generation,
	PublicRoundResult publicResult,
	Map<UUID, PersonalRoundResult> personalResults
) {

	public FinalizedRoomRound {
		personalResults = Map.copyOf(personalResults);
	}
}
