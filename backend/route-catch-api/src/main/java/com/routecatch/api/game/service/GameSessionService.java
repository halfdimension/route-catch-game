package com.routecatch.api.game.service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.game.dto.CaughtCreatureResponse;
import com.routecatch.api.game.dto.LeaderboardEntryResponse;
import com.routecatch.api.game.dto.PlayerStatsResponse;
import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.exception.InvalidPlayerNameException;
import com.routecatch.api.game.exception.InvalidSessionHistoryLimitException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.model.PlayerNames;
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
		return createSession(durationSeconds, "Guest");
	}

	@Transactional
	public GameSession createSession(int durationSeconds, String playerName) {
		GameSessionEntity session = new GameSessionEntity(
			UUID.randomUUID(),
			durationSeconds,
			PlayerNames.normalize(playerName)
		);

		return toModel(gameSessionRepository.save(session));
	}

	@Transactional
	public GameSession getSession(UUID sessionId) {
		return toModel(findSessionWithExpiry(sessionId, Instant.now()));
	}

	@Transactional
	public List<GameSession> listRecentSessions(int limit) {
		if (limit < 1 || limit > 100) {
			throw new InvalidSessionHistoryLimitException();
		}

		Instant currentTime = Instant.now();

		return gameSessionRepository
			.findAllByOrderByCreatedAtDesc(PageRequest.of(0, limit))
			.stream()
			.map((session) -> {
				if (session.getStatus() != GameSessionStatus.RUNNING) {
					return session;
				}

				GameSessionEntity lockedSession =
					findSessionForUpdate(session.getSessionId());
				lockedSession.expireIfStale(currentTime);
				return lockedSession;
			})
			.map(this::toModel)
			.toList();
	}

	@Transactional(readOnly = true)
	public List<CaughtCreatureResponse> listCatchesForSession(UUID sessionId) {
		findSession(sessionId);

		return caughtCreatureRepository
			.findBySessionIdOrderByCaughtAtAsc(sessionId)
			.stream()
			.map(CaughtCreatureResponse::from)
			.toList();
	}

	@Transactional
	public List<LeaderboardEntryResponse> getLeaderboard(int limit) {
		validateLimit(limit);
		expireStaleRunningSessions(Instant.now());
		gameSessionRepository.flush();

		List<GameSessionEntity> sessions = gameSessionRepository
			.findAllByStatusOrderByScoreDescCaughtCountDescEndedAtAscCreatedAtDesc(
				GameSessionStatus.ENDED,
				PageRequest.of(0, limit)
			);

		return java.util.stream.IntStream.range(0, sessions.size())
			.mapToObj((index) ->
				LeaderboardEntryResponse.from(index + 1, sessions.get(index))
			)
			.toList();
	}

	@Transactional
	public PlayerStatsResponse getPlayerStats(String playerName) {
		if (PlayerNames.isTooLong(playerName)) {
			throw new InvalidPlayerNameException();
		}

		String normalizedPlayerName = PlayerNames.normalize(playerName);
		expireStaleRunningSessions(Instant.now());
		gameSessionRepository.flush();

		List<GameSessionEntity> sessions =
			gameSessionRepository.findByPlayerName(normalizedPlayerName);
		List<GameSessionEntity> completedSessions = sessions.stream()
			.filter((session) -> session.getStatus() == GameSessionStatus.ENDED)
			.toList();

		int totalScore = completedSessions.stream()
			.mapToInt(GameSessionEntity::getScore)
			.sum();
		int totalCatches = completedSessions.stream()
			.mapToInt(GameSessionEntity::getCaughtCount)
			.sum();
		int bestScore = completedSessions.stream()
			.mapToInt(GameSessionEntity::getScore)
			.max()
			.orElse(0);
		int bestCaughtCount = completedSessions.stream()
			.mapToInt(GameSessionEntity::getCaughtCount)
			.max()
			.orElse(0);
		double averageScore = completedSessions.stream()
			.mapToInt(GameSessionEntity::getScore)
			.average()
			.orElse(0);
		Instant latestSessionAt = sessions.stream()
			.map(GameSessionEntity::getCreatedAt)
			.max(Comparator.naturalOrder())
			.orElse(null);

		return new PlayerStatsResponse(
			normalizedPlayerName,
			sessions.size(),
			completedSessions.size(),
			totalScore,
			totalCatches,
			bestScore,
			bestCaughtCount,
			averageScore,
			latestSessionAt
		);
	}

	@Transactional(noRollbackFor = InvalidGameSessionStateException.class)
	public GameSession startSession(UUID sessionId) {
		GameSessionEntity session = findSessionForUpdate(sessionId);
		session.expireIfStale(Instant.now());

		if (session.getStatus() == GameSessionStatus.RUNNING) {
			return toModel(session);
		}

		if (session.getStatus() == GameSessionStatus.ENDED) {
			throw new InvalidGameSessionStateException(
				"Ended game sessions cannot be started"
			);
		}

		session.start(Instant.now());
		return toModel(gameSessionRepository.save(session));
	}

	@Transactional
	public GameSession endSession(UUID sessionId) {
		GameSessionEntity session = findSessionForUpdate(sessionId);
		Instant currentTime = Instant.now();
		session.expireIfStale(currentTime);

		if (session.getStatus() == GameSessionStatus.ENDED) {
			return toModel(session);
		}

		session.end(currentTime);
		return toModel(gameSessionRepository.save(session));
	}

	@Transactional(noRollbackFor = InvalidGameSessionStateException.class)
	public SubmitCatchResponse submitCatch(
		UUID sessionId,
		SubmitCatchRequest request
	) {
		GameSessionEntity session = findSessionForUpdate(sessionId);
		session.expireIfStale(Instant.now());

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

	private GameSessionEntity findSessionWithExpiry(
		UUID sessionId,
		Instant currentTime
	) {
		GameSessionEntity session = findSession(sessionId);

		if (session.getStatus() != GameSessionStatus.RUNNING) {
			return session;
		}

		GameSessionEntity lockedSession = findSessionForUpdate(sessionId);
		lockedSession.expireIfStale(currentTime);
		return lockedSession;
	}

	private void expireStaleRunningSessions(Instant currentTime) {
		gameSessionRepository
			.findAllByStatus(GameSessionStatus.RUNNING)
			.forEach((session) -> {
				GameSessionEntity lockedSession =
					findSessionForUpdate(session.getSessionId());
				lockedSession.expireIfStale(currentTime);
			});
	}

	private void validateLimit(int limit) {
		if (limit < 1 || limit > 100) {
			throw new InvalidSessionHistoryLimitException();
		}
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
			entity.getCaughtCount(),
			entity.getPlayerName()
		);
	}

}
