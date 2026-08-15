package com.routecatch.api.game.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;

public record SubmitCatchRequest(
	@NotBlank(message = "must not be blank")
	String creatureId,

	String creatureName,

	String rarity,

	Integer scoreValue,

	UUID catchId
) {

	public SubmitCatchRequest(
		String creatureId,
		String creatureName,
		String rarity,
		Integer scoreValue
	) {
		this(creatureId, creatureName, rarity, scoreValue, null);
	}
}
