package com.routecatch.api.game.model;

import java.time.Instant;
import java.util.UUID;

public record GameSession(
	UUID sessionId,
	GameSessionStatus status,
	Instant createdAt,
	Instant startedAt,
	Instant endedAt,
	int durationSeconds,
	int score,
	int caughtCount
) {
}
