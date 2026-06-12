package com.routecatch.api.game.dto;

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
		SubmitCatchRequest request
	) {
		return new SubmitCatchResponse(
			session.sessionId().toString(),
			session.status(),
			session.score(),
			session.caughtCount(),
			request.scoreValue(),
			request.creatureId(),
			request.creatureName(),
			request.rarity()
		);
	}
}
