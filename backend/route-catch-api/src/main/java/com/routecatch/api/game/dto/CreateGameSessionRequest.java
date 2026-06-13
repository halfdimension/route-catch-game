package com.routecatch.api.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record CreateGameSessionRequest(
	@Min(value = 30, message = "must be at least 30")
	@Max(value = 600, message = "must be at most 600")
	int durationSeconds,

	@Size(max = 80, message = "must be at most 80 characters")
	String playerName
) {

	public CreateGameSessionRequest {
		playerName = normalizePlayerName(playerName);
	}

	private static String normalizePlayerName(String playerName) {
		if (playerName == null || playerName.isBlank()) {
			return "Guest";
		}

		return playerName.trim();
	}
}
