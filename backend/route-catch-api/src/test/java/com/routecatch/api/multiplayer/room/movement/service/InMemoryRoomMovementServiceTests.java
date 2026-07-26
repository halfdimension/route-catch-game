package com.routecatch.api.multiplayer.room.movement.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.room.creature.GeoPoint;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.dto.UpdateRoomSettingsRequest;
import com.routecatch.api.multiplayer.room.event.InMemoryRoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomEventType;
import com.routecatch.api.multiplayer.room.exception.RoomForbiddenException;
import com.routecatch.api.multiplayer.room.movement.dto.CancelRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementSnapshotResponse;
import com.routecatch.api.multiplayer.room.movement.dto.StartRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.event.RoomMovementEventPublisher;
import com.routecatch.api.multiplayer.room.movement.exception.MovementRejectedException;
import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;
import com.routecatch.api.multiplayer.room.movement.model.MovementStatus;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRoute;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRouteClient;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;
import com.routecatch.api.multiplayer.service.PresenceService;

class InMemoryRoomMovementServiceTests {

	private static final Instant START_TIME = Instant.parse(
		"2026-07-18T10:00:00Z"
	);
	private static final double COORDINATE_TOLERANCE = 0.0000001;
	private static final double ROUTE_DISTANCE_METERS = 100.0;
	private static final int ROOM_MAX_SPEED_MPS = 100;

	@Test
	void roomMemberStartsMovementFromAuthoritativePresence() {
		Fixture fixture = fixture(true);

		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);

		assertEquals(fixture.roomCode, movement.roomCode());
		assertEquals(fixture.host.getUserId(), movement.playerId());
		assertEquals(1L, movement.version());
		assertEquals(MovementStatus.MOVING, movement.status());
		assertEquals("???o}@", movement.encodedPolyline6());
		assertEquals(10.0, movement.simulationSpeedMps());
		assertEquals(START_TIME, movement.startedAt());
		assertEquals(START_TIME.plusSeconds(10), movement.expectedEndAt());
		assertCoordinate(movement.source(), 0.0, 0.0);
		assertCoordinate(movement.destination(), 0.0, 0.001);
		assertCoordinate(movement.currentPosition(), 0.0, 0.0);
		assertEquals(1, fixture.routeClient.calls.size());
		assertCoordinate(fixture.routeClient.calls.getFirst().source(), 0.0, 0.0);
		assertCoordinate(
			fixture.routeClient.calls.getFirst().destination(),
			0.0,
			0.001
		);
		assertEquals(1, fixture.scheduler.tasks.size());
		assertEquals(
			movement.expectedEndAt(),
			fixture.scheduler.tasks.getFirst().completionTime()
		);
		assertEquals(1, fixture.publisher.events.size());
		assertEquals(
			RoomEventType.MOVEMENT_STARTED,
			fixture.publisher.events.getFirst().eventType()
		);
		assertEquals(1L, fixture.publisher.events.getFirst().roomSequence());
	}

	@Test
	void firstMovementFallsBackToConfiguredInitialPositionWithoutPresence() {
		Fixture fixture = fixture(true);
		fixture.presenceService.removeSocketSession(
			"socket-" + fixture.host.getUserId()
		);

		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);

		assertCoordinate(movement.source(), 28.550584, 77.268858);
		assertCoordinate(
			fixture.routeClient.calls.getFirst().source(),
			28.550584,
			77.268858
		);
	}

	@Test
	void nonMemberCannotStartMovement() {
		Fixture fixture = fixture(true);
		UserEntity outsider = user("outsider", "Outsider");

		assertThrows(
			RoomForbiddenException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				outsider,
				startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
			)
		);

		assertTrue(fixture.routeClient.calls.isEmpty());
		assertTrue(fixture.publisher.events.isEmpty());
		assertTrue(fixture.scheduler.tasks.isEmpty());
	}

	@Test
	void movementCannotStartBeforeRoomGameIsRunning() {
		Fixture fixture = fixture(true, false);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
			)
		);

		assertEquals("ROOM_GAME_NOT_RUNNING", exception.getErrorCode());
		assertTrue(fixture.routeClient.calls.isEmpty());
		assertTrue(fixture.publisher.events.isEmpty());
	}

	@Test
	void speedAboveRoomMaximumIsRejectedBeforeRouting() {
		Fixture fixture = fixture(true);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(
					0.001,
					ROOM_MAX_SPEED_MPS + 1.0,
					UUID.randomUUID(),
					0L
				)
			)
		);

		assertEquals(
			"MOVEMENT_SPEED_EXCEEDS_ROOM_MAX",
			exception.getErrorCode()
		);
		assertTrue(fixture.routeClient.calls.isEmpty());
		assertTrue(fixture.publisher.events.isEmpty());
	}

	@Test
	void nonFiniteDestinationIsRejectedBeforeRouting() {
		Fixture fixture = fixture(true);
		StartRoomMovementRequest request = new StartRoomMovementRequest(
			Double.NaN,
			0.001,
			10.0,
			MovementDestinationType.MAP,
			null,
			UUID.randomUUID(),
			0L
		);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				request
			)
		);

		assertEquals("INVALID_MOVEMENT_COMMAND", exception.getErrorCode());
		assertTrue(fixture.routeClient.calls.isEmpty());
	}

	@Test
	void mapMovementWithoutDestinationIsRejectedBeforeRouting() {
		Fixture fixture = fixture(true);
		StartRoomMovementRequest request = new StartRoomMovementRequest(
			null,
			null,
			10.0,
			MovementDestinationType.MAP,
			null,
			UUID.randomUUID(),
			0L
		);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				request
			)
		);

		assertEquals("INVALID_MOVEMENT_COMMAND", exception.getErrorCode());
		assertTrue(fixture.routeClient.calls.isEmpty());
	}

	@Test
	void nonPositiveAndNonFiniteSpeedsAreRejectedBeforeRouting() {
		Fixture fixture = fixture(true);

		for (double speed : List.of(
			0.0,
			-1.0,
			Double.NaN,
			Double.POSITIVE_INFINITY
		)) {
			assertThrows(
				MovementRejectedException.class,
				() -> fixture.service.startMovement(
					fixture.roomCode,
					fixture.host,
					startRequest(0.001, speed, UUID.randomUUID(), 0L)
				)
			);
		}

		assertTrue(fixture.routeClient.calls.isEmpty());
		assertTrue(fixture.publisher.events.isEmpty());
	}

	@Test
	void disabledPlayerSpeedControlUsesServerRoomSpeedPolicy() {
		Fixture fixture = fixture(false);

		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);

		assertEquals(ROOM_MAX_SPEED_MPS, movement.simulationSpeedMps());
		assertEquals(START_TIME.plusSeconds(1), movement.expectedEndAt());
	}

	@Test
	void replacementStartsAtInterpolatedPositionAndIncrementsVersion() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));

		RoomMovementPlanResponse replacement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
		);

		assertEquals(2L, replacement.version());
		assertFalse(first.movementId().equals(replacement.movementId()));
		assertCoordinate(replacement.source(), 0.0, 0.0005);
		assertCoordinate(
			fixture.routeClient.calls.get(1).source(),
			0.0,
			0.0005
		);
		assertEquals(2, fixture.scheduler.tasks.size());
		assertEquals(
			List.of(
				RoomEventType.MOVEMENT_STARTED,
				RoomEventType.MOVEMENT_CANCELLED,
				RoomEventType.MOVEMENT_STARTED
			),
			fixture.publisher.eventTypes()
		);
		assertEquals(List.of(1L, 2L, 3L), fixture.publisher.sequences());
		RoomMovementPlanResponse cancelled = fixture.publisher.events
			.get(1)
			.payload();
		assertEquals(first.movementId(), cancelled.movementId());
		assertEquals(MovementStatus.CANCELLED, cancelled.status());
		assertCoordinate(cancelled.currentPosition(), 0.0, 0.0005);
	}

	@Test
	void spawnPositionPrefersActivePlanThenStoredPositionOverPresence() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));
		updatePresence(fixture, 9.0, 9.0);

		GeoPoint movingPosition = fixture.service
			.resolveAuthoritativePosition(
				fixture.roomCode,
				fixture.host.getUserId(),
				fixture.clock.instant()
			)
			.orElseThrow();

		assertEquals(0.0, movingPosition.latitude(), COORDINATE_TOLERANCE);
		assertEquals(0.0005, movingPosition.longitude(), COORDINATE_TOLERANCE);

		fixture.service.cancelMovement(
			fixture.roomCode,
			fixture.host,
			cancelRequest(movement, UUID.randomUUID())
		);
		updatePresence(fixture, 8.0, 8.0);
		GeoPoint stationaryPosition = fixture.service
			.resolveAuthoritativePosition(
				fixture.roomCode,
				fixture.host.getUserId(),
				fixture.clock.instant()
			)
			.orElseThrow();

		assertEquals(0.0, stationaryPosition.latitude(), COORDINATE_TOLERANCE);
		assertEquals(
			0.0005,
			stationaryPosition.longitude(),
			COORDINATE_TOLERANCE
		);
	}

	@Test
	void routeFailureLeavesExistingMovementActiveWithoutReplacementEvents() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));
		fixture.routeClient.failNext(new RoutingEngineException(
			"ROUTING_ENGINE_UNAVAILABLE",
			"Routing engine is not reachable"
		));

		RoutingEngineException exception = assertThrows(
			RoutingEngineException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
			)
		);

		assertEquals("ROUTING_ENGINE_UNAVAILABLE", exception.getErrorCode());
		RoomMovementSnapshotResponse snapshot = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		);
		assertEquals(1, snapshot.movements().size());
		assertEquals(first.movementId(), snapshot.movements().getFirst().movementId());
		assertEquals(MovementStatus.MOVING, snapshot.movements().getFirst().status());
		assertCoordinate(
			snapshot.movements().getFirst().currentPosition(),
			0.0,
			0.0005
		);
		assertEquals(2, fixture.routeClient.calls.size());
		assertEquals(1, fixture.publisher.events.size());
		assertEquals(1, fixture.scheduler.tasks.size());
	}

	@Test
	void blockedRouteLookupDoesNotBlockMovementSnapshot() throws Exception {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse current = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.routeClient.blockNextCall();
		ExecutorService executor = Executors.newCachedThreadPool();
		Future<RoomMovementPlanResponse> pendingStart = executor.submit(() ->
			fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
			)
		);

		try {
			assertTrue(fixture.routeClient.awaitBlockedCall());
			Future<RoomMovementSnapshotResponse> pendingSnapshot = executor.submit(
				() -> fixture.service.getSnapshot(fixture.roomCode, fixture.host)
			);

			RoomMovementSnapshotResponse snapshot = getWithin(pendingSnapshot);

			assertEquals(1, snapshot.movements().size());
			assertEquals(
				current.movementId(),
				snapshot.movements().getFirst().movementId()
			);
			assertEquals(
				MovementStatus.MOVING,
				snapshot.movements().getFirst().status()
			);

			fixture.routeClient.releaseBlockedCall();
			RoomMovementPlanResponse replacement = getWithin(pendingStart);
			assertEquals(2L, replacement.version());
		} finally {
			fixture.routeClient.releaseBlockedCall();
			shutdown(executor);
		}
	}

	@Test
	void cancellationDuringBlockedRouteLookupPreventsStaleStartCommit()
		throws Exception {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse current = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));
		fixture.routeClient.blockNextCall();
		ExecutorService executor = Executors.newCachedThreadPool();
		Future<RoomMovementPlanResponse> pendingStart = executor.submit(() ->
			fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
			)
		);

		try {
			assertTrue(fixture.routeClient.awaitBlockedCall());
			Future<Optional<RoomMovementPlanResponse>> pendingCancellation =
				executor.submit(() -> fixture.service.cancelMovement(
					fixture.roomCode,
					fixture.host,
					cancelRequest(current, UUID.randomUUID())
				));

			RoomMovementPlanResponse cancelled = getWithin(pendingCancellation)
				.orElseThrow();
			assertEquals(MovementStatus.CANCELLED, cancelled.status());
			assertCoordinate(cancelled.currentPosition(), 0.0, 0.0005);

			fixture.routeClient.releaseBlockedCall();
			assertStaleStartRejected(pendingStart);

			RoomMovementPlanResponse latest = fixture.service.getSnapshot(
				fixture.roomCode,
				fixture.host
			).movements().getFirst();
			assertEquals(current.movementId(), latest.movementId());
			assertEquals(1L, latest.version());
			assertEquals(MovementStatus.CANCELLED, latest.status());
		} finally {
			fixture.routeClient.releaseBlockedCall();
			shutdown(executor);
		}
	}

	@Test
	void completionDuringBlockedRouteLookupPreventsStaleStartCommit()
		throws Exception {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse current = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.routeClient.blockNextCall();
		ExecutorService executor = Executors.newCachedThreadPool();
		Future<RoomMovementPlanResponse> pendingStart = executor.submit(() ->
			fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
			)
		);

		try {
			assertTrue(fixture.routeClient.awaitBlockedCall());
			fixture.clock.advance(Duration.ofSeconds(10));
			Future<?> pendingCompletion = executor.submit(() ->
				fixture.scheduler.run(0)
			);

			getWithin(pendingCompletion);
			assertEquals(
				1L,
				fixture.publisher.count(RoomEventType.MOVEMENT_COMPLETED)
			);

			fixture.routeClient.releaseBlockedCall();
			assertStaleStartRejected(pendingStart);

			RoomMovementPlanResponse latest = fixture.service.getSnapshot(
				fixture.roomCode,
				fixture.host
			).movements().getFirst();
			assertEquals(current.movementId(), latest.movementId());
			assertEquals(1L, latest.version());
			assertEquals(MovementStatus.COMPLETED, latest.status());
			assertCoordinate(latest.currentPosition(), 0.0, 0.001);
		} finally {
			fixture.routeClient.releaseBlockedCall();
			shutdown(executor);
		}
	}

	@Test
	void staleOldCompletionTaskCannotCompleteReplacementMovement() {
		Fixture fixture = fixture(true);
		fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));
		RoomMovementPlanResponse replacement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));

		fixture.scheduler.run(0);

		RoomMovementSnapshotResponse snapshot = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		);
		assertEquals(replacement.movementId(), snapshot.movements().getFirst().movementId());
		assertEquals(MovementStatus.MOVING, snapshot.movements().getFirst().status());
		assertEquals(0L, fixture.publisher.count(RoomEventType.MOVEMENT_COMPLETED));
		assertEquals(3, fixture.publisher.events.size());
	}

	@Test
	void cancellationStoresInterpolatedAuthoritativePosition() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));

		RoomMovementPlanResponse cancelled = fixture.service.cancelMovement(
			fixture.roomCode,
			fixture.host,
			cancelRequest(movement, UUID.randomUUID())
		).orElseThrow();

		assertEquals(MovementStatus.CANCELLED, cancelled.status());
		assertCoordinate(cancelled.currentPosition(), 0.0, 0.0005);
		assertEquals(
			List.of(
				RoomEventType.MOVEMENT_STARTED,
				RoomEventType.MOVEMENT_CANCELLED
			),
			fixture.publisher.eventTypes()
		);
		assertEquals(List.of(1L, 2L), fixture.publisher.sequences());
		RoomMovementPlanResponse snapshotMovement = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst();
		assertEquals(MovementStatus.CANCELLED, snapshotMovement.status());
		assertCoordinate(snapshotMovement.currentPosition(), 0.0, 0.0005);
	}

	@Test
	void staleCancellationForOldMovementCannotCancelReplacement() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));
		RoomMovementPlanResponse replacement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
		);

		assertTrue(fixture.service.cancelMovement(
			fixture.roomCode,
			fixture.host,
			cancelRequest(first, UUID.randomUUID())
		).isEmpty());

		RoomMovementPlanResponse current = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst();
		assertEquals(replacement.movementId(), current.movementId());
		assertEquals(MovementStatus.MOVING, current.status());
		assertEquals(1L, fixture.publisher.count(RoomEventType.MOVEMENT_CANCELLED));
		assertEquals(3, fixture.publisher.events.size());
	}

	@Test
	void roomMemberCannotCancelAnotherPlayersMovement() {
		Fixture fixture = fixture(true);
		UserEntity member = user("member", "Member");
		fixture.roomService.joinRoom(fixture.roomCode, member);
		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);

		assertThrows(
			RoomForbiddenException.class,
			() -> fixture.service.cancelMovement(
				fixture.roomCode,
				member,
				cancelRequest(movement, UUID.randomUUID())
			)
		);

		RoomMovementPlanResponse current = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst();
		assertEquals(movement.movementId(), current.movementId());
		assertEquals(MovementStatus.MOVING, current.status());
		assertEquals(1, fixture.publisher.events.size());
	}

	@Test
	void scheduledCompletionHappensExactlyOnce() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(10));

		fixture.scheduler.run(0);
		fixture.scheduler.run(0);

		RoomMovementSnapshotResponse snapshot = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		);
		RoomMovementPlanResponse completed = snapshot.movements().getFirst();
		assertEquals(movement.movementId(), completed.movementId());
		assertEquals(MovementStatus.COMPLETED, completed.status());
		assertCoordinate(completed.currentPosition(), 0.0, 0.001);
		assertEquals(movement.expectedEndAt(), completed.updatedAt());
		assertEquals(1L, fixture.publisher.count(RoomEventType.MOVEMENT_COMPLETED));
		assertEquals(
			List.of(
				RoomEventType.MOVEMENT_STARTED,
				RoomEventType.MOVEMENT_COMPLETED
			),
			fixture.publisher.eventTypes()
		);
		assertEquals(List.of(1L, 2L), fixture.publisher.sequences());
		assertEquals(2L, snapshot.roomSequence());
	}

	@Test
	void snapshotReturnsActiveMovementAndCurrentInterpolatedPosition() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse movement = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(2));

		RoomMovementSnapshotResponse snapshot = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		);

		assertEquals(fixture.roomCode, snapshot.roomCode());
		assertEquals(1L, snapshot.roomSequence());
		assertEquals(fixture.clock.instant(), snapshot.serverTimestamp());
		assertEquals(1, snapshot.movements().size());
		RoomMovementPlanResponse active = snapshot.movements().getFirst();
		assertEquals(movement.movementId(), active.movementId());
		assertEquals(MovementStatus.MOVING, active.status());
		assertCoordinate(active.currentPosition(), 0.0, 0.0002);
	}

	@Test
	void duplicateStartClientCommandIsIdempotent() {
		Fixture fixture = fixture(true);
		UUID clientCommandId = UUID.randomUUID();
		StartRoomMovementRequest request = startRequest(
			0.001,
			10.0,
			clientCommandId,
			0L
		);

		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			request
		);
		RoomMovementPlanResponse duplicate = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			request
		);

		assertEquals(first, duplicate);
		assertEquals(1, fixture.routeClient.calls.size());
		assertEquals(1, fixture.publisher.events.size());
		assertEquals(1, fixture.scheduler.tasks.size());
		assertEquals(1L, fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst().version());
	}

	@Test
	void failedMovementEventPublicationRetriesSameEnvelopeBeforeLaterEvents() {
		Fixture fixture = fixture(true);
		fixture.publisher.failNextAttempts(1);

		fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		fixture.clock.advance(Duration.ofSeconds(5));
		fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
		);

		assertEquals(
			List.of(
				RoomEventType.MOVEMENT_STARTED,
				RoomEventType.MOVEMENT_STARTED,
				RoomEventType.MOVEMENT_CANCELLED,
				RoomEventType.MOVEMENT_STARTED
			),
			fixture.publisher.attemptedEventTypes()
		);
		assertEquals(
			List.of(1L, 1L, 2L, 3L),
			fixture.publisher.attemptedSequences()
		);
		RoomEventEnvelope<RoomMovementPlanResponse> failedAttempt =
			fixture.publisher.attempts.get(0);
		RoomEventEnvelope<RoomMovementPlanResponse> retryAttempt =
			fixture.publisher.attempts.get(1);
		assertEquals(failedAttempt.eventId(), retryAttempt.eventId());
		assertEquals(
			failedAttempt.roomSequence(),
			retryAttempt.roomSequence()
		);
		assertEquals(failedAttempt, retryAttempt);
		assertEquals(
			List.of(
				RoomEventType.MOVEMENT_STARTED,
				RoomEventType.MOVEMENT_CANCELLED,
				RoomEventType.MOVEMENT_STARTED
			),
			fixture.publisher.eventTypes()
		);
		assertEquals(List.of(1L, 2L, 3L), fixture.publisher.sequences());
	}

	@Test
	void reusedStartCommandIdWithDifferentPayloadIsRejected() {
		Fixture fixture = fixture(true);
		UUID clientCommandId = UUID.randomUUID();
		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, clientCommandId, 0L)
		);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.002, 20.0, clientCommandId, 1L)
			)
		);

		assertEquals("IDEMPOTENCY_KEY_REUSED", exception.getErrorCode());
		assertEquals(HttpStatus.CONFLICT, exception.getStatus());
		assertEquals(1, fixture.routeClient.calls.size());
		RoomMovementPlanResponse current = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst();
		assertEquals(first.movementId(), current.movementId());
		assertEquals(1L, current.version());
		assertEquals(MovementStatus.MOVING, current.status());
	}

	@Test
	void reusedCancelCommandIdWithDifferentPayloadIsRejected() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);
		UUID cancelCommandId = UUID.randomUUID();
		assertTrue(fixture.service.cancelMovement(
			fixture.roomCode,
			fixture.host,
			cancelRequest(first, cancelCommandId)
		).isPresent());
		RoomMovementPlanResponse second = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.002, 10.0, UUID.randomUUID(), 1L)
		);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.cancelMovement(
				fixture.roomCode,
				fixture.host,
				cancelRequest(second, cancelCommandId)
			)
		);

		assertEquals("IDEMPOTENCY_KEY_REUSED", exception.getErrorCode());
		assertEquals(HttpStatus.CONFLICT, exception.getStatus());
		RoomMovementPlanResponse current = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst();
		assertEquals(second.movementId(), current.movementId());
		assertEquals(MovementStatus.MOVING, current.status());
	}

	@Test
	void staleExpectedMovementVersionRejectsNewStartWithoutChangingCurrentPlan() {
		Fixture fixture = fixture(true);
		RoomMovementPlanResponse first = fixture.service.startMovement(
			fixture.roomCode,
			fixture.host,
			startRequest(0.001, 10.0, UUID.randomUUID(), 0L)
		);

		MovementRejectedException exception = assertThrows(
			MovementRejectedException.class,
			() -> fixture.service.startMovement(
				fixture.roomCode,
				fixture.host,
				startRequest(0.002, 10.0, UUID.randomUUID(), 0L)
			)
		);

		assertEquals("STALE_MOVEMENT_COMMAND", exception.getErrorCode());
		RoomMovementPlanResponse current = fixture.service.getSnapshot(
			fixture.roomCode,
			fixture.host
		).movements().getFirst();
		assertEquals(first.movementId(), current.movementId());
		assertEquals(1L, current.version());
		assertEquals(MovementStatus.MOVING, current.status());
		assertEquals(1, fixture.routeClient.calls.size());
		assertEquals(1, fixture.publisher.events.size());
		assertEquals(1, fixture.scheduler.tasks.size());
	}

	private Fixture fixture(boolean allowPlayerSpeedControl) {
		return fixture(allowPlayerSpeedControl, true);
	}

	private Fixture fixture(
		boolean allowPlayerSpeedControl,
		boolean startGame
	) {
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		PresenceService presenceService = new PresenceService();
		UserEntity host = user("host", "Host");
		String roomCode = roomService
			.createRoom(host, new CreateRoomRequest("Movement Room"))
			.getRoomCode();
		roomService.updateSettings(
			roomCode,
			host,
			new UpdateRoomSettingsRequest(
				ROOM_MAX_SPEED_MPS,
				allowPlayerSpeedControl,
				true
			)
		);

		if (startGame) {
			roomService.startGame(roomCode, host, new StartRoomGameRequest(600));
		}
		String socketSessionId = "socket-" + host.getUserId();
		presenceService.registerSocketSession(socketSessionId);
		presenceService.updatePresence(
			roomCode,
			host,
			new PresenceUpdateRequest(0.0, 0.0, "IDLE"),
			socketSessionId
		);

		RoomCreatureService creatureService = new RoomCreatureService(
			roomService,
			new RoomScoreService(roomService),
			new CreatureCatalogService(null),
			null,
			(room, event) -> {}
		);
		FakeMovementRouteClient routeClient = new FakeMovementRouteClient();
		RecordingMovementEventPublisher publisher =
			new RecordingMovementEventPublisher();
		ManualCompletionScheduler scheduler = new ManualCompletionScheduler();
		MutableClock clock = new MutableClock(START_TIME);
		InMemoryRoomMovementService service = new InMemoryRoomMovementService(
			roomService,
			presenceService,
			creatureService,
			routeClient,
			new InMemoryRoomEventSequencer(),
			publisher,
			scheduler,
			clock,
			new MovementCoordinate(28.550584, 77.268858)
		);

		return new Fixture(
			roomCode,
			host,
			roomService,
			presenceService,
			service,
			routeClient,
			publisher,
			scheduler,
			clock
		);
	}

	private StartRoomMovementRequest startRequest(
		double destinationLongitude,
		double requestedSpeedMps,
		UUID clientCommandId,
		Long expectedMovementVersion
	) {
		return new StartRoomMovementRequest(
			0.0,
			destinationLongitude,
			requestedSpeedMps,
			MovementDestinationType.MAP,
			null,
			clientCommandId,
			expectedMovementVersion
		);
	}

	private CancelRoomMovementRequest cancelRequest(
		RoomMovementPlanResponse movement,
		UUID clientCommandId
	) {
		return new CancelRoomMovementRequest(
			movement.movementId(),
			movement.version(),
			clientCommandId
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

	private void updatePresence(
		Fixture fixture,
		double latitude,
		double longitude
	) {
		String socketSessionId = "replacement-" + UUID.randomUUID();
		fixture.presenceService.registerSocketSession(socketSessionId);
		fixture.presenceService.updatePresence(
			fixture.roomCode,
			fixture.host,
			new PresenceUpdateRequest(latitude, longitude, "IDLE"),
			socketSessionId
		);
	}

	private static <T> T getWithin(Future<T> future) throws Exception {
		return future.get(2L, TimeUnit.SECONDS);
	}

	private static void assertStaleStartRejected(
		Future<RoomMovementPlanResponse> pendingStart
	) {
		ExecutionException exception = assertThrows(
			ExecutionException.class,
			() -> pendingStart.get(2L, TimeUnit.SECONDS)
		);
		assertInstanceOf(MovementRejectedException.class, exception.getCause());
	}

	private static void shutdown(ExecutorService executor) throws Exception {
		executor.shutdownNow();
		assertTrue(executor.awaitTermination(2L, TimeUnit.SECONDS));
	}

	private static void assertCoordinate(
		MovementCoordinate coordinate,
		double expectedLatitude,
		double expectedLongitude
	) {
		assertEquals(
			expectedLatitude,
			coordinate.latitude(),
			COORDINATE_TOLERANCE
		);
		assertEquals(
			expectedLongitude,
			coordinate.longitude(),
			COORDINATE_TOLERANCE
		);
	}

	private record Fixture(
		String roomCode,
		UserEntity host,
		MultiplayerRoomService roomService,
		PresenceService presenceService,
		InMemoryRoomMovementService service,
		FakeMovementRouteClient routeClient,
		RecordingMovementEventPublisher publisher,
		ManualCompletionScheduler scheduler,
		MutableClock clock
	) {
	}

	private record RouteCall(
		MovementCoordinate source,
		MovementCoordinate destination
	) {
	}

	private static class FakeMovementRouteClient
		implements MovementRouteClient {

		private final List<RouteCall> calls = new ArrayList<>();
		private RuntimeException nextFailure;
		private CountDownLatch blockedCallEntered;
		private CountDownLatch blockedCallRelease;
		private boolean blockedCallClaimed;

		@Override
		public MovementRoute fetchRoute(
			MovementCoordinate source,
			MovementCoordinate destination
		) {
			CountDownLatch entered;
			CountDownLatch release;
			RuntimeException failure;

			synchronized (this) {
				calls.add(new RouteCall(source, destination));
				failure = nextFailure;
				nextFailure = null;
				if (blockedCallEntered != null && !blockedCallClaimed) {
					blockedCallClaimed = true;
					entered = blockedCallEntered;
					release = blockedCallRelease;
				} else {
					entered = null;
					release = null;
				}
			}

			if (failure != null) {
				throw failure;
			}

			if (entered != null) {
				entered.countDown();

				try {
					release.await();
				} catch (InterruptedException exception) {
					Thread.currentThread().interrupt();
					throw new IllegalStateException(
						"Blocked route lookup was interrupted",
						exception
					);
				}
			}

			return new MovementRoute(
				encodePolyline6(source, destination),
				ROUTE_DISTANCE_METERS,
				10.0
			);
		}

		synchronized void failNext(RuntimeException failure) {
			nextFailure = failure;
		}

		synchronized void blockNextCall() {
			blockedCallEntered = new CountDownLatch(1);
			blockedCallRelease = new CountDownLatch(1);
			blockedCallClaimed = false;
		}

		boolean awaitBlockedCall() throws InterruptedException {
			CountDownLatch entered;

			synchronized (this) {
				entered = blockedCallEntered;
			}

			return entered != null && entered.await(2L, TimeUnit.SECONDS);
		}

		void releaseBlockedCall() {
			CountDownLatch release;

			synchronized (this) {
				release = blockedCallRelease;
			}

			if (release != null) {
				release.countDown();
			}
		}
	}

	private static class ManualCompletionScheduler
		implements MovementCompletionScheduler {

		private final List<ScheduledTask> tasks = new ArrayList<>();

		@Override
		public void schedule(Instant completionTime, Runnable completionTask) {
			tasks.add(new ScheduledTask(completionTime, completionTask));
		}

		void run(int index) {
			tasks.get(index).completionTask().run();
		}
	}

	private record ScheduledTask(
		Instant completionTime,
		Runnable completionTask
	) {
	}

	private static class RecordingMovementEventPublisher
		implements RoomMovementEventPublisher {

		private final List<RoomEventEnvelope<RoomMovementPlanResponse>> attempts =
			new ArrayList<>();
		private final List<RoomEventEnvelope<RoomMovementPlanResponse>> events =
			new ArrayList<>();
		private int failuresRemaining;

		@Override
		public void publish(
			RoomEventEnvelope<RoomMovementPlanResponse> event
		) {
			attempts.add(event);

			if (failuresRemaining > 0) {
				failuresRemaining -= 1;
				throw new IllegalStateException("simulated publication failure");
			}

			events.add(event);
		}

		void failNextAttempts(int count) {
			failuresRemaining = count;
		}

		List<RoomEventType> attemptedEventTypes() {
			return attempts.stream().map(RoomEventEnvelope::eventType).toList();
		}

		List<Long> attemptedSequences() {
			return attempts.stream().map(RoomEventEnvelope::roomSequence).toList();
		}

		List<RoomEventType> eventTypes() {
			return events.stream().map(RoomEventEnvelope::eventType).toList();
		}

		List<Long> sequences() {
			return events.stream().map(RoomEventEnvelope::roomSequence).toList();
		}

		long count(RoomEventType eventType) {
			return events.stream()
				.filter((event) -> event.eventType() == eventType)
				.count();
		}
	}

	private static class MutableClock extends Clock {

		private Instant instant;

		MutableClock(Instant instant) {
			this.instant = instant;
		}

		void advance(Duration duration) {
			instant = instant.plus(duration);
		}

		@Override
		public ZoneId getZone() {
			return ZoneId.of("UTC");
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return instant;
		}
	}

	private static String encodePolyline6(
		MovementCoordinate source,
		MovementCoordinate destination
	) {
		long sourceLatitude = Math.round(source.latitude() * 1_000_000.0);
		long sourceLongitude = Math.round(source.longitude() * 1_000_000.0);
		long destinationLatitude = Math.round(
			destination.latitude() * 1_000_000.0
		);
		long destinationLongitude = Math.round(
			destination.longitude() * 1_000_000.0
		);
		StringBuilder encoded = new StringBuilder();
		encodeValue(encoded, sourceLatitude);
		encodeValue(encoded, sourceLongitude);
		encodeValue(encoded, destinationLatitude - sourceLatitude);
		encodeValue(encoded, destinationLongitude - sourceLongitude);
		return encoded.toString();
	}

	private static void encodeValue(StringBuilder encoded, long value) {
		long shifted = value < 0L ? ~(value << 1) : value << 1;

		while (shifted >= 0x20L) {
			encoded.append((char) ((0x20L | (shifted & 0x1fL)) + 63L));
			shifted >>= 5;
		}

		encoded.append((char) (shifted + 63L));
	}
}
