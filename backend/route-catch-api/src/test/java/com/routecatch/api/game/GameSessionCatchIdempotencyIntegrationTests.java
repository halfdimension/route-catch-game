package com.routecatch.api.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.exception.GameSessionCatchConflictException;
import com.routecatch.api.game.exception.InvalidGameSessionStateException;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureEntity;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.game.service.GameSessionService;

@SpringBootTest
class GameSessionCatchIdempotencyIntegrationTests {

	@Autowired
	private GameSessionService gameSessionService;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@BeforeEach
	void clearGameData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
	}

	@Test
	void suppliedCatchIdPersistsAndExactRetryReturnsOneLogicalResult() {
		GameSession session = runningGuestSession();
		UUID catchId = UUID.randomUUID();
		SubmitCatchRequest request = catchRequest(catchId, "sparkbit");

		SubmitCatchResponse first = gameSessionService.submitCatch(
			session.sessionId(),
			request
		);
		SubmitCatchResponse retry = gameSessionService.submitCatch(
			session.sessionId(),
			request
		);

		assertEquals(first, retry);
		assertEquals(catchId.toString(), first.catchId());
		assertSessionTotals(session.sessionId(), 10, 1);
		List<CaughtCreatureEntity> catches = caughtCreatureRepository
			.findBySessionIdOrderByCaughtAtAsc(session.sessionId());
		assertEquals(1, catches.size());
		assertEquals(catchId, catches.getFirst().getCatchId());
	}

	@Test
	void exactPersistedCatchRetrySucceedsAfterSessionEnds() {
		GameSession session = runningGuestSession();
		UUID catchId = UUID.randomUUID();
		SubmitCatchRequest request = catchRequest(catchId, "sparkbit");
		gameSessionService.submitCatch(session.sessionId(), request);
		gameSessionService.endSession(session.sessionId());

		SubmitCatchResponse retry = gameSessionService.submitCatch(
			session.sessionId(),
			request
		);

		assertEquals(GameSessionStatus.ENDED, retry.status());
		assertEquals(catchId.toString(), retry.catchId());
		assertSessionTotals(session.sessionId(), 10, 1);
		assertEquals(1, caughtCreatureRepository.count());
	}

	@Test
	void newCatchAgainstEndedSessionRemainsRejected() {
		GameSession session = runningGuestSession();
		gameSessionService.endSession(session.sessionId());

		assertThrows(
			InvalidGameSessionStateException.class,
			() -> gameSessionService.submitCatch(
				session.sessionId(),
				catchRequest(UUID.randomUUID(), "sparkbit")
			)
		);
		assertSessionTotals(session.sessionId(), 0, 0);
		assertEquals(0, caughtCreatureRepository.count());
	}

	@Test
	void reusedCatchIdRejectsDifferentCreatureOrSession() {
		GameSession firstSession = runningGuestSession();
		GameSession secondSession = runningGuestSession();
		UUID catchId = UUID.randomUUID();
		gameSessionService.submitCatch(
			firstSession.sessionId(),
			catchRequest(catchId, "sparkbit")
		);

		assertThrows(
			GameSessionCatchConflictException.class,
			() -> gameSessionService.submitCatch(
				firstSession.sessionId(),
				catchRequest(catchId, "voltfox")
			)
		);
		assertThrows(
			GameSessionCatchConflictException.class,
			() -> gameSessionService.submitCatch(
				secondSession.sessionId(),
				catchRequest(catchId, "sparkbit")
			)
		);

		assertSessionTotals(firstSession.sessionId(), 10, 1);
		assertSessionTotals(secondSession.sessionId(), 0, 0);
		assertEquals(1, caughtCreatureRepository.count());
	}

	@Test
	void concurrentIdenticalRequestsBothSucceedWithOneCatchAndScoreAward()
		throws Exception {
		GameSession session = runningGuestSession();
		UUID catchId = UUID.randomUUID();
		SubmitCatchRequest request = catchRequest(catchId, "sparkbit");

		List<SubmitCatchResponse> responses = runConcurrently(
			() -> gameSessionService.submitCatch(session.sessionId(), request),
			() -> gameSessionService.submitCatch(session.sessionId(), request)
		);

		assertEquals(2, responses.size());
		assertTrue(responses.stream().allMatch(
			response -> response.catchId().equals(catchId.toString())
		));
		assertTrue(responses.stream().allMatch(
			response -> response.score() == 10 && response.caughtCount() == 1
		));
		assertSessionTotals(session.sessionId(), 10, 1);
		assertEquals(1, caughtCreatureRepository.count());
	}

	@Test
	void concurrentCrossSessionCatchIdCollisionIsRecoveredAsConflict()
		throws Exception {
		GameSession firstSession = runningGuestSession();
		GameSession secondSession = runningGuestSession();
		UUID catchId = UUID.randomUUID();
		ExecutorService executor = Executors.newFixedThreadPool(2);
		CountDownLatch ready = new CountDownLatch(2);
		CountDownLatch start = new CountDownLatch(1);

		try {
			Future<SubmitCatchResponse> first = executor.submit(() -> {
				ready.countDown();
				start.await();
				return gameSessionService.submitCatch(
					firstSession.sessionId(),
					catchRequest(catchId, "sparkbit")
				);
			});
			Future<SubmitCatchResponse> second = executor.submit(() -> {
				ready.countDown();
				start.await();
				return gameSessionService.submitCatch(
					secondSession.sessionId(),
					catchRequest(catchId, "sparkbit")
				);
			});

			assertTrue(ready.await(5, TimeUnit.SECONDS));
			start.countDown();
			int successes = 0;
			int conflicts = 0;
			for (Future<SubmitCatchResponse> future : List.of(first, second)) {
				try {
					future.get(10, TimeUnit.SECONDS);
					successes += 1;
				} catch (ExecutionException exception) {
					assertInstanceOf(
						GameSessionCatchConflictException.class,
						exception.getCause()
					);
					conflicts += 1;
				}
			}

			assertEquals(1, successes);
			assertEquals(1, conflicts);
		} finally {
			start.countDown();
			executor.shutdownNow();
		}

		GameSessionEntity first = persistedSession(firstSession.sessionId());
		GameSessionEntity second = persistedSession(secondSession.sessionId());
		assertEquals(10, first.getScore() + second.getScore());
		assertEquals(1, first.getCaughtCount() + second.getCaughtCount());
		assertEquals(1, caughtCreatureRepository.count());
	}

	@Test
	void omittedCatchIdPreservesIndependentLegacyCatchSemantics() {
		GameSession session = runningGuestSession();

		SubmitCatchResponse first = gameSessionService.submitCatch(
			session.sessionId(),
			new SubmitCatchRequest("sparkbit", null, null, null)
		);
		SubmitCatchResponse second = gameSessionService.submitCatch(
			session.sessionId(),
			new SubmitCatchRequest("sparkbit", null, null, null)
		);

		assertTrue(!first.catchId().equals(second.catchId()));
		assertSessionTotals(session.sessionId(), 20, 2);
		assertEquals(2, caughtCreatureRepository.count());
	}

	private GameSession runningGuestSession() {
		GameSession session = gameSessionService.createSession(60);
		gameSessionService.startSession(session.sessionId());
		return session;
	}

	private SubmitCatchRequest catchRequest(UUID catchId, String creatureId) {
		return new SubmitCatchRequest(
			creatureId,
			null,
			null,
			null,
			catchId
		);
	}

	private GameSessionEntity persistedSession(UUID sessionId) {
		return gameSessionRepository.findById(sessionId).orElseThrow();
	}

	private void assertSessionTotals(UUID sessionId, int score, int count) {
		GameSessionEntity session = persistedSession(sessionId);
		assertEquals(score, session.getScore());
		assertEquals(count, session.getCaughtCount());
	}

	private List<SubmitCatchResponse> runConcurrently(
		java.util.concurrent.Callable<SubmitCatchResponse> firstOperation,
		java.util.concurrent.Callable<SubmitCatchResponse> secondOperation
	) throws Exception {
		ExecutorService executor = Executors.newFixedThreadPool(2);
		CountDownLatch ready = new CountDownLatch(2);
		CountDownLatch start = new CountDownLatch(1);
		try {
			Future<SubmitCatchResponse> first = executor.submit(() -> {
				ready.countDown();
				start.await();
				return firstOperation.call();
			});
			Future<SubmitCatchResponse> second = executor.submit(() -> {
				ready.countDown();
				start.await();
				return secondOperation.call();
			});
			assertTrue(ready.await(5, TimeUnit.SECONDS));
			start.countDown();
			return List.of(
				first.get(10, TimeUnit.SECONDS),
				second.get(10, TimeUnit.SECONDS)
			);
		} finally {
			start.countDown();
			executor.shutdownNow();
		}
	}
}
