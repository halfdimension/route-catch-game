package com.routecatch.api.multiplayer.room.round;

import java.time.Instant;
import java.util.UUID;

public record CaughtCreatureRecord(
	UUID instanceId,
	String creatureId,
	String name,
	String rarity,
	int scoreAwarded,
	Instant caughtAt,
	UUID catcherPlayerId,
	UUID roundId
) {
}
