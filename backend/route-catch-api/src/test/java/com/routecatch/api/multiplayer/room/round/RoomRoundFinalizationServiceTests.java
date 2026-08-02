package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
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
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureInstance;
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

class RoomRoundFinalizationServiceTests {

	private static final Instant NOW = Instant.parse("2026-07-26T10:00:00Z");

	@Test
	void startRestartUsesUniqueIdentityAndPreservesPreviousResult() {
		Fixture fixture = fixture();
		fixture.start();
		UUID firstRoundId = fixture.room.getGameState().getRoundId();

		fixture.finalizeRound(RoundEndReason.HOST_ENDED);
		FinalizedRoomRound first = fixture.store
			.find(fixture.room.getRoomCode(), firstRoundId)
			.orElseThrow();
		fixture.start();
		UUID secondRoundId = fixture.room.getGameState().getRoundId();

		assertNotEquals(firstRoundId, secondRoundId);
		assertEquals(2L, fixture.room.getGameState().getGeneration());
		assertSame(
			first,
			fixture.store.find(fixture.room.getRoomCode(), firstRoundId)
				.orElseThrow()
		);
	}

	@Test
	void finalizationTransitionsBeforeFreezeStoresBeforeEventAndIsIdempotent() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		when(fixture.movement.freezeRound(
			anyString(),
			any(),
			anyLong(),
			any()
		)).thenAnswer(invocation -> {
			assertEquals(
				RoomGameStatus.FINALIZING,
				fixture.room.getGameState().getStatus()
			);
			return 2;
		});
		fixture.publisher.beforePublish = event -> assertTrue(
			fixture.store.find(event.roomCode(), event.payload().roundId())
				.isPresent()
		);
		when(fixture.persistence.persistIfAbsent(any())).thenAnswer(invocation -> {
			CompletedRoundPersistenceCommand command = invocation.getArgument(0);
			assertEquals(60, command.durationSeconds());
			assertEquals(
				RoomGameStatus.FINALIZING,
				fixture.room.getGameState().getStatus()
			);
			assertFalse(fixture.store.find(
				fixture.room.getRoomCode(),
				roundId
			).isPresent());
			assertTrue(fixture.publisher.events.isEmpty());
			return persistenceOutcome(command);
		});

		FinalizedRoomRound first = fixture.finalizeRound(
			RoundEndReason.HOST_ENDED
		);
		FinalizedRoomRound duplicate = fixture.finalizer.finalizeRound(
			fixture.room.getRoomCode(),
			roundId,
			1L,
			RoundEndReason.TIME_EXPIRED
		);

		assertSame(first, duplicate);
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertEquals(1, fixture.publisher.events.size());
		verify(fixture.movement).freezeRound(
			fixture.room.getRoomCode(),
			roundId,
			1L,
			NOW
		);
		verify(fixture.spawnCoordinator).stop(
			fixture.room.getRoomCode(),
			1L,
			"FINALIZING"
		);
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
	}

	@Test
	void persistenceFailureKeepsExactFrozenRoundRetryableWithoutCompletionEvents() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		AtomicBoolean persistenceAvailable = new AtomicBoolean(false);
		when(fixture.persistence.persistIfAbsent(any())).thenAnswer(invocation -> {
			if (!persistenceAvailable.get()) {
				throw new RuntimeException("database unavailable");
			}
			return persistenceOutcome(invocation.getArgument(0));
		});

		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			() -> fixture.finalizeRound(RoundEndReason.HOST_ENDED)
		);

		assertEquals("ROUND_PERSISTENCE_UNAVAILABLE", failure.getErrorCode());
		assertEquals(RoomGameStatus.FINALIZING, fixture.room.getGameState().getStatus());
		assertFalse(fixture.store.find(fixture.room.getRoomCode(), roundId).isPresent());
		assertTrue(fixture.publisher.events.isEmpty());
		assertEquals(
			List.of(
				RoomGameLifecycleEvent.Type.STARTED,
				RoomGameLifecycleEvent.Type.FINALIZING
			),
			fixture.lifecycleEvents.stream().map(RoomGameLifecycleEvent::type).toList()
		);
		AtomicBoolean gameplayMutationRan = new AtomicBoolean(false);
		assertThrows(
			RoundLifecycleException.class,
			() -> fixture.roomService.withCurrentRoundRunning(
				fixture.room.getRoomCode(),
				1L,
				() -> gameplayMutationRan.getAndSet(true)
			)
		);
		assertFalse(gameplayMutationRan.get());
		assertEquals(RoomGameStatus.FINALIZING, fixture.room.getGameState().getStatus());

		persistenceAvailable.set(true);
		FinalizedRoomRound retried = fixture.finalizer.finalizeRound(
			fixture.room.getRoomCode(),
			roundId,
			1L,
			RoundEndReason.TIME_EXPIRED
		);

		assertEquals(roundId, retried.publicResult().roundId());
		assertEquals(RoundEndReason.HOST_ENDED, retried.publicResult().endReason());
		assertEquals(NOW, retried.publicResult().endedAt());
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertSame(retried, fixture.store.find(
			fixture.room.getRoomCode(),
			roundId
		).orElseThrow());
		assertEquals(1, fixture.publisher.events.size());
		verify(fixture.movement, times(1)).freezeRound(
			fixture.room.getRoomCode(),
			roundId,
			1L,
			NOW
		);
		verify(fixture.spawnCoordinator, times(1)).stop(
			fixture.room.getRoomCode(),
			1L,
			"FINALIZING"
		);
		verify(fixture.persistence, times(3)).persistIfAbsent(any());
	}

	@Test
	void gameEndedFailureLeavesCommittedStateAndDuplicateRetriesPublicationOnly() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		fixture.publisher.beforePublish = ignored -> {
			throw new RuntimeException("transport failure");
		};

		assertThrows(
			RuntimeException.class,
			() -> fixture.finalizeRound(RoundEndReason.HOST_ENDED)
		);

		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		FinalizedRoomRound stored = fixture.store.find(
			fixture.room.getRoomCode(),
			roundId
		).orElseThrow();
		assertTrue(fixture.publisher.events.isEmpty());

		fixture.publisher.beforePublish = ignored -> {};
		FinalizedRoomRound retried = fixture.finalizer.finalizeRound(
			fixture.room.getRoomCode(),
			roundId,
			1L,
			RoundEndReason.HOST_ENDED
		);

		assertSame(stored, retried);
		assertEquals(1, fixture.publisher.events.size());
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
	}

	@Test
	void roomClosePersistsBeforeClosingAndPublishingClosed() {
		Fixture fixture = fixture();
		fixture.start();
		when(fixture.persistence.persistIfAbsent(any())).thenAnswer(invocation -> {
			assertEquals(MultiplayerRoomStatus.IN_PROGRESS, fixture.room.getStatus());
			assertEquals(RoomGameStatus.FINALIZING, fixture.room.getGameState().getStatus());
			assertFalse(fixture.lifecycleEvents.stream().anyMatch(event ->
				event.type() == RoomGameLifecycleEvent.Type.CLOSED
			));
			return persistenceOutcome(invocation.getArgument(0));
		});

		FinalizedRoomRound result = fixture.finalizeRound(
			RoundEndReason.ROOM_CLOSED
		);

		assertEquals(RoundEndReason.ROOM_CLOSED, result.publicResult().endReason());
		assertEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
		assertEquals(
			RoomGameLifecycleEvent.Type.CLOSED,
			fixture.lifecycleEvents.getLast().type()
		);
	}

	@Test
	void lastMemberLeavingRunningRoundDefersClosureUntilPersistenceSucceeds() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		AtomicBoolean persistenceAvailable = new AtomicBoolean(false);
		when(fixture.persistence.persistIfAbsent(any())).thenAnswer(invocation -> {
			assertNotEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
			assertFalse(fixture.store.find(
				fixture.room.getRoomCode(),
				roundId
			).isPresent());
			if (!persistenceAvailable.get()) {
				throw new RuntimeException("database unavailable");
			}
			return persistenceOutcome(invocation.getArgument(0));
		});

		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			() -> fixture.roomService.leaveRoom(
				fixture.room.getRoomCode(),
				fixture.players.getFirst()
			)
		);

		assertEquals("ROUND_PERSISTENCE_UNAVAILABLE", failure.getErrorCode());
		assertTrue(fixture.room.getMembers().isEmpty());
		assertEquals(MultiplayerRoomStatus.IN_PROGRESS, fixture.room.getStatus());
		assertEquals(RoomGameStatus.FINALIZING, fixture.room.getGameState().getStatus());
		assertTrue(fixture.finalizer.hasFinalizationContext(
			fixture.room.getRoomCode(), roundId, 1L
		));
		assertTrue(fixture.finalizer.closesRoomAfterFinalization(
			fixture.room.getRoomCode(), roundId, 1L
		));
		assertFalse(fixture.lifecycleEvents.stream().anyMatch(event ->
			event.type() == RoomGameLifecycleEvent.Type.CLOSED
		));
		assertTrue(fixture.publisher.events.isEmpty());

		persistenceAvailable.set(true);
		fixture.publisher.beforePublish = event -> {
			assertEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
			assertTrue(fixture.store.find(event.roomCode(), roundId).isPresent());
		};
		FinalizedRoomRound result = fixture.finalizer.finalizeRound(
			fixture.room.getRoomCode(), roundId, 1L, RoundEndReason.TIME_EXPIRED
		);

		assertEquals(RoundEndReason.ROOM_CLOSED, result.publicResult().endReason());
		assertEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertFalse(fixture.finalizer.hasFinalizationContext(
			fixture.room.getRoomCode(), roundId, 1L
		));
		assertEquals(1, fixture.publisher.events.size());
		assertEquals(1, fixture.lifecycleEvents.stream().filter(event ->
			event.type() == RoomGameLifecycleEvent.Type.CLOSED
		).count());
		verify(fixture.persistence, times(2)).persistIfAbsent(any());
	}

	@Test
	void lastMemberLeavingWithoutActiveRoundStillClosesImmediately() {
		Fixture fixture = fixture();

		fixture.roomService.leaveRoom(
			fixture.room.getRoomCode(),
			fixture.players.getFirst()
		);

		assertTrue(fixture.room.getMembers().isEmpty());
		assertEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
		assertEquals(RoomGameStatus.WAITING, fixture.room.getGameState().getStatus());
		assertEquals(
			List.of(RoomGameLifecycleEvent.Type.CLOSED),
			fixture.lifecycleEvents.stream().map(RoomGameLifecycleEvent::type).toList()
		);
		verify(fixture.persistence, never()).persistIfAbsent(any());
	}

	@Test
	void closeDuringPendingHostEndPreservesResultAndUpgradesRoomDisposition() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		AtomicBoolean persistenceAvailable = new AtomicBoolean(false);
		when(fixture.persistence.persistIfAbsent(any())).thenAnswer(invocation -> {
			if (!persistenceAvailable.get()) {
				throw new RuntimeException("database unavailable");
			}
			assertTrue(fixture.finalizer.closesRoomAfterFinalization(
				fixture.room.getRoomCode(), roundId, 1L
			));
			assertEquals(MultiplayerRoomStatus.IN_PROGRESS, fixture.room.getStatus());
			return persistenceOutcome(invocation.getArgument(0));
		});

		assertThrows(
			RoundLifecycleException.class,
			() -> fixture.finalizeRound(RoundEndReason.HOST_ENDED)
		);
		persistenceAvailable.set(true);

		fixture.roomService.closeRoom(
			fixture.room.getRoomCode(),
			fixture.players.getFirst()
		);

		FinalizedRoomRound stored = fixture.store.find(
			fixture.room.getRoomCode(), roundId
		).orElseThrow();
		assertEquals(RoundEndReason.HOST_ENDED, stored.publicResult().endReason());
		assertEquals(NOW, stored.publicResult().endedAt());
		assertEquals(MultiplayerRoomStatus.CLOSED, fixture.room.getStatus());
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertFalse(fixture.finalizer.hasFinalizationContext(
			fixture.room.getRoomCode(), roundId, 1L
		));
		assertEquals(1, fixture.publisher.events.size());
		verify(fixture.movement, times(1)).freezeRound(anyString(), any(), anyLong(), any());
		verify(fixture.persistence, times(2)).persistIfAbsent(any());
	}

	@Test
	void movementFreezeFailureCanResumeSameFinalizationContext() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		when(fixture.movement.freezeRound(anyString(), any(), anyLong(), any()))
			.thenThrow(new RuntimeException("movement failure"))
			.thenReturn(2);

		assertRetryablePreparationFailure(fixture, roundId);
		fixture.finalizeRound(RoundEndReason.TIME_EXPIRED);

		assertSuccessfulPreparationRetry(fixture, roundId);
		verify(fixture.movement, times(2)).freezeRound(anyString(), any(), anyLong(), any());
		verify(fixture.creatureService, times(1)).freezeRound(anyString(), anyLong());
		verify(fixture.spawnCoordinator, times(1)).stop(anyString(), anyLong(), anyString());
	}

	@Test
	void creatureFreezeFailureDoesNotRepeatCompletedMovementFreeze() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		when(fixture.creatureService.freezeRound(anyString(), anyLong()))
			.thenThrow(new RuntimeException("creature failure"))
			.thenReturn(3);

		assertRetryablePreparationFailure(fixture, roundId);
		fixture.finalizeRound(RoundEndReason.TIME_EXPIRED);

		assertSuccessfulPreparationRetry(fixture, roundId);
		verify(fixture.movement, times(1)).freezeRound(anyString(), any(), anyLong(), any());
		verify(fixture.creatureService, times(2)).freezeRound(anyString(), anyLong());
		verify(fixture.spawnCoordinator, times(1)).stop(anyString(), anyLong(), anyString());
	}

	@Test
	void scoreSnapshotFailureDoesNotRepeatCompletedCleanup() {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		doThrow(new RuntimeException("snapshot failure"))
			.doCallRealMethod()
			.when(fixture.scoreService)
			.snapshotRound(fixture.room);

		assertRetryablePreparationFailure(fixture, roundId);
		fixture.finalizeRound(RoundEndReason.TIME_EXPIRED);

		assertSuccessfulPreparationRetry(fixture, roundId);
		verify(fixture.movement, times(1)).freezeRound(anyString(), any(), anyLong(), any());
		verify(fixture.creatureService, times(1)).freezeRound(anyString(), anyLong());
		verify(fixture.spawnCoordinator, times(1)).stop(anyString(), anyLong(), anyString());
		verify(fixture.scoreService, times(2)).snapshotRound(fixture.room);
	}

	@Test
	void timerExpiryFinalizesAtTheAuthoritativeDeadline() {
		Fixture fixture = fixture();
		fixture.start();
		Instant deadline = fixture.room.getGameState().getEndsAt();

		FinalizedRoomRound result = fixture.finalizeRound(
			RoundEndReason.TIME_EXPIRED
		);

		assertEquals(
			RoundEndReason.TIME_EXPIRED,
			result.publicResult().endReason()
		);
		assertEquals(deadline, result.publicResult().endedAt());
		assertEquals(deadline, fixture.room.getGameState().getEndedAt());
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
	}

	@Test
	void rankingUsesCompetitionRanksAndDeterministicTieOrdering() {
		Fixture fixture = fixtureWithPlayers(
			user("alpha", "Alpha"),
			user("beta", "Beta"),
			user("gamma", "Gamma"),
			user("delta", "Delta")
		);
		fixture.start();
		fixture.catchFor(fixture.players.get(0), 180, "legendary");
		fixture.catchFor(fixture.players.get(1), 75, "rare");
		fixture.catchFor(fixture.players.get(1), 75, "common");
		fixture.catchFor(fixture.players.get(2), 150, "rare");
		fixture.catchFor(fixture.players.get(3), 90, "common");

		FinalizedRoomRound result = fixture.finalizeRound(
			RoundEndReason.HOST_ENDED
		);
		List<RoundLeaderboardEntry> leaderboard =
			result.publicResult().leaderboard();

		assertEquals(List.of(180, 150, 150, 90), leaderboard
			.stream().map(RoundLeaderboardEntry::score).toList());
		assertEquals(List.of(1, 2, 2, 4), leaderboard
			.stream().map(RoundLeaderboardEntry::rank).toList());
		assertEquals("Beta", leaderboard.get(1).displayName());
		assertEquals("Gamma", leaderboard.get(2).displayName());
	}

	@Test
	void personalResultContainsOnlyOwnImmutableCatchDetailsAndRarityCounts() {
		Fixture fixture = fixtureWithPlayers(
			user("host", "Host"),
			user("other", "Other"),
			user("zero", "Zero")
		);
		fixture.start();
		fixture.catchFor(fixture.players.get(0), 100, "rare");
		fixture.catchFor(fixture.players.get(1), 50, "common");

		FinalizedRoomRound result = fixture.finalizeRound(
			RoundEndReason.HOST_ENDED
		);
		PersonalRoundResult host = result.personalResults().get(
			fixture.players.get(0).getUserId()
		);
		PersonalRoundResult zero = result.personalResults().get(
			fixture.players.get(2).getUserId()
		);

		assertEquals(3, result.publicResult().playerCount());
		assertEquals(1, host.caughtCreatures().size());
		assertEquals(100, host.score());
		assertEquals(1, host.rarityCounts().get("rare"));
		assertEquals(0, zero.score());
		assertEquals(0, zero.creaturesCaught());
		assertTrue(zero.caughtCreatures().isEmpty());
		assertThrows(
			UnsupportedOperationException.class,
			() -> host.caughtCreatures().clear()
		);
	}

	@Test
	void concurrentHostAndTimeoutFinalizationProduceOneResultAndEvent()
		throws Exception {
		Fixture fixture = fixture();
		fixture.start();
		UUID roundId = fixture.room.getGameState().getRoundId();
		CountDownLatch ready = new CountDownLatch(2);
		CountDownLatch go = new CountDownLatch(1);

		try (var executor = Executors.newFixedThreadPool(2)) {
			Callable<FinalizedRoomRound> hostEnd = () -> {
				ready.countDown();
				go.await();
				return fixture.finalizer.finalizeRound(
					fixture.room.getRoomCode(),
					roundId,
					1L,
					RoundEndReason.HOST_ENDED
				);
			};
			Callable<FinalizedRoomRound> timeout = () -> {
				ready.countDown();
				go.await();
				return fixture.finalizer.finalizeRound(
					fixture.room.getRoomCode(),
					roundId,
					1L,
					RoundEndReason.TIME_EXPIRED
				);
			};
			var first = executor.submit(hostEnd);
			var second = executor.submit(timeout);
			ready.await();
			go.countDown();

			assertSame(first.get(), second.get());
		}

		assertEquals(1, fixture.publisher.events.size());
	}

	@Test
	void staleRoomCloseCannotFinalizeOrCloseNewerRound() {
		Fixture fixture = fixture();
		fixture.start();
		fixture.finalizeRound(RoundEndReason.HOST_ENDED);
		fixture.start();

		RoundLifecycleException exception = assertThrows(
			RoundLifecycleException.class,
			() -> fixture.finalizer.finalizeRound(
				fixture.room.getRoomCode(),
				UUID.randomUUID(),
				1L,
				RoundEndReason.ROOM_CLOSED
			)
		);

		assertEquals("STALE_ROUND_GENERATION", exception.getErrorCode());
		assertEquals(RoomGameStatus.RUNNING, fixture.room.getGameState().getStatus());
		assertEquals(
			MultiplayerRoomStatus.IN_PROGRESS,
			fixture.room.getStatus()
		);
		assertEquals(1, fixture.publisher.events.size());
	}

	@Test
	void realCompletedRoundCallbackCannotRepublishAfterNewRoundStarts() {
		Fixture fixture = fixture();
		fixture.start();
		UUID firstRoundId = fixture.room.getGameState().getRoundId();
		long firstGeneration = fixture.room.getGameState().getGeneration();
		fixture.finalizeRound(RoundEndReason.HOST_ENDED);
		fixture.start();
		UUID secondRoundId = fixture.room.getGameState().getRoundId();

		RoundLifecycleException exception = assertThrows(
			RoundLifecycleException.class,
			() -> fixture.finalizer.finalizeRound(
				fixture.room.getRoomCode(),
				firstRoundId,
				firstGeneration,
				RoundEndReason.HOST_ENDED
			)
		);

		assertEquals("STALE_ROUND_GENERATION", exception.getErrorCode());
		assertEquals(secondRoundId, fixture.room.getGameState().getRoundId());
		assertEquals(2L, fixture.room.getGameState().getGeneration());
		assertEquals(RoomGameStatus.RUNNING, fixture.room.getGameState().getStatus());
		assertEquals(1, fixture.publisher.events.size());
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
	}

	private void assertRetryablePreparationFailure(
		Fixture fixture,
		UUID roundId
	) {
		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			() -> fixture.finalizeRound(RoundEndReason.HOST_ENDED)
		);

		assertEquals("ROUND_FINALIZATION_UNAVAILABLE", failure.getErrorCode());
		assertEquals(RoomGameStatus.FINALIZING, fixture.room.getGameState().getStatus());
		assertEquals(MultiplayerRoomStatus.IN_PROGRESS, fixture.room.getStatus());
		assertTrue(fixture.finalizer.hasFinalizationContext(
			fixture.room.getRoomCode(), roundId, 1L
		));
		assertFalse(fixture.lifecycleEvents.stream().anyMatch(event ->
			event.type() == RoomGameLifecycleEvent.Type.STOPPED ||
				event.type() == RoomGameLifecycleEvent.Type.CLOSED
		));
		assertTrue(fixture.publisher.events.isEmpty());
		verify(fixture.persistence, never()).persistIfAbsent(any());
	}

	private void assertSuccessfulPreparationRetry(
		Fixture fixture,
		UUID roundId
	) {
		assertEquals(RoomGameStatus.ENDED, fixture.room.getGameState().getStatus());
		assertEquals(MultiplayerRoomStatus.OPEN, fixture.room.getStatus());
		assertTrue(fixture.store.find(
			fixture.room.getRoomCode(), roundId
		).isPresent());
		assertFalse(fixture.finalizer.hasFinalizationContext(
			fixture.room.getRoomCode(), roundId, 1L
		));
		assertEquals(1, fixture.publisher.events.size());
		verify(fixture.persistence, times(1)).persistIfAbsent(any());
	}

	private Fixture fixture() {
		return fixtureWithPlayers(user("host", "Host"));
	}

	private Fixture fixtureWithPlayers(UserEntity... players) {
		List<RoomGameLifecycleEvent> lifecycleEvents = new ArrayList<>();
		MultiplayerRoomService roomService = new MultiplayerRoomService(event ->
			lifecycleEvents.add((RoomGameLifecycleEvent) event)
		);
		RoomScoreService scoreService = spy(new RoomScoreService(roomService));
		RoomCreatureService creatureService = mock(RoomCreatureService.class);
		RoomCreatureSpawnCoordinator spawnCoordinator = mock(
			RoomCreatureSpawnCoordinator.class
		);
		RoomMovementRoundControl movement = mock(
			RoomMovementRoundControl.class
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
		RecordingPublisher publisher = new RecordingPublisher();
		RoomRoundFinalizationService finalizer =
			new RoomRoundFinalizationService(
				roomService,
				movement,
				creatureService,
				spawnCoordinator,
				scoreService,
				store,
				persistence,
				new InMemoryRoomEventSequencer(),
				publisher,
				Clock.fixed(NOW, ZoneOffset.UTC)
			);
		finalizer.registerWithRoomLifecycle();
		List<UserEntity> playerList = List.of(players);
		MultiplayerRoom room = roomService.createRoom(
			playerList.getFirst(),
			new CreateRoomRequest("Finalization Room")
		);
		playerList.stream().skip(1).forEach(player ->
			roomService.joinRoom(room.getRoomCode(), player)
		);
		return new Fixture(
			roomService,
			scoreService,
			movement,
			creatureService,
			spawnCoordinator,
			store,
			persistence,
			publisher,
			finalizer,
			room,
			playerList,
			lifecycleEvents
		);
	}

	private static CompletedRoundPersistenceOutcome persistenceOutcome(
		CompletedRoundPersistenceCommand command
	) {
		return new CompletedRoundPersistenceOutcome(
			true,
			UUID.randomUUID(),
			command.finalizedRound().publicResult().roundId()
		);
	}

	private UserEntity user(String username, String displayName) {
		return new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			displayName,
			"hashed-password"
		);
	}

	private static final class RecordingPublisher
		implements RoomRoundEventPublisher {

		private final List<RoomEventEnvelope<PublicRoundResult>> events =
			new ArrayList<>();
		private java.util.function.Consumer<
			RoomEventEnvelope<PublicRoundResult>
		> beforePublish = ignored -> {};

		@Override
		public void publish(RoomEventEnvelope<PublicRoundResult> event) {
			beforePublish.accept(event);
			events.add(event);
		}
	}

	private record Fixture(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		RoomMovementRoundControl movement,
		RoomCreatureService creatureService,
		RoomCreatureSpawnCoordinator spawnCoordinator,
		InMemoryRoomRoundResultStore store,
		CompletedRoundPersistenceService persistence,
		RecordingPublisher publisher,
		RoomRoundFinalizationService finalizer,
		MultiplayerRoom room,
		List<UserEntity> players,
		List<RoomGameLifecycleEvent> lifecycleEvents
	) {

		private void start() {
			roomService.startGame(
				room.getRoomCode(),
				players.getFirst(),
				new StartRoomGameRequest(60)
			);
		}

		private FinalizedRoomRound finalizeRound(RoundEndReason reason) {
			return finalizer.finalizeRound(
				room.getRoomCode(),
				room.getGameState().getRoundId(),
				room.getGameState().getGeneration(),
				reason
			);
		}

		private void catchFor(
			UserEntity player,
			int score,
			String rarity
		) {
			RoomCreatureInstance creature = new RoomCreatureInstance(
				UUID.randomUUID(),
				room.getRoomCode(),
				"creature-" + UUID.randomUUID(),
				"Creature",
				rarity,
				score,
				28.6,
				77.2,
				NOW.minusSeconds(5),
				NOW.plusSeconds(30)
			);
			creature.markCaught(player.getUserId(), player.getDisplayName(), NOW);
			scoreService.recordCatch(room, player, creature);
		}
	}
}
