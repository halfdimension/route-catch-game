package com.routecatch.api.game.dto;

import java.time.Instant;

import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;

public record GameSessionResponse(
	String sessionId,
	GameSessionStatus status,
	Instant createdAt,
	Instant startedAt,
	Instant endedAt,
	int durationSeconds,
	int score,
	int caughtCount,
	String playerName,
	String userId
) {

	public static GameSessionResponse from(GameSession session) {
		return new GameSessionResponse(
			session.sessionId().toString(),
			session.status(),
			session.createdAt(),
			session.startedAt(),
			session.endedAt(),
			session.durationSeconds(),
			session.score(),
			session.caughtCount(),
			session.playerName(),
			session.userId() == null ? null : session.userId().toString()
		);
	}
}
