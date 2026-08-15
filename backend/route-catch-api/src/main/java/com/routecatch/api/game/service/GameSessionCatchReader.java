package com.routecatch.api.game.service;

import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;

@Service
class GameSessionCatchReader {

	private final GameSessionRepository gameSessionRepository;
	private final CaughtCreatureRepository caughtCreatureRepository;

	GameSessionCatchReader(
		GameSessionRepository gameSessionRepository,
		CaughtCreatureRepository caughtCreatureRepository
	) {
		this.gameSessionRepository = gameSessionRepository;
		this.caughtCreatureRepository = caughtCreatureRepository;
	}

	@Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
	Optional<SubmitCatchResponse> recoverAfterUniqueRace(
		GameSessionCatchCommand command
	) {
		GameSessionEntity session = gameSessionRepository
			.findById(command.sessionId())
			.orElseThrow(() -> new GameSessionNotFoundException(command.sessionId()));
		GameSessionCatchAccess.requireOwner(session, command);

		CaughtCreatureEntity existing = caughtCreatureRepository
			.findById(command.catchId())
			.orElse(null);
		if (existing == null) {
			return Optional.empty();
		}

		GameSessionCatchAccess.requireExactReplay(existing, command);
		return Optional.of(SubmitCatchResponse.from(session, existing));
	}
}
