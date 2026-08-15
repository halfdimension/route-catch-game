package com.routecatch.api.game.service;

import java.time.Instant;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;

@Service
class GameSessionCatchWriter {

	private final CreatureCatalogService creatureCatalogService;
	private final GameSessionRepository gameSessionRepository;
	private final CaughtCreatureRepository caughtCreatureRepository;

	GameSessionCatchWriter(
		CreatureCatalogService creatureCatalogService,
		GameSessionRepository gameSessionRepository,
		CaughtCreatureRepository caughtCreatureRepository
	) {
		this.creatureCatalogService = creatureCatalogService;
		this.gameSessionRepository = gameSessionRepository;
		this.caughtCreatureRepository = caughtCreatureRepository;
	}

	@Transactional(noRollbackFor = InvalidGameSessionStateException.class)
	SubmitCatchResponse submit(GameSessionCatchCommand command) {
		GameSessionEntity session = gameSessionRepository
			.findByIdForUpdate(command.sessionId())
			.orElseThrow(() -> new GameSessionNotFoundException(command.sessionId()));
		GameSessionCatchAccess.requireOwner(session, command);

		CaughtCreatureEntity existing = caughtCreatureRepository
			.findById(command.catchId())
			.orElse(null);
		Instant currentTime = Instant.now();
		if (existing != null) {
			GameSessionCatchAccess.requireExactReplay(existing, command);
			session.expireIfStale(currentTime);
			return SubmitCatchResponse.from(session, existing);
		}

		session.expireIfStale(currentTime);
		if (session.getStatus() != GameSessionStatus.RUNNING) {
			throw new InvalidGameSessionStateException(
				"Catches can only be submitted to running game sessions"
			);
		}

		CreatureDefinition creature = creatureCatalogService
			.getCreatureById(command.creatureId());
		CaughtCreatureEntity caughtCreature = new CaughtCreatureEntity(
			command.catchId(),
			command.sessionId(),
			creature
		);

		caughtCreatureRepository.saveAndFlush(caughtCreature);
		session.recordCatch(creature.scoreValue());
		gameSessionRepository.saveAndFlush(session);

		return SubmitCatchResponse.from(session, caughtCreature);
	}
}
