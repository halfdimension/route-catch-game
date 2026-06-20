package com.routecatch.api.game.dto;

import java.time.Instant;

public record PlayerStatsResponse(
	String playerName,
	long totalSessions,
	long completedSessions,
	int totalScore,
	int totalCatches,
	int bestScore,
	int bestCaughtCount,
	double averageScore,
	Instant latestSessionAt
) {
}
