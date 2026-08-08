package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureSpawnCoordinator;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.event.InMemoryRoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.movement.service.RoomMovementRoundControl;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceCommand;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceOutcome;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceService;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;

class GameEndedPublicationRetryIntegrationTests {

	private static final Instant NOW = Instant.parse("2026-08-07T10:00:00Z");

	@Test
	void scheduledTimeoutRetriesOnlyPublicationAfterStoppedRemovedFinalizationTask() {
		Fixture fixture = fixture(1);
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		ScheduledTask finalizationTask = fixture.tasks.getFirst();

		finalizationTask.runnable().run();

		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertEquals(MultiplayerRoomStatus.OPEN, fixture.room.getStatus());
		assertTrue(fixture.store.find(
			fixture.room.getRoomCode(), roundId
		).isPresent());
		assertEquals(1, fixture.publisher.attempts.size());
		assertTrue(fixture.publisher.successes.isEmpty());
		assertEquals(2, fixture.tasks.size());
		assertEquals(1, stoppedCount(fixture));
		verify(finalizationTask.future()).cancel(false);
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
		verify(fixture.scoreService, times(1)).snapshotRound(fixture.room);
		verify(fixture.movement, times(1)).freezeRound(
			anyString(), any(), anyLong(), any()
		);

		fixture.tasks.get(1).runnable().run();

		assertEquals(2, fixture.publisher.attempts.size());
		assertEquals(1, fixture.publisher.successes.size());
		assertEquals(roundId, fixture.publisher.successes.getFirst()
			.payload().roundId());
		assertEquals(1, stoppedCount(fixture));
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
		verify(fixture.scoreService, times(1)).snapshotRound(fixture.room);
	}

	@Test
	void roomClosureRetryDoesNotRepeatClosureLifecycleOrPersistence() {
		Fixture fixture = fixture(1);
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		ScheduledTask normalFinalizationTask = fixture.tasks.getFirst();

		fixture.roomService.closeRoom(
			fixture.room.getRoomCode(),
			fixture.host
		);

		assertEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertTrue(fixture.store.find(
			fixture.room.getRoomCode(), roundId
		).isPresent());
		assertEquals(1, closedCount(fixture));
		assertEquals(2, fixture.tasks.size());
		verify(normalFinalizationTask.future()).cancel(false);
		verify(fixture.persistence, times(1)).persistIfAbsent(any());

		fixture.tasks.get(1).runnable().run();

		assertEquals(1, fixture.publisher.successes.size());
		assertEquals(roundId, fixture.publisher.successes.getFirst()
			.payload().roundId());
		assertEquals(1, closedCount(fixture));
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
		verify(fixture.scoreService, times(1)).snapshotRound(fixture.room);
	}

	@Test
	void exhaustedPublicationRetriesLeaveTimeoutRoundCompletedWithoutFinalizationRetry() {
		Fixture fixture = fixture(Integer.MAX_VALUE);
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		ScheduledTask finalizationTask = fixture.tasks.getFirst();

		finalizationTask.runnable().run();
		fixture.tasks.get(1).runnable().run();
		fixture.tasks.get(2).runnable().run();

		assertEquals(
			GameEndedPublicationRetryService.MAX_PUBLICATION_ATTEMPTS,
			fixture.publisher.attempts.size()
		);
		assertTrue(fixture.publisher.successes.isEmpty());
		assertEquals(3, fixture.tasks.size());
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertEquals(MultiplayerRoomStatus.OPEN, fixture.room.getStatus());
		assertTrue(fixture.store.find(
			fixture.room.getRoomCode(), roundId
		).isPresent());
		assertEquals(1, stoppedCount(fixture));
		verify(finalizationTask.future()).cancel(false);
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
		verify(fixture.scoreService, times(1)).snapshotRound(fixture.room);
		verify(fixture.movement, times(1)).freezeRound(
			anyString(), any(), anyLong(), any()
		);
	}

	private long stoppedCount(Fixture fixture) {
		return fixture.lifecycleEvents.stream().filter(event ->
			event.type() == RoomGameLifecycleEvent.Type.STOPPED
		).count();
	}

	private long closedCount(Fixture fixture) {
		return fixture.lifecycleEvents.stream().filter(event ->
			event.type() == RoomGameLifecycleEvent.Type.CLOSED
		).count();
	}

	private Fixture fixture(int publicationFailures) {
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
		List<RoomGameLifecycleEvent> lifecycleEvents = new ArrayList<>();
		AtomicReference<RoomRoundScheduler> roundScheduler = new AtomicReference<>();
		MultiplayerRoomService roomService = new MultiplayerRoomService(event -> {
			RoomGameLifecycleEvent lifecycle = (RoomGameLifecycleEvent) event;
			lifecycleEvents.add(lifecycle);
			RoomRoundScheduler scheduler = roundScheduler.get();
			if (scheduler != null) {
				scheduler.onRoomLifecycle(lifecycle);
			}
		});
		RoomScoreService scoreService = spy(new RoomScoreService(roomService));
		RoomMovementRoundControl movement = mock(RoomMovementRoundControl.class);
		RoomCreatureService creatureService = mock(RoomCreatureService.class);
		RoomCreatureSpawnCoordinator spawnCoordinator = mock(
			RoomCreatureSpawnCoordinator.class
		);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		CompletedRoundPersistenceService persistence = mock(
			CompletedRoundPersistenceService.class
		);
		when(persistence.persistIfAbsent(any(
			CompletedRoundPersistenceCommand.class
		))).thenAnswer(invocation -> {
			CompletedRoundPersistenceCommand command = invocation.getArgument(0);
			return new CompletedRoundPersistenceOutcome(
				true,
				UUID.randomUUID(),
				command.finalizedRound().publicResult().roundId()
			);
		});
		FailingPublisher publisher = new FailingPublisher(publicationFailures);
		Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
		GameEndedPublicationRetryService publicationService =
			new GameEndedPublicationRetryService(
				taskScheduler,
				new InMemoryRoomEventSequencer(),
				publisher,
				clock
			);
		RoomRoundFinalizationService finalizer =
			new RoomRoundFinalizationService(
				roomService,
				movement,
				creatureService,
				spawnCoordinator,
				scoreService,
				store,
				persistence,
				publicationService,
				clock
			);
		RoomRoundScheduler scheduler = new RoomRoundScheduler(
			taskScheduler,
			finalizer,
			clock
		);
		roundScheduler.set(scheduler);
		finalizer.registerWithRoomLifecycle();
		UserEntity host = user("scheduled-host");
		MultiplayerRoom room = roomService.createRoom(
			host,
			new CreateRoomRequest("Scheduled publication retry")
		);
		return new Fixture(
			roomService,
			scoreService,
			movement,
			store,
			persistence,
			publisher,
			room,
			host,
			lifecycleEvents,
			tasks
		);
	}

	private UserEntity user(String username) {
		return new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			"Scheduled Host",
			"hashed-password"
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
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		RoomMovementRoundControl movement,
		InMemoryRoomRoundResultStore store,
		CompletedRoundPersistenceService persistence,
		FailingPublisher publisher,
		MultiplayerRoom room,
		UserEntity host,
		List<RoomGameLifecycleEvent> lifecycleEvents,
		List<ScheduledTask> tasks
	) {

		private void start() {
			roomService.startGame(
				room.getRoomCode(),
				host,
				new StartRoomGameRequest(60)
			);
		}
	}

	private record ScheduledTask(
		Runnable runnable,
		Instant scheduledAt,
		ScheduledFuture<?> future
	) {
	}
}
