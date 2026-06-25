package com.routecatch.api.multiplayer.room.creature;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

public record RoomCreatureResponse(
	UUID instanceId,
	String creatureId,
	String name,
	String rarity,
	int scoreValue,
	double latitude,
	double longitude,
	Instant spawnedAt,
	Instant expiresAt,
	long remainingSeconds,
	boolean caught,
	String caughtByDisplayName,
	Instant caughtAt
) {

	public static RoomCreatureResponse from(
		RoomCreatureInstance creature,
		Instant now
	) {
		return new RoomCreatureResponse(
			creature.getInstanceId(),
			creature.getCreatureId(),
			creature.getName(),
			creature.getRarity(),
			creature.getScoreValue(),
			creature.getLatitude(),
			creature.getLongitude(),
			creature.getSpawnedAt(),
			creature.getExpiresAt(),
			remainingSeconds(creature, now),
			creature.isCaught(),
			creature.getCaughtByDisplayName(),
			creature.getCaughtAt()
		);
	}

	private static long remainingSeconds(
		RoomCreatureInstance creature,
		Instant now
	) {
		if (!creature.getExpiresAt().isAfter(now)) {
			return 0;
		}

		return Duration.between(now, creature.getExpiresAt()).toSeconds();
	}
}
