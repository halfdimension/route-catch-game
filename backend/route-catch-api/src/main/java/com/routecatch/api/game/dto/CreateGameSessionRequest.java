package com.routecatch.api.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public record CreateGameSessionRequest(
	@Min(value = 30, message = "must be at least 30")
	@Max(value = 600, message = "must be at most 600")
	int durationSeconds
) {
}
