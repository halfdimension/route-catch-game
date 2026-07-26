package com.routecatch.api.multiplayer.room.round;

import java.util.List;
import java.util.UUID;

public record RoundPlayerScoreSnapshot(
	UUID playerId,
	String displayName,
	int score,
	int creaturesCaught,
	List<CaughtCreatureRecord> caughtCreatures
) {

	public RoundPlayerScoreSnapshot {
		caughtCreatures = List.copyOf(caughtCreatures);
	}
}
