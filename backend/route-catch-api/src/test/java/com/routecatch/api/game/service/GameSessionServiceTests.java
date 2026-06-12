package com.routecatch.api.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;

class GameSessionServiceTests {

	private final GameSessionService service = new GameSessionService();

	@Test
	void createSessionReturnsCreatedSession() {
		GameSession session = service.createSession(60);

		assertEquals(GameSessionStatus.CREATED, session.status());
		assertEquals(60, session.durationSeconds());
		assertEquals(0, session.score());
		assertEquals(0, session.caughtCount());
		assertNotNull(session.createdAt());
	}

	@Test
	void startSessionChangesStatusToRunning() {
		GameSession created = service.createSession(60);
		GameSession running = service.startSession(created.sessionId());

		assertEquals(GameSessionStatus.RUNNING, running.status());
		assertNotNull(running.startedAt());
		assertEquals(running, service.startSession(created.sessionId()));
	}

	@Test
	void endSessionChangesStatusToEnded() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());
		GameSession ended = service.endSession(created.sessionId());

		assertEquals(GameSessionStatus.ENDED, ended.status());
		assertNotNull(ended.endedAt());
		assertEquals(ended, service.endSession(created.sessionId()));
	}

	@Test
	void unknownSessionThrowsNotFound() {
		assertThrows(
			GameSessionNotFoundException.class,
			() -> service.getSession(UUID.randomUUID())
		);
	}

	@Test
	void endedSessionCannotBeStarted() {
		GameSession created = service.createSession(60);
		service.endSession(created.sessionId());

		assertThrows(
			InvalidGameSessionStateException.class,
			() -> service.startSession(created.sessionId())
		);
	}
}
