package com.routecatch.api.game.creature;

public record CreatureDefinition(
	String creatureId,
	String creatureName,
	String rarity,
	int scoreValue
) {
}
