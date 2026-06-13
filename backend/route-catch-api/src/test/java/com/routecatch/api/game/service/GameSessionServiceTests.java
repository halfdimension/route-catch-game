package com.routecatch.api.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.CreatureNotFoundException;
import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;

import jakarta.persistence.EntityManager;

@SpringBootTest
@Transactional
class GameSessionServiceTests {

	@Autowired
	private GameSessionService service;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private EntityManager entityManager;

	@Test
	void createSessionPersistsCreatedSession() {
		GameSession session = service.createSession(60);
		flushAndClear();

		GameSessionEntity persisted = gameSessionRepository
			.findById(session.sessionId())
			.orElseThrow();

		assertEquals(GameSessionStatus.CREATED, persisted.getStatus());
		assertEquals(60, persisted.getDurationSeconds());
		assertEquals(0, persisted.getScore());
		assertEquals(0, persisted.getCaughtCount());
		assertNotNull(persisted.getCreatedAt());
	}

	@Test
	void getSessionReloadsPersistedSession() {
		GameSession created = service.createSession(60);
		flushAndClear();

		GameSession reloaded = service.getSession(created.sessionId());

		assertEquals(created.sessionId(), reloaded.sessionId());
		assertEquals(GameSessionStatus.CREATED, reloaded.status());
		assertEquals(60, reloaded.durationSeconds());
		assertEquals(0, reloaded.score());
		assertEquals(0, reloaded.caughtCount());
		assertNotNull(reloaded.createdAt());
	}

	@Test
	void startSessionPersistsRunningStatus() {
		GameSession created = service.createSession(60);
		GameSession running = service.startSession(created.sessionId());
		flushAndClear();

		GameSessionEntity persisted = gameSessionRepository
			.findById(created.sessionId())
			.orElseThrow();

		assertEquals(GameSessionStatus.RUNNING, persisted.getStatus());
		assertNotNull(persisted.getStartedAt());

		GameSession stillRunning = service.startSession(created.sessionId());
		assertEquals(running.sessionId(), stillRunning.sessionId());
		assertEquals(GameSessionStatus.RUNNING, stillRunning.status());
		assertEquals(persisted.getStartedAt(), stillRunning.startedAt());
	}

	@Test
	void endSessionPersistsEndedStatus() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());
		GameSession ended = service.endSession(created.sessionId());
		flushAndClear();

		GameSessionEntity persisted = gameSessionRepository
			.findById(created.sessionId())
			.orElseThrow();

		assertEquals(GameSessionStatus.ENDED, persisted.getStatus());
		assertNotNull(persisted.getEndedAt());

		GameSession stillEnded = service.endSession(created.sessionId());
		assertEquals(ended.sessionId(), stillEnded.sessionId());
		assertEquals(GameSessionStatus.ENDED, stillEnded.status());
		assertEquals(persisted.getEndedAt(), stillEnded.endedAt());
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

	@Test
	void submitCatchPersistsScoreCountAndCatchSnapshot() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());

		SubmitCatchResponse response = service.submitCatch(
			created.sessionId(),
			catchRequest("sparkbit")
		);
		flushAndClear();

		GameSessionEntity persistedSession = gameSessionRepository
			.findById(created.sessionId())
			.orElseThrow();
		CaughtCreatureEntity persistedCatch = caughtCreatureRepository
			.findBySessionIdOrderByCaughtAtDesc(created.sessionId())
			.getFirst();

		assertEquals(10, response.score());
		assertEquals(1, response.caughtCount());
		assertEquals(10, persistedSession.getScore());
		assertEquals(1, persistedSession.getCaughtCount());
		assertEquals("sparkbit", persistedCatch.getCreatureId());
		assertEquals("Sparkbit", persistedCatch.getCreatureName());
		assertEquals("common", persistedCatch.getRarity());
		assertEquals(10, persistedCatch.getScoreValue());
		assertNotNull(persistedCatch.getCaughtAt());
	}

	@Test
	void multipleCatchesAccumulatePersistedScore() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());

		service.submitCatch(created.sessionId(), catchRequest("sparkbit"));
		service.submitCatch(created.sessionId(), catchRequest("voltfox"));
		flushAndClear();

		GameSession persisted = service.getSession(created.sessionId());

		assertEquals(40, persisted.score());
		assertEquals(2, persisted.caughtCount());
		assertEquals(
			2,
			caughtCreatureRepository
				.findBySessionIdOrderByCaughtAtDesc(created.sessionId())
				.size()
		);
	}

	@Test
	void frontendSuppliedCatchValuesAreIgnored() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());

		SubmitCatchResponse response = service.submitCatch(
			created.sessionId(),
			new SubmitCatchRequest(
				"sparkbit",
				"Fake Creature",
				"legendary",
				9999
			)
		);

		assertEquals(10, response.score());
		assertEquals(10, response.acceptedCatchScore());
		assertEquals("Sparkbit", response.creatureName());
		assertEquals("common", response.rarity());
	}

	@Test
	void createdSessionCannotAcceptCatch() {
		GameSession created = service.createSession(60);

		assertThrows(
			InvalidGameSessionStateException.class,
			() -> service.submitCatch(
				created.sessionId(),
				catchRequest("sparkbit")
			)
		);
	}

	@Test
	void endedSessionCannotAcceptCatch() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());
		service.endSession(created.sessionId());

		assertThrows(
			InvalidGameSessionStateException.class,
			() -> service.submitCatch(
				created.sessionId(),
				catchRequest("sparkbit")
			)
		);

		assertTrue(
			caughtCreatureRepository
				.findBySessionIdOrderByCaughtAtDesc(created.sessionId())
				.isEmpty()
		);
	}

	@Test
	void unknownSessionCannotAcceptCatch() {
		assertThrows(
			GameSessionNotFoundException.class,
			() -> service.submitCatch(
				UUID.randomUUID(),
				catchRequest("sparkbit")
			)
		);
	}

	@Test
	void unknownCreatureCannotBeCaught() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());

		assertThrows(
			CreatureNotFoundException.class,
			() -> service.submitCatch(
				created.sessionId(),
				catchRequest("unknown-creature")
			)
		);
	}

	private SubmitCatchRequest catchRequest(String creatureId) {
		return new SubmitCatchRequest(
			creatureId,
			null,
			null,
			null
		);
	}

	private void flushAndClear() {
		entityManager.flush();
		entityManager.clear();
	}
}
