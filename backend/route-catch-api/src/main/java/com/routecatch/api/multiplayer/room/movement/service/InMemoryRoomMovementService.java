package com.routecatch.api.multiplayer.room.movement.service;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.dto.CoordinateDto;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureMovementTarget;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.creature.GeoPoint;
import com.routecatch.api.multiplayer.room.creature.RoomPlayerPositionResolver;
import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventType;
import com.routecatch.api.multiplayer.room.exception.RoomForbiddenException;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.movement.dto.CancelRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementSnapshotResponse;
import com.routecatch.api.multiplayer.room.movement.dto.StartRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.event.RoomMovementEventPublisher;
import com.routecatch.api.multiplayer.room.movement.exception.MovementRejectedException;
import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;
import com.routecatch.api.multiplayer.room.movement.model.MovementStatus;
import com.routecatch.api.multiplayer.room.movement.model.RoomMovementPlan;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRoute;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRouteClient;
import com.routecatch.api.multiplayer.room.movement.routing.Polyline6Codec;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.round.RoomRoundCoordinator;
import com.routecatch.api.multiplayer.service.PresenceService;

@Service
public class InMemoryRoomMovementService
	implements
		RoomMovementService,
		RoomPlayerPositionResolver,
		RoomMovementRoundControl {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		InMemoryRoomMovementService.class
	);
	private static final int ROOM_LOCK_COUNT = 64;

	private final MultiplayerRoomService roomService;
	private final PresenceService presenceService;
	private final RoomCreatureService creatureService;
	private final MovementRouteClient routeClient;
	private final RoomEventSequencer eventSequencer;
	private final RoomMovementEventPublisher eventPublisher;
	private final MovementCompletionScheduler completionScheduler;
	private final Clock clock;
	private final MovementCoordinate initialPosition;
	private final RoomRoundCoordinator roundCoordinator;
	private final Object[] roomLocks = createLocks(ROOM_LOCK_COUNT);
	private final Map<PlayerKey, RoomMovementPlan> latestPlans =
		new ConcurrentHashMap<>();
	private final Map<UUID, RoomMovementPlan> plansById =
		new ConcurrentHashMap<>();
	private final Map<UUID, RoundIdentity> planRounds =
		new ConcurrentHashMap<>();
	private final Map<PlayerKey, Long> movementVersions =
		new ConcurrentHashMap<>();
	private final Map<PlayerKey, MovementCoordinate> authoritativePositions =
		new ConcurrentHashMap<>();
	private final Map<PlayerKey, Object> playerStartLocks =
		new ConcurrentHashMap<>();
	private final Map<PlayerKey, Long> movementStateRevisions =
		new ConcurrentHashMap<>();
	private final Map<CommandKey, ProcessedStartCommand> processedStartCommands =
		new ConcurrentHashMap<>();
	private final Map<CommandKey, ProcessedCancelCommand> processedCancelCommands =
		new ConcurrentHashMap<>();
	private final Map<
		String,
		Deque<RoomEventEnvelope<RoomMovementPlanResponse>>
	> pendingEvents = new ConcurrentHashMap<>();

	@Autowired
	public InMemoryRoomMovementService(
		MultiplayerRoomService roomService,
		PresenceService presenceService,
		RoomCreatureService creatureService,
		MovementRouteClient routeClient,
		RoomEventSequencer eventSequencer,
		RoomMovementEventPublisher eventPublisher,
		MovementCompletionScheduler completionScheduler,
		@Value(
			"${multiplayer.movement.initial-latitude:28.550584664849566}"
		) double initialLatitude,
		@Value(
			"${multiplayer.movement.initial-longitude:77.26885829983426}"
		) double initialLongitude
	) {
		this(
			roomService,
			presenceService,
			creatureService,
			routeClient,
			eventSequencer,
			eventPublisher,
			completionScheduler,
			Clock.systemUTC(),
			new MovementCoordinate(initialLatitude, initialLongitude)
		);
	}

	InMemoryRoomMovementService(
		MultiplayerRoomService roomService,
		PresenceService presenceService,
		RoomCreatureService creatureService,
		MovementRouteClient routeClient,
		RoomEventSequencer eventSequencer,
		RoomMovementEventPublisher eventPublisher,
		MovementCompletionScheduler completionScheduler,
		Clock clock,
		MovementCoordinate initialPosition
	) {
		this.roomService = roomService;
		this.presenceService = presenceService;
		this.creatureService = creatureService;
		this.routeClient = routeClient;
		this.eventSequencer = eventSequencer;
		this.eventPublisher = eventPublisher;
		this.completionScheduler = completionScheduler;
		this.clock = clock;
		this.initialPosition = initialPosition;
		this.roundCoordinator = roomService.getRoundCoordinator();
	}

	@Override
	public RoomMovementPlanResponse startMovement(
		String roomCode,
		UserEntity currentUser,
		StartRoomMovementRequest request
	) {
		MultiplayerRoom initialRoom = roundCoordinator.withRoom(
			roomCode,
			() -> requireRunningRoom(roomCode, currentUser)
		);
		String normalizedRoomCode = initialRoom.getRoomCode();
		PlayerKey playerKey = new PlayerKey(
			normalizedRoomCode,
			currentUser.getUserId()
		);

		synchronized (playerStartLock(playerKey)) {
			StartPreparation preparation = roundCoordinator.withRoom(
				normalizedRoomCode,
				() -> {
					synchronized (roomLock(normalizedRoomCode)) {
						MultiplayerRoom room = requireRunningRoom(
							normalizedRoomCode,
							currentUser
						);
						Instant commandTimestamp = Instant.now(clock);
						settleCurrentPlanIfDue(playerKey, commandTimestamp);
						flushPendingEvents(normalizedRoomCode);

						RoomMovementPlan duplicatePlan = duplicateStartPlan(
							playerKey,
							request
						);

						if (duplicatePlan != null) {
							return StartPreparation.duplicate(
								responseAt(duplicatePlan, commandTimestamp)
							);
						}

						validateStartRequest(request);
						validateExpectedVersion(
							playerKey,
							request.expectedMovementVersion()
						);
						resolveSimulationSpeed(room, request);
						MovementCoordinate source = resolveSourcePosition(
							playerKey,
							commandTimestamp
						);
						ResolvedDestination destination = resolveDestination(
							normalizedRoomCode,
							currentUser,
							request
						);
						return new StartPreparation(
							commandTimestamp,
							source,
							destination,
							movementStateRevisions.getOrDefault(playerKey, 0L),
							room.getGameState().getRoundId(),
							room.getGameState().getGeneration(),
							null
						);
					}
				}
			);

			if (preparation.duplicateResponse() != null) {
				return preparation.duplicateResponse();
			}

			MovementRoute route = routeClient.fetchRoute(
				preparation.source(),
				preparation.destination().coordinate()
			);
			validateRoute(route);

			return roundCoordinator.withRoom(normalizedRoomCode, () -> {
			  synchronized (roomLock(normalizedRoomCode)) {
				MultiplayerRoom currentRoom = requireExpectedRunningRound(
					normalizedRoomCode,
					currentUser,
					preparation.roundId(),
					preparation.generation()
				);
				Instant commitTimestamp = Instant.now(clock);
				settleCurrentPlanIfDue(playerKey, commitTimestamp);

				if (
					movementStateRevisions.getOrDefault(playerKey, 0L)
						!= preparation.stateRevision()
				) {
					throw staleCommandDuringRouting();
				}

				double currentSimulationSpeedMps = resolveSimulationSpeed(
					currentRoom,
					request
				);
				ResolvedDestination currentDestination = resolveDestination(
					normalizedRoomCode,
					currentUser,
					request
				);

				if (!preparation.destination().equals(currentDestination)) {
					throw new MovementRejectedException(
						"MOVEMENT_TARGET_CHANGED",
						"Movement target changed while its route was being calculated",
						HttpStatus.CONFLICT
					);
				}

				RoomMovementPlan previousPlan = latestPlans.get(playerKey);
				boolean replacesActivePlan = previousPlan != null
					&& previousPlan.getStatus() == MovementStatus.MOVING;
				long version = movementVersions.getOrDefault(playerKey, 0L) + 1L;
				Instant expectedEndAt = expectedEndAt(
					preparation.commandTimestamp(),
					route.distanceMeters(),
					currentSimulationSpeedMps
				);
				RoomMovementPlan nextPlan = new RoomMovementPlan(
					UUID.randomUUID(),
					normalizedRoomCode,
					currentUser.getUserId(),
					version,
					route.encodedPolyline6(),
					route.distanceMeters(),
					currentSimulationSpeedMps,
					preparation.commandTimestamp(),
					expectedEndAt,
					preparation.source(),
					currentDestination.coordinate(),
					request.destinationType(),
					currentDestination.targetCreatureInstanceId(),
					preparation.commandTimestamp()
				);

				if (replacesActivePlan) {
					previousPlan.cancel(
						preparation.source(),
						preparation.commandTimestamp()
					);
					authoritativePositions.put(
						playerKey,
						preparation.source()
					);
				}

				movementVersions.put(playerKey, version);
				latestPlans.put(playerKey, nextPlan);
				plansById.put(nextPlan.getMovementId(), nextPlan);
				planRounds.put(
					nextPlan.getMovementId(),
					new RoundIdentity(
						preparation.roundId(),
						preparation.generation()
					)
				);
				processedStartCommands.put(
					new CommandKey(playerKey, request.clientCommandId()),
					new ProcessedStartCommand(request, nextPlan.getMovementId())
				);
				incrementStateRevision(playerKey);

				Instant eventTimestamp = Instant.now(clock);

				if (replacesActivePlan) {
					publishEvent(
						RoomEventType.MOVEMENT_CANCELLED,
						previousPlan,
						eventTimestamp,
						preparation.source()
					);
				}

				RoomMovementPlanResponse response = responseAt(
					nextPlan,
					eventTimestamp
				);
				publishEvent(
					RoomEventType.MOVEMENT_STARTED,
					nextPlan,
					eventTimestamp,
					response.currentPosition()
				);
				scheduleCompletion(
					nextPlan,
					preparation.roundId(),
					preparation.generation()
				);
				return response;
			  }
			});
		}
	}

	@Override
	public Optional<RoomMovementPlanResponse> cancelMovement(
		String roomCode,
		UserEntity currentUser,
		CancelRoomMovementRequest request
	) {
		return roundCoordinator.withRoom(roomCode, () -> {
			MultiplayerRoom room = requireRunningRoom(roomCode, currentUser);
			String normalizedRoomCode = room.getRoomCode();

			synchronized (roomLock(normalizedRoomCode)) {
			requireRunningRoom(normalizedRoomCode, currentUser);
			validateCancelRequest(request);
			PlayerKey playerKey = new PlayerKey(
				normalizedRoomCode,
				currentUser.getUserId()
			);
			CommandKey commandKey = new CommandKey(
				playerKey,
				request.clientCommandId()
			);
			ProcessedCancelCommand processedCommand = processedCancelCommands.get(
				commandKey
			);

			if (processedCommand != null) {
				if (!processedCommand.request().equals(request)) {
					throw idempotencyKeyReused();
				}

				flushPendingEvents(normalizedRoomCode);
				return processedCommand.response();
			}

			RoomMovementPlan requestedPlan = plansById.get(request.movementId());

			if (
				requestedPlan != null &&
				!requestedPlan.getPlayerId().equals(currentUser.getUserId())
			) {
				throw new RoomForbiddenException(
					"Players can only cancel their own movement"
				);
			}

			Instant now = Instant.now(clock);
			settleCurrentPlanIfDue(playerKey, now);
			RoomMovementPlan currentPlan = latestPlans.get(playerKey);

			if (
				currentPlan == null ||
				currentPlan.getStatus() != MovementStatus.MOVING ||
				!currentPlan.getMovementId().equals(request.movementId()) ||
				currentPlan.getVersion() != request.movementVersion()
			) {
				processedCancelCommands.put(
					commandKey,
					new ProcessedCancelCommand(request, Optional.empty())
				);
				flushPendingEvents(normalizedRoomCode);
				return Optional.empty();
			}

			MovementCoordinate currentPosition = positionAt(currentPlan, now);
			currentPlan.cancel(currentPosition, now);
			authoritativePositions.put(playerKey, currentPosition);
			RoomMovementPlanResponse response = RoomMovementPlanResponse.from(
				currentPlan,
				currentPosition
			);
			processedCancelCommands.put(
				commandKey,
				new ProcessedCancelCommand(request, Optional.of(response))
			);
			incrementStateRevision(playerKey);
			publishEvent(
				RoomEventType.MOVEMENT_CANCELLED,
				currentPlan,
				now,
				currentPosition
			);
			return Optional.of(response);
			}
		});
	}

	@Override
	public RoomMovementSnapshotResponse getSnapshot(
		String roomCode,
		UserEntity currentUser
	) {
		return roundCoordinator.withRoom(roomCode, () -> {
			MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
			String normalizedRoomCode = room.getRoomCode();

			synchronized (roomLock(normalizedRoomCode)) {
				roomService.getGameState(normalizedRoomCode, currentUser);
				Instant now = Instant.now(clock);
				settleDuePlansInRoom(normalizedRoomCode, now);
				flushPendingEvents(normalizedRoomCode);
				List<RoomMovementPlanResponse> movements = latestPlans
					.entrySet()
					.stream()
					.filter((entry) ->
						entry.getKey().roomCode().equals(normalizedRoomCode)
					)
					.map(Map.Entry::getValue)
					.sorted(Comparator.comparing((plan) ->
						plan.getPlayerId().toString()
					))
					.map((plan) -> responseAt(plan, now))
					.toList();

				return new RoomMovementSnapshotResponse(
					normalizedRoomCode,
					eventSequencer.current(normalizedRoomCode),
					now,
					movements
				);
			}
		});
	}

	@Override
	public Optional<GeoPoint> resolveAuthoritativePosition(
		String roomCode,
		UUID playerId,
		Instant now
	) {
		if (
			roomCode == null ||
			roomCode.isBlank() ||
			playerId == null ||
			now == null
		) {
			return Optional.empty();
		}

		String normalizedRoomCode = roomCode.trim().toUpperCase();
		PlayerKey playerKey = new PlayerKey(normalizedRoomCode, playerId);

		return roundCoordinator.withRoom(normalizedRoomCode, () -> {
			synchronized (roomLock(normalizedRoomCode)) {
				settleCurrentPlanIfDue(playerKey, now);
				RoomMovementPlan plan = latestPlans.get(playerKey);

				if (plan != null && plan.getStatus() == MovementStatus.MOVING) {
					MovementCoordinate position = positionAt(plan, now);
					return Optional.of(
						new GeoPoint(position.latitude(), position.longitude())
					);
				}

				MovementCoordinate storedPosition =
					authoritativePositions.get(playerKey);

				if (storedPosition != null) {
					return Optional.of(new GeoPoint(
						storedPosition.latitude(),
						storedPosition.longitude()
					));
				}

				return presenceService.findValidPlayerPosition(
					normalizedRoomCode,
					playerId
				).map((position) ->
					new GeoPoint(position.lat(), position.lon())
				);
			}
		});
	}

	@Scheduled(fixedDelay = 1000L)
	public void completeDueMovements() {
		Set<String> roomCodes = latestPlans
			.keySet()
			.stream()
			.map(PlayerKey::roomCode)
			.collect(java.util.stream.Collectors.toCollection(HashSet::new));
		roomCodes.addAll(pendingEvents.keySet());

		for (String roomCode : roomCodes) {
			roundCoordinator.withRoom(roomCode, () -> {
				synchronized (roomLock(roomCode)) {
					settleDuePlansInRoom(roomCode, Instant.now(clock));
					flushPendingEvents(roomCode);
				}
			});
		}
	}

	@Override
	public int freezeRound(
		String roomCode,
		UUID expectedRoundId,
		long expectedGeneration,
		Instant frozenAt
	) {
		String normalizedRoomCode = roomCode.trim().toUpperCase();
		return roundCoordinator.withRoom(normalizedRoomCode, () -> {
			synchronized (roomLock(normalizedRoomCode)) {
				MultiplayerRoom room = roomService.getRoom(normalizedRoomCode);

				if (
					room.getGameState().getStatus() != RoomGameStatus.FINALIZING ||
					room.getGameState().getGeneration() != expectedGeneration ||
					!expectedRoundId.equals(room.getGameState().getRoundId())
				) {
					return 0;
				}

				int frozenCount = 0;

				for (
					Map.Entry<PlayerKey, RoomMovementPlan> entry
						: latestPlans.entrySet()
				) {
					PlayerKey playerKey = entry.getKey();
					RoomMovementPlan plan = entry.getValue();
					RoundIdentity identity = planRounds.get(plan.getMovementId());

					if (
						!playerKey.roomCode().equals(normalizedRoomCode) ||
						plan.getStatus() != MovementStatus.MOVING ||
						identity == null ||
						identity.generation() != expectedGeneration ||
						!identity.roundId().equals(expectedRoundId)
					) {
						continue;
					}

					MovementCoordinate position = positionAt(plan, frozenAt);
					plan.cancel(position, frozenAt);
					authoritativePositions.put(playerKey, position);
					incrementStateRevision(playerKey);
					publishEvent(
						RoomEventType.MOVEMENT_CANCELLED,
						plan,
						frozenAt,
						position
					);
					frozenCount += 1;
				}

				return frozenCount;
			}
		});
	}

	private MultiplayerRoom requireRunningRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);

		if (room.getGameState().getStatus() == RoomGameStatus.FINALIZING) {
			throw new MovementRejectedException(
				"ROUND_FINALIZING",
				"Room round is finalizing",
				HttpStatus.CONFLICT
			);
		}

		if (room.getGameState().getStatus() != RoomGameStatus.RUNNING) {
			throw new MovementRejectedException(
				"ROOM_GAME_NOT_RUNNING",
				"Room game is not running",
				HttpStatus.CONFLICT
			);
		}

		if (
			!room.getGameState().hasParticipant(currentUser.getUserId())
		) {
			throw new RoomForbiddenException(
				"Only players present when the round started can play this round"
			);
		}

		return room;
	}

	private MultiplayerRoom requireExpectedRunningRound(
		String roomCode,
		UserEntity currentUser,
		UUID expectedRoundId,
		long expectedGeneration
	) {
		MultiplayerRoom room = requireRunningRoom(roomCode, currentUser);

		if (
			room.getGameState().getGeneration() != expectedGeneration ||
			!expectedRoundId.equals(room.getGameState().getRoundId())
		) {
			throw new MovementRejectedException(
				"STALE_ROUND_GENERATION",
				"Movement command belongs to an older room round",
				HttpStatus.CONFLICT
			);
		}

		return room;
	}

	private void validateStartRequest(StartRoomMovementRequest request) {
		if (request == null) {
			throw validationError("Movement start request is required");
		}

		if (request.clientCommandId() == null) {
			throw validationError("clientCommandId is required");
		}

		if (request.destinationType() == null) {
			throw validationError("destinationType is required");
		}

		if (
			request.destinationType() == MovementDestinationType.MAP &&
			!isValidCoordinate(request.destinationLat(), request.destinationLon())
		) {
			throw validationError("Destination coordinates are invalid");
		}

		if (
			request.requestedSpeedMps() == null ||
			!Double.isFinite(request.requestedSpeedMps()) ||
			request.requestedSpeedMps() <= 0.0
		) {
			throw validationError("requestedSpeedMps must be finite and positive");
		}

		if (
			request.expectedMovementVersion() != null &&
			request.expectedMovementVersion() < 0L
		) {
			throw validationError("expectedMovementVersion cannot be negative");
		}

		if (
			request.destinationType() == MovementDestinationType.CREATURE &&
			request.targetCreatureInstanceId() == null
		) {
			throw validationError(
				"targetCreatureInstanceId is required for a creature chase"
			);
		}

		if (
			request.destinationType() == MovementDestinationType.MAP &&
			request.targetCreatureInstanceId() != null
		) {
			throw validationError(
				"targetCreatureInstanceId is only valid for a creature chase"
			);
		}
	}

	private void validateCancelRequest(CancelRoomMovementRequest request) {
		if (
			request == null ||
			request.movementId() == null ||
			request.clientCommandId() == null ||
			request.movementVersion() <= 0L
		) {
			throw validationError("Movement cancellation request is invalid");
		}
	}

	private void validateExpectedVersion(PlayerKey key, Long expectedVersion) {
		if (expectedVersion == null) {
			return;
		}

		long currentVersion = movementVersions.getOrDefault(key, 0L);

		if (expectedVersion != currentVersion) {
			throw new MovementRejectedException(
				"STALE_MOVEMENT_COMMAND",
				"Movement command was based on an older movement version",
				HttpStatus.CONFLICT
			);
		}
	}

	private double resolveSimulationSpeed(
		MultiplayerRoom room,
		StartRoomMovementRequest request
	) {
		double requestedSpeedMps = request.requestedSpeedMps();
		double maxSpeedMps = room.getGameplaySettings().getMaxSpeedMps();

		if (requestedSpeedMps > maxSpeedMps) {
			throw new MovementRejectedException(
				"MOVEMENT_SPEED_EXCEEDS_ROOM_MAX",
				"Requested movement speed exceeds the room maximum"
			);
		}

		if (!room.getGameplaySettings().isAllowPlayerSpeedControl()) {
			return maxSpeedMps;
		}

		return requestedSpeedMps;
	}

	private ResolvedDestination resolveDestination(
		String roomCode,
		UserEntity currentUser,
		StartRoomMovementRequest request
	) {
		if (request.destinationType() == MovementDestinationType.MAP) {
			return new ResolvedDestination(
				new MovementCoordinate(
					request.destinationLat(),
					request.destinationLon()
				),
				null
			);
		}

		RoomCreatureMovementTarget target =
			creatureService.resolveActiveMovementTarget(
				roomCode,
				request.targetCreatureInstanceId(),
				currentUser
			);

		return new ResolvedDestination(
			new MovementCoordinate(target.latitude(), target.longitude()),
			target.instanceId()
		);
	}

	private MovementCoordinate resolveSourcePosition(
		PlayerKey playerKey,
		Instant timestamp
	) {
		RoomMovementPlan latestPlan = latestPlans.get(playerKey);

		if (
			latestPlan != null &&
			latestPlan.getStatus() == MovementStatus.MOVING
		) {
			return positionAt(latestPlan, timestamp);
		}

		MovementCoordinate storedPosition = authoritativePositions.get(playerKey);

		if (storedPosition != null) {
			return storedPosition;
		}

		Optional<CoordinateDto> presencePosition =
			presenceService.findValidPlayerPosition(
				playerKey.roomCode(),
				playerKey.playerId()
			);

		if (presencePosition.isPresent()) {
			CoordinateDto coordinate = presencePosition.get();
			return new MovementCoordinate(coordinate.lat(), coordinate.lon());
		}

		return initialPosition;
	}

	private RoomMovementPlan duplicateStartPlan(
		PlayerKey playerKey,
		StartRoomMovementRequest request
	) {
		if (request == null || request.clientCommandId() == null) {
			return null;
		}

		ProcessedStartCommand processedCommand = processedStartCommands.get(
			new CommandKey(playerKey, request.clientCommandId())
		);

		if (processedCommand == null) {
			return null;
		}

		if (!processedCommand.request().equals(request)) {
			throw idempotencyKeyReused();
		}

		return plansById.get(processedCommand.movementId());
	}

	private void validateRoute(MovementRoute route) {
		if (
			route == null ||
			route.encodedPolyline6() == null ||
			route.encodedPolyline6().isBlank() ||
			!Double.isFinite(route.distanceMeters()) ||
			route.distanceMeters() < 0.0 ||
			!Double.isFinite(route.durationSeconds()) ||
			route.durationSeconds() < 0.0
		) {
			throw new MovementRejectedException(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				"Routing engine returned an invalid movement route"
			);
		}

		try {
			List<MovementCoordinate> coordinates = Polyline6Codec.decode(
				route.encodedPolyline6()
			);

			if (coordinates.isEmpty()) {
				throw new IllegalArgumentException("Route geometry was empty");
			}

			return;
		} catch (IllegalArgumentException exception) {
			throw new MovementRejectedException(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				"Routing engine returned invalid movement route geometry"
			);
		}
	}

	private Instant expectedEndAt(
		Instant startedAt,
		double distanceMeters,
		double speedMetersPerSecond
	) {
		double durationNanos = distanceMeters
			/ speedMetersPerSecond
			* 1_000_000_000.0;

		if (!Double.isFinite(durationNanos) || durationNanos > Long.MAX_VALUE) {
			throw validationError("Movement duration is too large");
		}

		long roundedDurationNanos = (long) Math.ceil(durationNanos);

		try {
			return startedAt.plusNanos(roundedDurationNanos);
		} catch (DateTimeException | ArithmeticException exception) {
			throw validationError("Movement completion time is out of range");
		}
	}

	private MovementCoordinate positionAt(
		RoomMovementPlan plan,
		Instant timestamp
	) {
		if (
			plan.getStatus() != MovementStatus.MOVING &&
			plan.getSettledPosition() != null
		) {
			return plan.getSettledPosition();
		}

		if (!timestamp.isBefore(plan.getExpectedEndAt())) {
			return Polyline6Codec.interpolate(plan.getEncodedPolyline6(), 1.0);
		}

		Duration elapsed = Duration.between(plan.getStartedAt(), timestamp);
		double elapsedSeconds = elapsed.getSeconds()
			+ elapsed.getNano() / 1_000_000_000.0;
		double routeFraction = plan.getTotalDistanceMeters() == 0.0
			? 1.0
			: elapsedSeconds
				* plan.getSimulationSpeedMps()
				/ plan.getTotalDistanceMeters();

		return Polyline6Codec.interpolate(
			plan.getEncodedPolyline6(),
			Math.max(0.0, Math.min(1.0, routeFraction))
		);
	}

	private RoomMovementPlanResponse responseAt(
		RoomMovementPlan plan,
		Instant timestamp
	) {
		return RoomMovementPlanResponse.from(plan, positionAt(plan, timestamp));
	}

	private void scheduleCompletion(
		RoomMovementPlan plan,
		UUID roundId,
		long generation
	) {
		try {
			completionScheduler.schedule(
				plan.getExpectedEndAt(),
				() -> completeScheduledMovement(
					plan.getRoomCode(),
					plan.getPlayerId(),
					plan.getMovementId(),
					plan.getVersion(),
					roundId,
					generation
				)
			);
		} catch (RuntimeException exception) {
					LOGGER.error(
				"movement completion scheduling failed roomCode={} playerId={} movementId={} version={}",
				plan.getRoomCode(),
				plan.getPlayerId(),
				plan.getMovementId(),
				plan.getVersion(),
				exception
					);
		}
	}

	private void completeScheduledMovement(
		String roomCode,
		UUID playerId,
		UUID movementId,
		long version,
		UUID roundId,
		long generation
	) {
		roundCoordinator.withRoom(roomCode, () -> {
		  synchronized (roomLock(roomCode)) {
			MultiplayerRoom room = roomService.getRoom(roomCode);

			if (
				room.getGameState().getStatus() != RoomGameStatus.RUNNING ||
				room.getGameState().getGeneration() != generation ||
				!roundId.equals(room.getGameState().getRoundId())
			) {
				return;
			}

			PlayerKey playerKey = new PlayerKey(roomCode, playerId);
			RoomMovementPlan currentPlan = latestPlans.get(playerKey);

			if (
				currentPlan == null ||
				currentPlan.getStatus() != MovementStatus.MOVING ||
				!currentPlan.getMovementId().equals(movementId) ||
				currentPlan.getVersion() != version
			) {
				return;
			}

			Instant now = Instant.now(clock);

			if (now.isBefore(currentPlan.getExpectedEndAt())) {
				scheduleCompletion(currentPlan, roundId, generation);
				return;
			}

			completePlan(playerKey, currentPlan, now);
		  }
		});
	}

	private void settleCurrentPlanIfDue(PlayerKey playerKey, Instant now) {
		RoomMovementPlan currentPlan = latestPlans.get(playerKey);

		if (
			currentPlan != null &&
			currentPlan.getStatus() == MovementStatus.MOVING &&
			!now.isBefore(currentPlan.getExpectedEndAt())
		) {
			completePlan(playerKey, currentPlan, now);
		}
	}

	private void settleDuePlansInRoom(String roomCode, Instant now) {
		latestPlans
			.entrySet()
			.stream()
			.filter((entry) -> entry.getKey().roomCode().equals(roomCode))
			.forEach((entry) -> settleCurrentPlanIfDue(entry.getKey(), now));
	}

	private void completePlan(
		PlayerKey playerKey,
		RoomMovementPlan plan,
		Instant eventTimestamp
	) {
		RoomMovementPlan currentPlan = latestPlans.get(playerKey);

		if (
			currentPlan != plan ||
			plan.getStatus() != MovementStatus.MOVING
		) {
			return;
		}

		MovementCoordinate finalRoutePosition = Polyline6Codec.interpolate(
			plan.getEncodedPolyline6(),
			1.0
		);
		plan.complete(finalRoutePosition, plan.getExpectedEndAt());
		authoritativePositions.put(playerKey, finalRoutePosition);
		incrementStateRevision(playerKey);
		publishEvent(
			RoomEventType.MOVEMENT_COMPLETED,
			plan,
			eventTimestamp,
			finalRoutePosition
		);
	}

	private void publishEvent(
		RoomEventType eventType,
		RoomMovementPlan plan,
		Instant eventTimestamp,
		MovementCoordinate currentPosition
	) {
		RoomEventEnvelope<RoomMovementPlanResponse> event =
			new RoomEventEnvelope<>(
				UUID.randomUUID(),
				plan.getRoomCode(),
				eventSequencer.next(plan.getRoomCode()),
				eventType,
				eventTimestamp,
				RoomMovementPlanResponse.from(plan, currentPosition)
			);

		pendingEvents
			.computeIfAbsent(plan.getRoomCode(), ignored -> new ArrayDeque<>())
			.addLast(event);
		flushPendingEvents(plan.getRoomCode());
	}

	private void flushPendingEvents(String roomCode) {
		Deque<RoomEventEnvelope<RoomMovementPlanResponse>> events =
			pendingEvents.get(roomCode);

		if (events == null) {
			return;
		}

		while (!events.isEmpty()) {
			RoomEventEnvelope<RoomMovementPlanResponse> event = events.peekFirst();

			try {
				eventPublisher.publish(event);
				events.removeFirst();
			} catch (RuntimeException exception) {
				RoomMovementPlanResponse plan = event.payload();
			LOGGER.error(
				"movement event publication failed roomCode={} playerId={} movementId={} version={} eventType={} roomSequence={}",
				event.roomCode(),
				plan.playerId(),
				plan.movementId(),
				plan.version(),
				event.eventType(),
				event.roomSequence(),
				exception
			);
				return;
			}
		}

		pendingEvents.remove(roomCode, events);
	}

	private void incrementStateRevision(PlayerKey playerKey) {
		movementStateRevisions.merge(playerKey, 1L, Long::sum);
	}

	private Object playerStartLock(PlayerKey playerKey) {
		return playerStartLocks.computeIfAbsent(playerKey, ignored -> new Object());
	}

	private MovementRejectedException staleCommandDuringRouting() {
		return new MovementRejectedException(
			"STALE_MOVEMENT_COMMAND",
			"Movement state changed while its route was being calculated",
			HttpStatus.CONFLICT
		);
	}

	private MovementRejectedException idempotencyKeyReused() {
		return new MovementRejectedException(
			"IDEMPOTENCY_KEY_REUSED",
			"clientCommandId was already used for different movement intent",
			HttpStatus.CONFLICT
		);
			}

	private boolean isValidCoordinate(Double latitude, Double longitude) {
		return latitude != null
			&& longitude != null
			&& Double.isFinite(latitude)
			&& Double.isFinite(longitude)
			&& latitude >= -90.0
			&& latitude <= 90.0
			&& longitude >= -180.0
			&& longitude <= 180.0;
	}

	private MovementRejectedException validationError(String message) {
		return new MovementRejectedException("INVALID_MOVEMENT_COMMAND", message);
	}

	private Object roomLock(String roomCode) {
		return roomLocks[Math.floorMod(roomCode.hashCode(), roomLocks.length)];
	}

	private Object[] createLocks(int count) {
		Object[] locks = new Object[count];

		for (int index = 0; index < count; index += 1) {
			locks[index] = new Object();
		}

		return locks;
	}

	private record PlayerKey(String roomCode, UUID playerId) {
	}

	private record CommandKey(PlayerKey playerKey, UUID clientCommandId) {
	}

	private record ProcessedStartCommand(
		StartRoomMovementRequest request,
		UUID movementId
	) {
	}

	private record ProcessedCancelCommand(
		CancelRoomMovementRequest request,
		Optional<RoomMovementPlanResponse> response
	) {
	}

	private record StartPreparation(
		Instant commandTimestamp,
		MovementCoordinate source,
		ResolvedDestination destination,
		long stateRevision,
		UUID roundId,
		long generation,
		RoomMovementPlanResponse duplicateResponse
	) {

		private static StartPreparation duplicate(
			RoomMovementPlanResponse response
		) {
			return new StartPreparation(
				null,
				null,
				null,
				0L,
				null,
				0L,
				response
			);
		}
	}

	private record ResolvedDestination(
		MovementCoordinate coordinate,
		UUID targetCreatureInstanceId
	) {
	}

	private record RoundIdentity(UUID roundId, long generation) {
	}
}
