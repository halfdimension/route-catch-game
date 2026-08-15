package com.routecatch.api.game.service;

import java.util.Objects;

import com.routecatch.api.game.exception.GameSessionCatchConflictException;
import com.routecatch.api.game.exception.GameSessionForbiddenException;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.GameSessionEntity;

final class GameSessionCatchAccess {

	private GameSessionCatchAccess() {
	}

	static void requireOwner(
		GameSessionEntity session,
		GameSessionCatchCommand command
	) {
		if (
			!Objects.equals(
				session.getUserId(),
				command.authenticatedUserId()
			)
		) {
			throw new GameSessionForbiddenException();
		}
	}

	static void requireExactReplay(
		CaughtCreatureEntity caughtCreature,
		GameSessionCatchCommand command
	) {
		if (
			!caughtCreature.getSessionId().equals(command.sessionId()) ||
			!caughtCreature.getCreatureId().equals(command.creatureId())
		) {
			throw new GameSessionCatchConflictException();
		}
	}
}
