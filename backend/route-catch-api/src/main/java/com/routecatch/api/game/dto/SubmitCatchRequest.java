package com.routecatch.api.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record SubmitCatchRequest(
	@NotBlank(message = "must not be blank")
	String creatureId,

	@NotBlank(message = "must not be blank")
	String creatureName,

	@NotBlank(message = "must not be blank")
	String rarity,

	@Min(value = 1, message = "must be at least 1")
	@Max(value = 10000, message = "must be at most 10000")
	int scoreValue
) {
}
