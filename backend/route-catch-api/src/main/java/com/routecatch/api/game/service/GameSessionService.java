package com.routecatch.api.game.service;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;

@Service
public class GameSessionService {

	private final ConcurrentHashMap<UUID, GameSession> sessions = new ConcurrentHashMap<>();

	public GameSession createSession(int durationSeconds) {
		Instant createdAt = Instant.now();
		GameSession session = new GameSession(
			UUID.randomUUID(),
			GameSessionStatus.CREATED,
			createdAt,
			null,
			null,
			durationSeconds,
			0,
			0
		);

		sessions.put(session.sessionId(), session);
		return session;
	}

	public GameSession getSession(UUID sessionId) {
		GameSession session = sessions.get(sessionId);

		if (session == null) {
			throw new GameSessionNotFoundException(sessionId);
		}

		return session;
	}

	public GameSession startSession(UUID sessionId) {
		return sessions.compute(sessionId, (id, session) -> {
			if (session == null) {
				throw new GameSessionNotFoundException(id);
			}

			if (session.status() == GameSessionStatus.RUNNING) {
				return session;
			}

			if (session.status() == GameSessionStatus.ENDED) {
				throw new InvalidGameSessionStateException(
					"Ended game sessions cannot be started"
				);
			}

			return new GameSession(
				session.sessionId(),
				GameSessionStatus.RUNNING,
				session.createdAt(),
				Instant.now(),
				null,
				session.durationSeconds(),
				session.score(),
				session.caughtCount()
			);
		});
	}

	public GameSession endSession(UUID sessionId) {
		return sessions.compute(sessionId, (id, session) -> {
			if (session == null) {
				throw new GameSessionNotFoundException(id);
			}

			if (session.status() == GameSessionStatus.ENDED) {
				return session;
			}

			return new GameSession(
				session.sessionId(),
				GameSessionStatus.ENDED,
				session.createdAt(),
				session.startedAt(),
				Instant.now(),
				session.durationSeconds(),
				session.score(),
				session.caughtCount()
			);
		});
	}
}
