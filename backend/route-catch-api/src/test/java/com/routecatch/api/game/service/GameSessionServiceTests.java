package com.routecatch.api.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.CreatureNotFoundException;
import com.routecatch.api.game.exception.GameSessionNotFoundException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;

class GameSessionServiceTests {

	private final GameSessionService service = new GameSessionService(
		new CreatureCatalogService()
	);

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

	@Test
	void submitCatchToRunningSessionIncrementsScoreAndCaughtCount() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());

		SubmitCatchResponse response = service.submitCatch(
			created.sessionId(),
			catchRequest("sparkbit", null)
		);

		assertEquals(10, response.score());
		assertEquals(1, response.caughtCount());
		assertEquals(10, response.acceptedCatchScore());
		assertEquals("sparkbit", response.creatureId());
	}

	@Test
	void multipleCatchesAccumulateScore() {
		GameSession created = service.createSession(60);
		service.startSession(created.sessionId());

		service.submitCatch(created.sessionId(), catchRequest("sparkbit", null));
		SubmitCatchResponse response = service.submitCatch(
			created.sessionId(),
			catchRequest("voltfox", null)
		);

		assertEquals(40, response.score());
		assertEquals(2, response.caughtCount());
		assertEquals(40, service.getSession(created.sessionId()).score());
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
				catchRequest("sparkbit", null)
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
				catchRequest("sparkbit", null)
			)
		);
	}

	@Test
	void unknownSessionCannotAcceptCatch() {
		assertThrows(
			GameSessionNotFoundException.class,
			() -> service.submitCatch(
				UUID.randomUUID(),
				catchRequest("sparkbit", null)
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
				catchRequest("unknown-creature", null)
			)
		);
	}

	private SubmitCatchRequest catchRequest(
		String creatureId,
		Integer scoreValue
	) {
		return new SubmitCatchRequest(
			creatureId,
			creatureId,
			"common",
			scoreValue
		);
	}
}
