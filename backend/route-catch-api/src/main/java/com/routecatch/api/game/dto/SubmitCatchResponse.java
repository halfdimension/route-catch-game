package com.routecatch.api.game.dto;

import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.GameSessionEntity;

public record SubmitCatchResponse(
	String sessionId,
	String catchId,
	GameSessionStatus status,
	int score,
	int caughtCount,
	int acceptedCatchScore,
	String creatureId,
	String creatureName,
	String rarity
) {

	public static SubmitCatchResponse from(
		GameSessionEntity session,
		CaughtCreatureEntity caughtCreature
	) {
		return new SubmitCatchResponse(
			session.getSessionId().toString(),
			caughtCreature.getCatchId().toString(),
			session.getStatus(),
			session.getScore(),
			session.getCaughtCount(),
			caughtCreature.getScoreValue(),
			caughtCreature.getCreatureId(),
			caughtCreature.getCreatureName(),
			caughtCreature.getRarity()
		);
	}
}
