package com.routecatch.api.multiplayer.room.round;

import java.time.Instant;
import java.util.UUID;

public record CaughtCreatureResult(
	UUID instanceId,
	String creatureId,
	String name,
	String rarity,
	int scoreAwarded,
	Instant caughtAt
) {

	public static CaughtCreatureResult from(CaughtCreatureRecord caught) {
		return new CaughtCreatureResult(
			caught.instanceId(),
			caught.creatureId(),
			caught.name(),
			caught.rarity(),
			caught.scoreAwarded(),
			caught.caughtAt()
		);
	}
}
