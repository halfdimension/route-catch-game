package com.routecatch.api.multiplayer.room.round;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record PublicRoundResult(
	UUID roundId,
	String roomCode,
	Instant startedAt,
	Instant endedAt,
	RoundEndReason endReason,
	int playerCount,
	List<RoundLeaderboardEntry> leaderboard
) {

	public PublicRoundResult {
		leaderboard = List.copyOf(leaderboard);
	}
}
