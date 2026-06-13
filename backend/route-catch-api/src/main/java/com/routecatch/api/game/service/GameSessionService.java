package com.routecatch.api.game.service;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;

@Service
public class GameSessionService {

	private final CreatureCatalogService creatureCatalogService;
	private final GameSessionRepository gameSessionRepository;
	private final CaughtCreatureRepository caughtCreatureRepository;

	public GameSessionService(
		CreatureCatalogService creatureCatalogService,
		GameSessionRepository gameSessionRepository,
		CaughtCreatureRepository caughtCreatureRepository
	) {
		this.creatureCatalogService = creatureCatalogService;
		this.gameSessionRepository = gameSessionRepository;
		this.caughtCreatureRepository = caughtCreatureRepository;
	}

	@Transactional
	public GameSession createSession(int durationSeconds) {
		GameSessionEntity session = new GameSessionEntity(
			UUID.randomUUID(),
			durationSeconds
		);

		return toModel(gameSessionRepository.save(session));
	}

	@Transactional(readOnly = true)
	public GameSession getSession(UUID sessionId) {
		return toModel(findSession(sessionId));
	}

	@Transactional
	public GameSession startSession(UUID sessionId) {
		GameSessionEntity session = findSessionForUpdate(sessionId);

		if (session.getStatus() == GameSessionStatus.RUNNING) {
			return toModel(session);
		}

		if (session.getStatus() == GameSessionStatus.ENDED) {
			throw new InvalidGameSessionStateException(
				"Ended game sessions cannot be started"
			);
		}

		session.start();
		return toModel(gameSessionRepository.save(session));
	}

	@Transactional
	public GameSession endSession(UUID sessionId) {
		GameSessionEntity session = findSessionForUpdate(sessionId);

		if (session.getStatus() == GameSessionStatus.ENDED) {
			return toModel(session);
		}

		session.end();
		return toModel(gameSessionRepository.save(session));
	}

	@Transactional
	public SubmitCatchResponse submitCatch(
		UUID sessionId,
		SubmitCatchRequest request
	) {
		GameSessionEntity session = findSessionForUpdate(sessionId);

		if (session.getStatus() != GameSessionStatus.RUNNING) {
			throw new InvalidGameSessionStateException(
				"Catches can only be submitted to running game sessions"
			);
		}

		CreatureDefinition creature =
			creatureCatalogService.getCreatureById(request.creatureId());

		CaughtCreatureEntity caughtCreature = new CaughtCreatureEntity(
			sessionId,
			creature
		);
		session.recordCatch(creature.scoreValue());

		caughtCreatureRepository.save(caughtCreature);
		GameSession updatedSession = toModel(gameSessionRepository.save(session));

		return SubmitCatchResponse.from(updatedSession, creature);
	}

	private GameSessionEntity findSession(UUID sessionId) {
		return gameSessionRepository.findById(sessionId)
			.orElseThrow(() -> new GameSessionNotFoundException(sessionId));
	}

	private GameSessionEntity findSessionForUpdate(UUID sessionId) {
		return gameSessionRepository.findByIdForUpdate(sessionId)
			.orElseThrow(() -> new GameSessionNotFoundException(sessionId));
	}

	private GameSession toModel(GameSessionEntity entity) {
		return new GameSession(
			entity.getSessionId(),
			entity.getStatus(),
			entity.getCreatedAt(),
			entity.getStartedAt(),
			entity.getEndedAt(),
			entity.getDurationSeconds(),
			entity.getScore(),
			entity.getCaughtCount()
		);
	}
}
