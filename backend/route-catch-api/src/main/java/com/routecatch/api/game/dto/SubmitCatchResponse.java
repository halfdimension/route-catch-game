package com.routecatch.api.game.dto;

import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;

public record SubmitCatchResponse(
	String sessionId,
	GameSessionStatus status,
	int score,
	int caughtCount,
	int acceptedCatchScore,
	String creatureId,
	String creatureName,
	String rarity
) {

	public static SubmitCatchResponse from(
		GameSession session,
		CreatureDefinition creature
	) {
		return new SubmitCatchResponse(
			session.sessionId().toString(),
			session.status(),
			session.score(),
			session.caughtCount(),
			creature.scoreValue(),
			creature.creatureId(),
			creature.creatureName(),
			creature.rarity()
		);
	}
}
