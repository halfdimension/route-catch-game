package com.routecatch.api.game.dto;

import jakarta.validation.constraints.NotBlank;

public record SubmitCatchRequest(
	@NotBlank(message = "must not be blank")
	String creatureId,

	String creatureName,

	String rarity,

	Integer scoreValue
) {
}
