package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.TaskScheduler;

import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;

class RoomRoundSchedulerTests {

	private static final Instant NOW = Instant.parse("2026-07-26T10:00:00Z");

	@Test
	void deadlineTaskFinalizesExpectedRoundAndLifecycleStopCancelsIt() {
		Fixture fixture = fixture();
		UUID roundId = UUID.randomUUID();
		Instant endsAt = NOW.plusSeconds(60);

		fixture.started("room01", 3L, roundId, endsAt);
		fixture.lifecycle(
			"ROOM01",
			3L,
			roundId,
			endsAt,
			RoomGameLifecycleEvent.Type.STOPPED
		);
		verify(fixture.tasks.getFirst().future()).cancel(false);
		fixture.tasks.getFirst().runnable().run();

		assertEquals(1, fixture.gateway.calls.size());
		FinalizationCall call = fixture.gateway.calls.getFirst();
		assertEquals("ROOM01", call.roomCode());
		assertEquals(roundId, call.roundId());
		assertEquals(3L, call.generation());
		assertEquals(RoundEndReason.TIME_EXPIRED, call.reason());
	}

	@Test
	void persistenceFailureRetriesSameRoundWithBackoffAndStopsAfterSuccess() {
		Fixture fixture = fixture();
		UUID roundId = UUID.randomUUID();
		fixture.gateway.persistenceFailuresRemaining = 1;
		fixture.started("room01", 3L, roundId, NOW.plusSeconds(60));

		fixture.tasks.get(0).runnable().run();

		assertEquals(2, fixture.tasks.size());
		assertEquals(
			NOW.plus(RoomRoundScheduler.RETRY_BASE_DELAY),
			fixture.tasks.get(1).scheduledAt()
		);
		fixture.tasks.get(1).runnable().run();

		assertEquals(2, fixture.gateway.calls.size());
		assertEquals(List.of(roundId, roundId), fixture.gateway.calls.stream()
			.map(FinalizationCall::roundId)
			.toList());
		assertEquals(List.of(3L, 3L), fixture.gateway.calls.stream()
			.map(FinalizationCall::generation)
			.toList());
		assertEquals(2, fixture.tasks.size());
	}

	@Test
	void preparationFailureUsesTheSameBoundedRetryChain() {
		Fixture fixture = fixture();
		fixture.gateway.persistenceFailuresRemaining = 1;
		fixture.gateway.retryableErrorCode = "ROUND_FINALIZATION_UNAVAILABLE";
		fixture.started("room01", 3L, UUID.randomUUID(), NOW.plusSeconds(60));

		fixture.tasks.getFirst().runnable().run();

		assertEquals(2, fixture.tasks.size());
		assertEquals(NOW.plusSeconds(1), fixture.tasks.getLast().scheduledAt());
		assertEquals(1, fixture.gateway.calls.size());
	}

	@Test
	void persistenceRetryExhaustionIsBounded() {
		Fixture fixture = fixture();
		fixture.gateway.persistenceFailuresRemaining = Integer.MAX_VALUE;
		fixture.started("room01", 3L, UUID.randomUUID(), NOW.plusSeconds(60));

		for (int index = 0; index < RoomRoundScheduler.MAX_FINALIZATION_ATTEMPTS; index += 1) {
			fixture.tasks.get(index).runnable().run();
		}

		assertEquals(
			RoomRoundScheduler.MAX_FINALIZATION_ATTEMPTS,
			fixture.gateway.calls.size()
		);
		assertEquals(
			RoomRoundScheduler.MAX_FINALIZATION_ATTEMPTS,
			fixture.tasks.size()
		);
		assertEquals(
			NOW.plusSeconds(1),
			fixture.tasks.get(1).scheduledAt()
		);
		assertEquals(
			NOW.plusSeconds(2),
			fixture.tasks.get(2).scheduledAt()
		);
	}

	@Test
	void finalizingLifecycleDoesNotCreateParallelRetryChain() {
		Fixture fixture = fixture();
		UUID roundId = UUID.randomUUID();
		Instant endsAt = NOW.plusSeconds(60);
		fixture.gateway.persistenceFailuresRemaining = 1;
		fixture.started("room01", 3L, roundId, endsAt);
		fixture.tasks.getFirst().runnable().run();

		fixture.lifecycle(
			"ROOM01",
			3L,
			roundId,
			endsAt,
			RoomGameLifecycleEvent.Type.FINALIZING
		);
		fixture.lifecycle(
			"ROOM01",
			3L,
			roundId,
			endsAt,
			RoomGameLifecycleEvent.Type.FINALIZING
		);

		assertEquals(2, fixture.tasks.size());
		assertEquals(1, fixture.gateway.calls.size());
	}

	@Test
	void shutdownCancelsAndNeutralizesOutstandingRetry() {
		Fixture fixture = fixture();
		UUID roundId = UUID.randomUUID();
		fixture.gateway.persistenceFailuresRemaining = 1;
		fixture.started("room01", 3L, roundId, NOW.plusSeconds(60));
		fixture.tasks.getFirst().runnable().run();
		ScheduledTask retry = fixture.tasks.getLast();

		fixture.scheduler.shutdown();
		verify(retry.future()).cancel(false);
		retry.runnable().run();

		assertEquals(2, fixture.gateway.calls.size());
		assertEquals(2, fixture.tasks.size());
		verify(fixture.tasks.getFirst().future(), never()).cancel(false);
	}

	@Test
	void staleRetryCannotReplaceOrCancelNewerRoundSchedule() {
		Fixture fixture = fixture();
		UUID oldRoundId = UUID.randomUUID();
		UUID newRoundId = UUID.randomUUID();
		fixture.gateway.persistenceFailuresRemaining = 1;
		fixture.started("room01", 3L, oldRoundId, NOW.plusSeconds(60));
		fixture.tasks.get(0).runnable().run();
		ScheduledTask staleRetry = fixture.tasks.get(1);

		fixture.gateway.currentRoundId = newRoundId;
		fixture.gateway.currentGeneration = 4L;
		fixture.started("ROOM01", 4L, newRoundId, NOW.plusSeconds(120));
		ScheduledTask newRoundTask = fixture.tasks.get(2);
		staleRetry.runnable().run();

		assertEquals(3, fixture.tasks.size());
		fixture.lifecycle(
			"ROOM01",
			4L,
			newRoundId,
			NOW.plusSeconds(120),
			RoomGameLifecycleEvent.Type.STOPPED
		);
		verify(newRoundTask.future()).cancel(false);
		verify(staleRetry.future()).cancel(false);
	}

	private Fixture fixture() {
		TaskScheduler scheduler = mock(TaskScheduler.class);
		List<ScheduledTask> tasks = new ArrayList<>();
		when(scheduler.schedule(
			any(Runnable.class),
			any(Instant.class)
		)).thenAnswer(invocation -> {
			@SuppressWarnings("unchecked")
			ScheduledFuture<Object> future = mock(ScheduledFuture.class);
			tasks.add(new ScheduledTask(
				invocation.getArgument(0),
				invocation.getArgument(1),
				future
			));
			return future;
		});
		RecordingGateway gateway = new RecordingGateway();
		RoomRoundScheduler roundScheduler = new RoomRoundScheduler(
			scheduler,
			gateway,
			Clock.fixed(NOW, ZoneOffset.UTC)
		);
		return new Fixture(roundScheduler, gateway, tasks);
	}

	private record Fixture(
		RoomRoundScheduler scheduler,
		RecordingGateway gateway,
		List<ScheduledTask> tasks
	) {

		private void started(
			String roomCode,
			long generation,
			UUID roundId,
			Instant endsAt
		) {
			gateway.currentRoundId = roundId;
			gateway.currentGeneration = generation;
			lifecycle(
				roomCode,
				generation,
				roundId,
				endsAt,
				RoomGameLifecycleEvent.Type.STARTED
			);
		}

		private void lifecycle(
			String roomCode,
			long generation,
			UUID roundId,
			Instant endsAt,
			RoomGameLifecycleEvent.Type type
		) {
			scheduler.onRoomLifecycle(new RoomGameLifecycleEvent(
				roomCode,
				generation,
				roundId,
				endsAt,
				type
			));
		}
	}

	private static final class RecordingGateway
		implements RoomRoundFinalizationGateway {

		private final List<FinalizationCall> calls = new ArrayList<>();
		private int persistenceFailuresRemaining;
		private String retryableErrorCode = "ROUND_PERSISTENCE_UNAVAILABLE";
		private UUID currentRoundId;
		private long currentGeneration;

		@Override
		public FinalizedRoomRound finalizeRound(
			String roomCode,
			UUID expectedRoundId,
			long expectedGeneration,
			RoundEndReason reason
		) {
			calls.add(new FinalizationCall(
				roomCode,
				expectedRoundId,
				expectedGeneration,
				reason
			));
			if (
				!expectedRoundId.equals(currentRoundId) ||
				expectedGeneration != currentGeneration
			) {
				throw new RoundLifecycleException(
					"STALE_ROUND_GENERATION",
					"stale",
					HttpStatus.CONFLICT
				);
			}
			if (persistenceFailuresRemaining > 0) {
				persistenceFailuresRemaining -= 1;
				throw new RoundLifecycleException(
					retryableErrorCode,
					"unavailable",
					HttpStatus.SERVICE_UNAVAILABLE
				);
			}
			return null;
		}
	}

	private record ScheduledTask(
		Runnable runnable,
		Instant scheduledAt,
		ScheduledFuture<?> future
	) {
	}

	private record FinalizationCall(
		String roomCode,
		UUID roundId,
		long generation,
		RoundEndReason reason
	) {
	}
}
