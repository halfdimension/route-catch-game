package com.routecatch.api.multiplayer.room.round;

import java.util.UUID;

public record RoundLeaderboardEntry(
	UUID playerId,
	String displayName,
	int score,
	int rank,
	int creaturesCaught
) {
}
