package com.routecatch.api.multiplayer.room.round;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record PersonalRoundResult(
	UUID roundId,
	String roomCode,
	UUID playerId,
	String displayName,
	int score,
	int rank,
	int playerCount,
	int creaturesCaught,
	Map<String, Integer> rarityCounts,
	List<CaughtCreatureResult> caughtCreatures,
	Instant startedAt,
	Instant endedAt,
	RoundEndReason endReason
) {

	public PersonalRoundResult {
		rarityCounts = Map.copyOf(rarityCounts);
		caughtCreatures = List.copyOf(caughtCreatures);
	}
}
