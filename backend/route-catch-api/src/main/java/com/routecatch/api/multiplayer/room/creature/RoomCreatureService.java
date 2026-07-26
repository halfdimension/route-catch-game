package com.routecatch.api.multiplayer.room.creature;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.dto.RouteRequest;
import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.multiplayer.room.exception.RoomForbiddenException;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;
import com.routecatch.api.multiplayer.room.round.RoomRoundCoordinator;
import com.routecatch.api.multiplayer.room.round.RoundLifecycleException;
import org.springframework.http.HttpStatus;
import com.routecatch.api.service.OsrmRoutingService;

@Service
public class RoomCreatureService implements RoomCreaturePopulationStore {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomCreatureService.class
	);
	private static final int ROOM_LOCK_COUNT = 64;
	private static final int MANUAL_PLACEMENT_ATTEMPTS_PER_CREATURE = 6;
	private static final double CATCH_RADIUS_METERS = 75.0;

	private final MultiplayerRoomService roomService;
	private final RoomScoreService scoreService;
	private final CreatureCatalogService creatureCatalogService;
	private final OsrmRoutingService routingService;
	private final RoomCreatureEventPublisher eventPublisher;
	private final RoomCreatureSpawnPolicy spawnPolicy;
	private final RoomCreatureSpawnProperties spawnProperties;
	private final SpawnRandomSource random;
	private final Clock clock;
	private final RoomRoundCoordinator roundCoordinator;
	private final Map<String, List<RoomCreatureInstance>> creaturesByRoom =
		new ConcurrentHashMap<>();
	private final Object[] roomLocks = createLocks(ROOM_LOCK_COUNT);

	@Autowired
	public RoomCreatureService(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		CreatureCatalogService creatureCatalogService,
		OsrmRoutingService routingService,
		RoomCreatureEventPublisher eventPublisher,
		RoomCreatureSpawnPolicy spawnPolicy,
		RoomCreatureSpawnProperties spawnProperties,
		SpawnRandomSource random
	) {
		this(
			roomService,
			scoreService,
			creatureCatalogService,
			routingService,
			eventPublisher,
			spawnPolicy,
			spawnProperties,
			random,
			Clock.systemUTC()
		);
	}

	RoomCreatureService(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		CreatureCatalogService creatureCatalogService,
		Clock clock
	) {
		this(
			roomService,
			scoreService,
			creatureCatalogService,
			null,
			(roomCode, event) -> {},
			new RoomCreatureSpawnPolicy(),
			defaultProperties(),
			new SecureSpawnRandomSource(),
			clock
		);
	}

	public RoomCreatureService(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		CreatureCatalogService creatureCatalogService,
		OsrmRoutingService routingService,
		RoomCreatureEventPublisher eventPublisher
	) {
		this(
			roomService,
			scoreService,
			creatureCatalogService,
			routingService,
			eventPublisher,
			Clock.systemUTC()
		);
	}

	RoomCreatureService(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		CreatureCatalogService creatureCatalogService,
		OsrmRoutingService routingService,
		RoomCreatureEventPublisher eventPublisher,
		Clock clock
	) {
		this(
			roomService,
			scoreService,
			creatureCatalogService,
			routingService,
			eventPublisher,
			new RoomCreatureSpawnPolicy(),
			defaultProperties(),
			new SecureSpawnRandomSource(),
			clock
		);
	}

	RoomCreatureService(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		CreatureCatalogService creatureCatalogService,
		OsrmRoutingService routingService,
		RoomCreatureEventPublisher eventPublisher,
		RoomCreatureSpawnPolicy spawnPolicy,
		RoomCreatureSpawnProperties spawnProperties,
		SpawnRandomSource random,
		Clock clock
	) {
		this.roomService = roomService;
		this.scoreService = scoreService;
		this.creatureCatalogService = creatureCatalogService;
		this.routingService = routingService;
		this.eventPublisher = eventPublisher;
		this.spawnPolicy = spawnPolicy;
		this.spawnProperties = spawnProperties;
		this.random = random;
		this.clock = clock;
		this.roundCoordinator = roomService.getRoundCoordinator();
	}

	/**
	 * Host-only manual/development override. Normal room population is maintained
	 * by {@link RoomCreatureSpawnCoordinator}.
	 */
	public List<RoomCreatureInstance> spawnCreatures(
		String roomCode,
		UserEntity currentUser,
		SpawnRoomCreaturesRequest request
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		requireHost(room, currentUser);
		requireGameRunning(room);
		requireManualCreatureSpawnAllowed(room);

		String normalizedRoomCode = room.getRoomCode();
		long generation = room.getGameState().getGeneration();
		List<CreatureDefinition> catalog = requiredCatalog();
		List<RoomCreatureInstance> spawned = new ArrayList<>();
		int attemptLimit = Math.max(
			request.count(),
			request.count() * MANUAL_PLACEMENT_ATTEMPTS_PER_CREATURE
		);

		for (
			int attempts = 0;
			spawned.size() < request.count() && attempts < attemptLimit;
			attempts += 1
		) {
			GeoPoint candidate = spawnPolicy.generateCandidate(
				new GeoPoint(request.centerLat(), request.centerLon()),
				0.0,
				request.radiusMeters(),
				random
			);

			if (!hasCandidateRoute(request, candidate)) {
				continue;
			}

			Optional<RoomCreatureInstance> created =
				createForCurrentRound(
					normalizedRoomCode,
					generation,
					candidate,
					Duration.ofSeconds(request.ttlSeconds()),
					currentUser.getUserId().toString(),
					catalog
				);
			created.ifPresent(spawned::add);

			if (created.isEmpty() && activeCount(normalizedRoomCode)
				>= spawnProperties.maxActiveCount()) {
				break;
			}
		}

		return List.copyOf(spawned);
	}

	public List<RoomCreatureInstance> listCreatures(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		return activeCreatures(room.getRoomCode());
	}

	public RoomCreatureMovementTarget resolveActiveMovementTarget(
		String roomCode,
		UUID instanceId,
		UserEntity currentUser
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		String normalizedRoomCode = room.getRoomCode();

		synchronized (roomLock(normalizedRoomCode)) {
			Instant now = Instant.now(clock);
			RoomCreatureInstance creature = findCreature(
				normalizedRoomCode,
				instanceId
			);

			if (creature.isExpired(now)) {
				expireCreature(normalizedRoomCode, creature, now);
				throw new RoomCreatureExpiredException(instanceId);
			}
			if (creature.isCaught()) {
				throw new RoomCreatureAlreadyCaughtException(instanceId);
			}

			return new RoomCreatureMovementTarget(
				creature.getInstanceId(),
				creature.getLatitude(),
				creature.getLongitude()
			);
		}
	}

	public CatchRoomCreatureResponse catchCreature(
		String roomCode,
		UUID instanceId,
		UserEntity currentUser,
		CatchRoomCreatureRequest request
	) {
		return roundCoordinator.withRoom(roomCode, () -> {
			MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
			requireGameRunning(room);
			requireRoundParticipant(room, currentUser);
			String normalizedRoomCode = room.getRoomCode();
			Instant now = Instant.now(clock);

			synchronized (roomLock(normalizedRoomCode)) {
				RoomCreatureInstance creature = findCreature(
					normalizedRoomCode,
					instanceId
				);
				LOGGER.info(
					"catch attempt roomCode={} creatureId={} playerId={} playerLat={} playerLon={}",
					normalizedRoomCode,
					instanceId,
					currentUser.getUserId(),
					request.playerLat(),
					request.playerLon()
				);

				if (creature.isExpired(now)) {
					expireCreature(normalizedRoomCode, creature, now);
					throw new RoomCreatureExpiredException(instanceId);
				}
				if (creature.isCaught()) {
					throw new RoomCreatureAlreadyCaughtException(instanceId);
				}

				double distanceMeters = spawnPolicy.distanceMeters(
					new GeoPoint(request.playerLat(), request.playerLon()),
					new GeoPoint(creature.getLatitude(), creature.getLongitude())
				);
				if (distanceMeters > CATCH_RADIUS_METERS) {
					throw new RoomCreatureTooFarException(
						instanceId,
						distanceMeters,
						CATCH_RADIUS_METERS
					);
				}

				creature.markCaught(
					currentUser.getUserId(),
					currentUser.getDisplayName(),
					now
				);
				scoreService.recordCatch(room, currentUser, creature);
				publishEvent(
					RoomCreatureEventType.CAUGHT,
					normalizedRoomCode,
					currentUser.getUserId().toString(),
					creature,
					now
				);
				return CatchRoomCreatureResponse.from(creature, distanceMeters);
			}
		});
	}

	@Override
	public List<RoomCreatureInstance> activeCreatures(String roomCode) {
		String normalizedRoomCode = normalizeRoomCode(roomCode);
		return roundCoordinator.withRoom(
			normalizedRoomCode,
			() -> activeCreaturesCoordinated(normalizedRoomCode)
		);
	}

	private List<RoomCreatureInstance> activeCreaturesCoordinated(
		String normalizedRoomCode
	) {
		synchronized (roomLock(normalizedRoomCode)) {
			expireRoomCreatures(normalizedRoomCode, Instant.now(clock));
			return creaturesByRoom.getOrDefault(
				normalizedRoomCode,
				List.of()
			).stream()
				.filter((creature) ->
					creature.getStatus() == RoomCreatureStatus.ACTIVE
				)
				.sorted(Comparator.comparing(RoomCreatureInstance::getSpawnedAt))
				.toList();
		}
	}

	public int activeCount(String roomCode) {
		return activeCreatures(roomCode).size();
	}

	@Override
	public Optional<RoomCreatureInstance> createAutomaticCreature(
		String roomCode,
		long generation,
		GeoPoint snappedPoint,
		String anchorPlayerId
	) {
		return createForCurrentRound(
			normalizeRoomCode(roomCode),
			generation,
			snappedPoint,
			spawnProperties.creatureTtl(),
			"system",
			requiredCatalog()
		);
	}

	@Override
	public void clearRoom(String roomCode) {
		String normalizedRoomCode = normalizeRoomCode(roomCode);

		synchronized (roomLock(normalizedRoomCode)) {
			creaturesByRoom.remove(normalizedRoomCode);
		}
	}

	public void clearExpiredCreatures(String roomCode) {
		String normalizedRoomCode = normalizeRoomCode(roomCode);

		synchronized (roomLock(normalizedRoomCode)) {
			expireRoomCreatures(normalizedRoomCode, Instant.now(clock));
		}
	}

	@Scheduled(fixedDelay = 1000L)
	public void expireDueCreatures() {
		expireDueCreaturesNow();
	}

	public void expireDueCreaturesNow() {
		for (String roomCode : List.copyOf(creaturesByRoom.keySet())) {
			roundCoordinator.withRoom(
				roomCode,
				() -> clearExpiredCreatures(roomCode)
			);
		}
	}

	public int freezeRound(String roomCode, long expectedGeneration) {
		String normalizedRoomCode = normalizeRoomCode(roomCode);
		MultiplayerRoom room = roomService.getRoom(normalizedRoomCode);

		if (
			room.getGameState().getGeneration() != expectedGeneration ||
			room.getGameState().getStatus() != RoomGameStatus.FINALIZING
		) {
			return 0;
		}

		synchronized (roomLock(normalizedRoomCode)) {
			int activeCount = (int) creaturesByRoom
				.getOrDefault(normalizedRoomCode, List.of())
				.stream()
				.filter(creature ->
					creature.getStatus() == RoomCreatureStatus.ACTIVE
				)
				.count();
			creaturesByRoom.remove(normalizedRoomCode);
			return activeCount;
		}
	}

	private Optional<RoomCreatureInstance> createForCurrentRound(
		String normalizedRoomCode,
		long generation,
		GeoPoint coordinate,
		Duration ttl,
		String actorId,
		List<CreatureDefinition> catalog
	) {
		if (coordinate == null || !coordinate.isValid()) {
			return Optional.empty();
		}

		return roomService.withCurrentRoundRunning(
			normalizedRoomCode,
			generation,
			() -> addCreatureIfAllowed(
				normalizedRoomCode,
				coordinate,
				ttl,
				actorId,
				catalog
			)
		).flatMap((created) -> created);
	}

	private Optional<RoomCreatureInstance> addCreatureIfAllowed(
		String roomCode,
		GeoPoint coordinate,
		Duration ttl,
		String actorId,
		List<CreatureDefinition> catalog
	) {
		synchronized (roomLock(roomCode)) {
			Instant now = Instant.now(clock);
			expireRoomCreatures(roomCode, now);
			List<RoomCreatureInstance> active = activeCreaturesWithoutExpiry(
				roomCode
			);

			if (
				active.size() >= spawnProperties.maxActiveCount() ||
				!spawnPolicy.isSeparatedFromCreatures(
					coordinate,
					active,
					spawnProperties.minCreatureSeparationMeters()
				) ||
				active.stream().anyMatch((creature) ->
					Double.compare(creature.getLatitude(), coordinate.latitude()) == 0
					&& Double.compare(
						creature.getLongitude(),
						coordinate.longitude()
					) == 0
				)
			) {
				return Optional.empty();
			}

			CreatureDefinition definition = catalog.get(
				random.nextInt(catalog.size())
			);
			RoomCreatureInstance creature = new RoomCreatureInstance(
				UUID.randomUUID(),
				roomCode,
				definition.creatureId(),
				definition.creatureName(),
				definition.rarity(),
				definition.scoreValue(),
				coordinate.latitude(),
				coordinate.longitude(),
				now,
				now.plus(ttl)
			);
			creaturesByRoom.computeIfAbsent(
				roomCode,
				(ignored) -> new ArrayList<>()
			).add(creature);
			publishEvent(
				RoomCreatureEventType.CREATED,
				roomCode,
				actorId,
				creature,
				now
			);
			return Optional.of(creature);
		}
	}

	private void expireRoomCreatures(String roomCode, Instant now) {
		List<RoomCreatureInstance> creatures = creaturesByRoom.get(roomCode);

		if (creatures == null) {
			return;
		}

		creatures.forEach((creature) ->
			expireCreature(roomCode, creature, now)
		);
	}

	private void expireCreature(
		String roomCode,
		RoomCreatureInstance creature,
		Instant now
	) {
		if (
			creature.getStatus() != RoomCreatureStatus.ACTIVE ||
			creature.getExpiresAt().isAfter(now)
		) {
			return;
		}

		creature.markExpired();
		publishEvent(
			RoomCreatureEventType.EXPIRED,
			roomCode,
			"system",
			creature,
			now
		);
	}

	private List<RoomCreatureInstance> activeCreaturesWithoutExpiry(
		String roomCode
	) {
		return creaturesByRoom.getOrDefault(roomCode, List.of())
			.stream()
			.filter((creature) ->
				creature.getStatus() == RoomCreatureStatus.ACTIVE
			)
			.toList();
	}

	private RoomCreatureInstance findCreature(
		String roomCode,
		UUID instanceId
	) {
		return creaturesByRoom.getOrDefault(roomCode, List.of())
			.stream()
			.filter((creature) -> creature.getInstanceId().equals(instanceId))
			.findFirst()
			.orElseThrow(() -> new RoomCreatureNotFoundException(instanceId));
	}

	private List<CreatureDefinition> requiredCatalog() {
		List<CreatureDefinition> catalog =
			creatureCatalogService.getAllCreatures();

		if (catalog.isEmpty()) {
			throw new RoomCreatureCatalogEmptyException();
		}

		return catalog;
	}

	private boolean hasCandidateRoute(
		SpawnRoomCreaturesRequest request,
		GeoPoint coordinate
	) {
		if (routingService == null) {
			return true;
		}

		try {
			routingService.fetchRoute(new RouteRequest(
				request.centerLat(),
				request.centerLon(),
				coordinate.latitude(),
				coordinate.longitude()
			));
			return true;
		} catch (RoutingEngineException exception) {
			return !List.of(
				"NoRoute",
				"NoSegment",
				"ROUTE_NOT_FOUND",
				"ROUTE_UNAVAILABLE"
			).contains(exception.getErrorCode());
		}
	}

	private void publishEvent(
		RoomCreatureEventType eventType,
		String roomCode,
		String actorId,
		RoomCreatureInstance creature,
		Instant now
	) {
		eventPublisher.publish(
			roomCode,
			new RoomCreatureEvent(
				eventType,
				roomCode,
				actorId,
				RoomCreatureResponse.from(creature, now)
			)
		);
	}

	private void requireHost(MultiplayerRoom room, UserEntity currentUser) {
		if (!room.isHost(currentUser.getUserId())) {
			throw new RoomForbiddenException(
				"Only the room host can perform this action"
			);
		}
	}

	private void requireGameRunning(MultiplayerRoom room) {
		if (room.getGameState().getStatus() == RoomGameStatus.FINALIZING) {
			throw new RoundLifecycleException(
				"ROUND_FINALIZING",
				"Room round is finalizing",
				HttpStatus.CONFLICT
			);
		}
		if (room.getGameState().getStatus() != RoomGameStatus.RUNNING) {
			throw new RoomGameNotRunningException(room.getRoomCode());
		}
	}

	private void requireRoundParticipant(
		MultiplayerRoom room,
		UserEntity currentUser
	) {
		if (!room.getGameState().hasParticipant(currentUser.getUserId())) {
			throw new RoomForbiddenException(
				"Only players present when the round started can play this round"
			);
		}
	}

	private void requireManualCreatureSpawnAllowed(MultiplayerRoom room) {
		if (!room.getGameplaySettings().isAllowManualCreatureSpawn()) {
			throw new RoomForbiddenException(
				"Manual creature spawning is disabled for this room"
			);
		}
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

	private String normalizeRoomCode(String roomCode) {
		return roomCode.trim().toUpperCase();
	}

	private static RoomCreatureSpawnProperties defaultProperties() {
		return new RoomCreatureSpawnProperties(
			true,
			Duration.ofSeconds(5),
			4,
			2,
			30,
			5,
			150.0,
			1200.0,
			100.0,
			8,
			Duration.ofMinutes(2)
		);
	}
}
