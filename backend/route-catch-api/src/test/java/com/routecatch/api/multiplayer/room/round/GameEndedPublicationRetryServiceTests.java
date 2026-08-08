package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;

import com.routecatch.api.multiplayer.room.event.InMemoryRoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;

class GameEndedPublicationRetryServiceTests {

	private static final Instant NOW = Instant.parse("2026-08-07T10:00:00Z");

	@Test
	void immediateSuccessPublishesOnceWithoutSchedulingRetry() {
		Fixture fixture = fixture(0);
		FinalizedRoomRound result = result("ROOM01", UUID.randomUUID(), 1L);

		fixture.service.publish(result);
		fixture.service.publish(result);

		assertEquals(1, fixture.publisher.attempts.size());
		assertEquals(1, fixture.publisher.successes.size());
		assertTrue(fixture.tasks.isEmpty());
		assertEquals(0, fixture.service.pendingPublicationCount());
		assertTrue(fixture.service.isPublished(
			result.publicResult().roomCode(),
			result.publicResult().roundId()
		));
	}

	@Test
	void firstTwoFailuresRetryAfterOneAndTwoSecondsThenSucceed() {
		Fixture fixture = fixture(2);
		FinalizedRoomRound result = result("ROOM01", UUID.randomUUID(), 1L);

		fixture.service.publish(result);
		assertEquals(NOW.plusSeconds(1), fixture.tasks.get(0).scheduledAt());
		fixture.tasks.get(0).runnable().run();
		assertEquals(NOW.plusSeconds(2), fixture.tasks.get(1).scheduledAt());
		fixture.tasks.get(1).runnable().run();

		assertEquals(3, fixture.publisher.attempts.size());
		assertEquals(1, fixture.publisher.successes.size());
		assertEquals(2, fixture.tasks.size());
		assertEquals(0, fixture.service.pendingPublicationCount());
		assertSame(
			fixture.publisher.attempts.get(0),
			fixture.publisher.attempts.get(1)
		);
		assertSame(
			fixture.publisher.attempts.get(1),
			fixture.publisher.attempts.get(2)
		);
	}

	@Test
	void publicationFailuresStopAfterThreeAttemptsWithoutMarkingSuccess() {
		Fixture fixture = fixture(Integer.MAX_VALUE);
		FinalizedRoomRound result = result("ROOM01", UUID.randomUUID(), 1L);

		fixture.service.publish(result);
		fixture.tasks.get(0).runnable().run();
		fixture.tasks.get(1).runnable().run();

		assertEquals(
			GameEndedPublicationRetryService.MAX_PUBLICATION_ATTEMPTS,
			fixture.publisher.attempts.size()
		);
		assertTrue(fixture.publisher.successes.isEmpty());
		assertEquals(2, fixture.tasks.size());
		assertEquals(0, fixture.service.pendingPublicationCount());
		assertFalse(fixture.service.isPublished(
			result.publicResult().roomCode(),
			result.publicResult().roundId()
		));
	}

	@Test
	void delayedRetryIsNoOpAfterDuplicatePathPublishesSuccessfully() {
		Fixture fixture = fixture(1);
		FinalizedRoomRound result = result("ROOM01", UUID.randomUUID(), 1L);

		fixture.service.publish(result);
		ScheduledTask delayedRetry = fixture.tasks.getFirst();
		fixture.service.publish(result);
		delayedRetry.runnable().run();

		assertEquals(2, fixture.publisher.attempts.size());
		assertEquals(1, fixture.publisher.successes.size());
		assertEquals(0, fixture.service.pendingPublicationCount());
		verify(delayedRetry.future()).cancel(false);
	}

	@Test
	void oldRoundRetryRetainsOldIdentityAfterNewGenerationPublishes() {
		Fixture fixture = fixture(1);
		FinalizedRoomRound oldResult = result("ROOM01", UUID.randomUUID(), 1L);
		FinalizedRoomRound newResult = result("ROOM01", UUID.randomUUID(), 2L);

		fixture.service.publish(oldResult);
		ScheduledTask oldRetry = fixture.tasks.getFirst();
		fixture.service.publish(newResult);
		oldRetry.runnable().run();

		assertEquals(2, fixture.publisher.successes.size());
		assertEquals(
			newResult.publicResult().roundId(),
			fixture.publisher.successes.get(0).payload().roundId()
		);
		assertEquals(
			oldResult.publicResult().roundId(),
			fixture.publisher.successes.get(1).payload().roundId()
		);
		assertEquals("ROOM01", fixture.publisher.successes.get(1).roomCode());
	}

	@Test
	void shutdownCancelsRetryAndLateCallbackDoesNothing() {
		Fixture fixture = fixture(1);
		FinalizedRoomRound result = result("ROOM01", UUID.randomUUID(), 1L);

		fixture.service.publish(result);
		ScheduledTask retry = fixture.tasks.getFirst();
		fixture.service.shutdown();
		retry.runnable().run();

		assertEquals(1, fixture.publisher.attempts.size());
		assertEquals(0, fixture.service.pendingPublicationCount());
		verify(retry.future()).cancel(false);
	}

	private Fixture fixture(int failures) {
		TaskScheduler taskScheduler = mock(TaskScheduler.class);
		List<ScheduledTask> tasks = new ArrayList<>();
		when(taskScheduler.schedule(any(Runnable.class), any(Instant.class)))
			.thenAnswer(invocation -> {
				@SuppressWarnings("unchecked")
				ScheduledFuture<Object> future = mock(ScheduledFuture.class);
				tasks.add(new ScheduledTask(
					invocation.getArgument(0),
					invocation.getArgument(1),
					future
				));
				return future;
			});
		FailingPublisher publisher = new FailingPublisher(failures);
		GameEndedPublicationRetryService service =
			new GameEndedPublicationRetryService(
				taskScheduler,
				new InMemoryRoomEventSequencer(),
				publisher,
				Clock.fixed(NOW, ZoneOffset.UTC)
			);
		return new Fixture(service, publisher, tasks);
	}

	private FinalizedRoomRound result(
		String roomCode,
		UUID roundId,
		long generation
	) {
		UUID playerId = UUID.randomUUID();
		Instant startedAt = NOW.minusSeconds(60);
		RoundLeaderboardEntry leaderboardEntry = new RoundLeaderboardEntry(
			playerId,
			"Player",
			0,
			1,
			0
		);
		PublicRoundResult publicResult = new PublicRoundResult(
			roundId,
			roomCode,
			startedAt,
			NOW,
			RoundEndReason.TIME_EXPIRED,
			1,
			List.of(leaderboardEntry)
		);
		PersonalRoundResult personalResult = new PersonalRoundResult(
			roundId,
			roomCode,
			playerId,
			"Player",
			0,
			1,
			1,
			0,
			Map.of(),
			List.of(),
			startedAt,
			NOW,
			RoundEndReason.TIME_EXPIRED
		);
		return new FinalizedRoomRound(
			generation,
			publicResult,
			Map.of(playerId, personalResult)
		);
	}

	private static final class FailingPublisher
		implements RoomRoundEventPublisher {

		private int failuresRemaining;
		private final List<RoomEventEnvelope<PublicRoundResult>> attempts =
			new ArrayList<>();
		private final List<RoomEventEnvelope<PublicRoundResult>> successes =
			new ArrayList<>();

		private FailingPublisher(int failuresRemaining) {
			this.failuresRemaining = failuresRemaining;
		}

		@Override
		public void publish(RoomEventEnvelope<PublicRoundResult> event) {
			attempts.add(event);
			if (failuresRemaining > 0) {
				failuresRemaining -= 1;
				throw new RuntimeException("transport unavailable");
			}
			successes.add(event);
		}
	}

	private record Fixture(
		GameEndedPublicationRetryService service,
		FailingPublisher publisher,
		List<ScheduledTask> tasks
	) {
	}

	private record ScheduledTask(
		Runnable runnable,
		Instant scheduledAt,
		ScheduledFuture<?> future
	) {
	}
}
