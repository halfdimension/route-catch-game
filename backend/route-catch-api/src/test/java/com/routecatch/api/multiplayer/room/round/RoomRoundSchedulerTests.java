package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;

import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;

class RoomRoundSchedulerTests {

	@Test
	void deadlineTaskFinalizesExpectedRoundAndLifecycleStopCancelsIt() {
		TaskScheduler scheduler = mock(TaskScheduler.class);
		@SuppressWarnings("unchecked")
		ScheduledFuture<Object> future = mock(ScheduledFuture.class);
		AtomicReference<Runnable> task = new AtomicReference<>();
		when(scheduler.schedule(
			any(Runnable.class),
			any(Instant.class)
		)).thenAnswer(invocation -> {
			task.set(invocation.getArgument(0));
			return future;
		});
		RecordingGateway gateway = new RecordingGateway();
		RoomRoundScheduler roundScheduler = new RoomRoundScheduler(
			scheduler,
			gateway
		);
		UUID roundId = UUID.randomUUID();
		Instant endsAt = Instant.parse("2026-07-26T10:01:00Z");

		roundScheduler.onRoomLifecycle(new RoomGameLifecycleEvent(
			"room01",
			3L,
			roundId,
			endsAt,
			RoomGameLifecycleEvent.Type.STARTED
		));
		roundScheduler.onRoomLifecycle(new RoomGameLifecycleEvent(
			"ROOM01",
			3L,
			roundId,
			endsAt,
			RoomGameLifecycleEvent.Type.STOPPED
		));
		verify(future).cancel(false);
		task.get().run();

		assertEquals("ROOM01", gateway.roomCode);
		assertEquals(roundId, gateway.roundId);
		assertEquals(3L, gateway.generation);
		assertEquals(RoundEndReason.TIME_EXPIRED, gateway.reason);
	}

	private static final class RecordingGateway
		implements RoomRoundFinalizationGateway {

		private String roomCode;
		private UUID roundId;
		private long generation;
		private RoundEndReason reason;

		@Override
		public FinalizedRoomRound finalizeRound(
			String roomCode,
			UUID expectedRoundId,
			long expectedGeneration,
			RoundEndReason reason
		) {
			this.roomCode = roomCode;
			this.roundId = expectedRoundId;
			this.generation = expectedGeneration;
			this.reason = reason;
			return null;
		}
	}
}
