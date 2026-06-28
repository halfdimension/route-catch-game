package com.routecatch.api.multiplayer.room.creature;

import java.time.Instant;
import java.util.UUID;

public record CatchRoomCreatureResponse(
	UUID instanceId,
	String creatureId,
	String name,
	String rarity,
	int scoreValue,
	boolean caught,
	UUID caughtByUserId,
	String caughtByDisplayName,
	Instant caughtAt,
	double distanceMeters
) {

	public static CatchRoomCreatureResponse from(
		RoomCreatureInstance creature,
		double distanceMeters
	) {
		return new CatchRoomCreatureResponse(
			creature.getInstanceId(),
			creature.getCreatureId(),
			creature.getName(),
			creature.getRarity(),
			creature.getScoreValue(),
			creature.isCaught(),
			creature.getCaughtByUserId(),
			creature.getCaughtByDisplayName(),
			creature.getCaughtAt(),
			distanceMeters
		);
	}
}
