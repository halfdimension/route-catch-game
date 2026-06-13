package com.routecatch.api.game.dto;

import java.time.Instant;

import com.routecatch.api.game.persistence.CaughtCreatureEntity;

public record CaughtCreatureResponse(
	String catchId,
	String sessionId,
	String creatureId,
	String creatureName,
	String rarity,
	int scoreValue,
	Instant caughtAt
) {

	public static CaughtCreatureResponse from(CaughtCreatureEntity caughtCreature) {
		return new CaughtCreatureResponse(
			caughtCreature.getCatchId().toString(),
			caughtCreature.getSessionId().toString(),
			caughtCreature.getCreatureId(),
			caughtCreature.getCreatureName(),
			caughtCreature.getRarity(),
			caughtCreature.getScoreValue(),
			caughtCreature.getCaughtAt()
		);
	}
}
