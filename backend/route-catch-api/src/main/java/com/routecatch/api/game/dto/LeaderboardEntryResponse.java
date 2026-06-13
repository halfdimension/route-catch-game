package com.routecatch.api.game.dto;

import java.time.Instant;

import com.routecatch.api.game.persistence.GameSessionEntity;

public record LeaderboardEntryResponse(
	int rank,
	String sessionId,
	int score,
	int caughtCount,
	int durationSeconds,
	Instant startedAt,
	Instant endedAt,
	String playerName
) {

	public static LeaderboardEntryResponse from(
		int rank,
		GameSessionEntity session
	) {
		return new LeaderboardEntryResponse(
			rank,
			session.getSessionId().toString(),
			session.getScore(),
			session.getCaughtCount(),
			session.getDurationSeconds(),
			session.getStartedAt(),
			session.getEndedAt(),
			session.getPlayerName()
		);
	}
}
