package com.routecatch.api.multiplayer.room.creature;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
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
import com.routecatch.api.service.OsrmRoutingService;

@Service
public class RoomCreatureService {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomCreatureService.class
	);
	private static final int MAX_ACTIVE_UNCAUGHT_CREATURES_PER_ROOM = 50;
	private static final int ROUTE_VALIDATION_ATTEMPTS_PER_CREATURE = 6;
	private static final double METERS_PER_DEGREE_LATITUDE = 111_320.0;
	private static final double CATCH_RADIUS_METERS = 75.0;
	private static final double EARTH_RADIUS_METERS = 6_371_000.0;

	private final MultiplayerRoomService roomService;
	private final RoomScoreService scoreService;
	private final CreatureCatalogService creatureCatalogService;
	private final OsrmRoutingService routingService;
	private final RoomCreatureEventPublisher eventPublisher;
	private final Clock clock;
	private final SecureRandom random = new SecureRandom();
	private final Map<String, List<RoomCreatureInstance>> creaturesByRoom =
		new ConcurrentHashMap<>();

	@Autowired
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
		Clock clock
	) {
		this(
			roomService,
			scoreService,
			creatureCatalogService,
			null,
			(roomCode, event) -> {},
			clock
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
		this.roomService = roomService;
		this.scoreService = scoreService;
		this.creatureCatalogService = creatureCatalogService;
		this.routingService = routingService;
		this.eventPublisher = eventPublisher;
		this.clock = clock;
	}

	public synchronized List<RoomCreatureInstance> spawnCreatures(
		String roomCode,
		UserEntity currentUser,
		SpawnRoomCreaturesRequest request
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		requireHost(room, currentUser);
		requireGameRunning(room);
		requireManualCreatureSpawnAllowed(room);

		String normalizedRoomCode = room.getRoomCode();
		clearExpiredCreatures(normalizedRoomCode);

		List<RoomCreatureInstance> roomCreatures =
			creaturesByRoom.computeIfAbsent(
				normalizedRoomCode,
				(ignored) -> new ArrayList<>()
			);

		int activeCount = activeUncaughtCount(roomCreatures, Instant.now(clock));
		int spawnCount = Math.min(
			request.count(),
			MAX_ACTIVE_UNCAUGHT_CREATURES_PER_ROOM - activeCount
		);

		if (spawnCount <= 0) {
			return List.of();
		}

		List<CreatureDefinition> catalog = creatureCatalogService.getAllCreatures();

		if (catalog.isEmpty()) {
			throw new RoomCreatureCatalogEmptyException();
		}

		Instant spawnedAt = Instant.now(clock);
		Instant expiresAt = spawnedAt.plusSeconds(request.ttlSeconds());
		List<RoomCreatureInstance> spawnedCreatures = new ArrayList<>(spawnCount);
		int maxAttempts = Math.max(
			spawnCount,
			spawnCount * ROUTE_VALIDATION_ATTEMPTS_PER_CREATURE
		);

		for (
			int attempts = 0;
			spawnedCreatures.size() < spawnCount && attempts < maxAttempts;
			attempts += 1
		) {
			CreatureDefinition definition = randomCreature(catalog);
			Coordinate coordinate = randomCoordinate(
				request.centerLat(),
				request.centerLon(),
				request.radiusMeters()
			);

			if (!hasCandidateRoute(request, coordinate)) {
				continue;
			}

			RoomCreatureInstance creature = new RoomCreatureInstance(
				UUID.randomUUID(),
				normalizedRoomCode,
				definition.creatureId(),
				definition.creatureName(),
				definition.rarity(),
				definition.scoreValue(),
				coordinate.latitude(),
				coordinate.longitude(),
				spawnedAt,
				expiresAt
			);

			roomCreatures.add(creature);
			spawnedCreatures.add(creature);
			LOGGER.info(
				"creature created roomCode={} creatureId={} playerId={} catalogCreatureId={} rarity={} expiresAt={}",
				normalizedRoomCode,
				creature.getInstanceId(),
				currentUser.getUserId(),
				creature.getCreatureId(),
				creature.getRarity(),
				creature.getExpiresAt()
			);
			publishEvent(
				RoomCreatureEventType.CREATED,
				normalizedRoomCode,
				currentUser.getUserId().toString(),
				creature,
				spawnedAt
			);
		}

		return spawnedCreatures;
	}

	public synchronized List<RoomCreatureInstance> listCreatures(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		String normalizedRoomCode = room.getRoomCode();
		Instant now = Instant.now(clock);

		clearExpiredCreatures(normalizedRoomCode);

		return creaturesByRoom.getOrDefault(normalizedRoomCode, List.of())
			.stream()
			.filter((creature) -> !creature.isCaught())
			.filter((creature) -> !creature.isExpired(now))
			.sorted(Comparator.comparing(RoomCreatureInstance::getSpawnedAt))
			.toList();
	}

	public synchronized CatchRoomCreatureResponse catchCreature(
		String roomCode,
		UUID instanceId,
		UserEntity currentUser,
		CatchRoomCreatureRequest request
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		requireGameRunning(room);

		String normalizedRoomCode = room.getRoomCode();
		Instant now = Instant.now(clock);
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
			LOGGER.info(
				"catch rejected roomCode={} creatureId={} playerId={} reason=expired",
				normalizedRoomCode,
				instanceId,
				currentUser.getUserId()
			);
			throw new RoomCreatureExpiredException(instanceId);
		}

		if (creature.isCaught()) {
			LOGGER.info(
				"catch rejected roomCode={} creatureId={} playerId={} reason=already_caught",
				normalizedRoomCode,
				instanceId,
				currentUser.getUserId()
			);
			throw new RoomCreatureAlreadyCaughtException(instanceId);
		}

		double distanceMeters = distanceMeters(
			request.playerLat(),
			request.playerLon(),
			creature.getLatitude(),
			creature.getLongitude()
		);

		if (distanceMeters > CATCH_RADIUS_METERS) {
			LOGGER.info(
				"catch rejected roomCode={} creatureId={} playerId={} reason=too_far distanceMeters={} catchRadiusMeters={}",
				normalizedRoomCode,
				instanceId,
				currentUser.getUserId(),
				distanceMeters,
				CATCH_RADIUS_METERS
			);
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
		scoreService.awardCatch(
			room,
			currentUser,
			creature.getScoreValue(),
			creature.getCaughtAt()
		);
		LOGGER.info(
			"catch accepted roomCode={} creatureId={} playerId={} scoreValue={}",
			normalizedRoomCode,
			instanceId,
			currentUser.getUserId(),
			creature.getScoreValue()
		);
		publishEvent(
			RoomCreatureEventType.CAUGHT,
			normalizedRoomCode,
			currentUser.getUserId().toString(),
			creature,
			now
		);

		return CatchRoomCreatureResponse.from(creature, distanceMeters);
	}

	public synchronized void clearExpiredCreatures(String roomCode) {
		Instant now = Instant.now(clock);
		List<RoomCreatureInstance> roomCreatures =
			creaturesByRoom.get(normalizeRoomCode(roomCode));

		if (roomCreatures == null) {
			return;
		}

		roomCreatures.forEach(
			(creature) -> expireCreature(normalizeRoomCode(roomCode), creature, now)
		);
	}

	@Scheduled(fixedDelay = 1000L)
	public void expireDueCreatures() {
		expireDueCreaturesNow();
	}

	public synchronized void expireDueCreaturesNow() {
		creaturesByRoom
			.keySet()
			.forEach((roomCode) -> clearExpiredCreatures(roomCode));
	}

	private void expireCreature(
		String normalizedRoomCode,
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
		LOGGER.info(
			"creature expired roomCode={} creatureId={} playerId={} catalogCreatureId={}",
			normalizedRoomCode,
			creature.getInstanceId(),
			"system",
			creature.getCreatureId()
		);
		publishEvent(
			RoomCreatureEventType.EXPIRED,
			normalizedRoomCode,
			"system",
			creature,
			now
		);
	}

	private void publishEvent(
		RoomCreatureEventType eventType,
		String normalizedRoomCode,
		String playerId,
		RoomCreatureInstance creature,
		Instant now
	) {
		eventPublisher.publish(
			normalizedRoomCode,
			new RoomCreatureEvent(
				eventType,
				normalizedRoomCode,
				playerId,
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
		if (room.getGameState().getStatus() != RoomGameStatus.RUNNING) {
			throw new RoomGameNotRunningException(room.getRoomCode());
		}
	}

	private void requireManualCreatureSpawnAllowed(MultiplayerRoom room) {
		if (!room.getGameplaySettings().isAllowManualCreatureSpawn()) {
			throw new RoomForbiddenException(
				"Manual creature spawning is disabled for this room"
			);
		}
	}

	private int activeUncaughtCount(
		List<RoomCreatureInstance> roomCreatures,
		Instant now
	) {
		return (int) roomCreatures.stream()
			.filter((creature) -> !creature.isCaught())
			.filter((creature) -> !creature.isExpired(now))
			.count();
	}

	private RoomCreatureInstance findCreature(
		String normalizedRoomCode,
		UUID instanceId
	) {
		return creaturesByRoom.getOrDefault(normalizedRoomCode, List.of())
			.stream()
			.filter((creature) -> creature.getInstanceId().equals(instanceId))
			.findFirst()
			.orElseThrow(() -> new RoomCreatureNotFoundException(instanceId));
	}

	private double distanceMeters(
		double startLatitude,
		double startLongitude,
		double endLatitude,
		double endLongitude
	) {
		double startLatitudeRadians = Math.toRadians(startLatitude);
		double endLatitudeRadians = Math.toRadians(endLatitude);
		double latitudeDelta = Math.toRadians(endLatitude - startLatitude);
		double longitudeDelta = Math.toRadians(endLongitude - startLongitude);

		double haversine = Math.sin(latitudeDelta / 2.0)
			* Math.sin(latitudeDelta / 2.0)
			+ Math.cos(startLatitudeRadians)
			* Math.cos(endLatitudeRadians)
			* Math.sin(longitudeDelta / 2.0)
			* Math.sin(longitudeDelta / 2.0);

		return EARTH_RADIUS_METERS * 2.0 * Math.atan2(
			Math.sqrt(haversine),
			Math.sqrt(1.0 - haversine)
		);
	}

	private CreatureDefinition randomCreature(List<CreatureDefinition> catalog) {
		return catalog.get(random.nextInt(catalog.size()));
	}

	private Coordinate randomCoordinate(
		double centerLat,
		double centerLon,
		double radiusMeters
	) {
		double angle = random.nextDouble(0.0, Math.PI * 2.0);
		double distanceMeters = radiusMeters * Math.sqrt(random.nextDouble());
		double northMeters = Math.cos(angle) * distanceMeters;
		double eastMeters = Math.sin(angle) * distanceMeters;
		double latitude = centerLat + (northMeters / METERS_PER_DEGREE_LATITUDE);
		double longitude = centerLon + (
			eastMeters / metersPerDegreeLongitude(centerLat)
		);

		return new Coordinate(
			clamp(latitude, -90.0, 90.0),
			clamp(longitude, -180.0, 180.0)
		);
	}

	private boolean hasCandidateRoute(
		SpawnRoomCreaturesRequest request,
		Coordinate coordinate
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
			return !isRouteUnavailable(exception);
		}
	}

	private boolean isRouteUnavailable(RoutingEngineException exception) {
		return List.of(
			"NoRoute",
			"NoSegment",
			"ROUTE_NOT_FOUND",
			"ROUTE_UNAVAILABLE"
		)
			.contains(exception.getErrorCode());
	}

	private double metersPerDegreeLongitude(double latitude) {
		double cosine = Math.cos(Math.toRadians(latitude));

		if (Math.abs(cosine) < 0.000001) {
			return METERS_PER_DEGREE_LATITUDE * 0.000001;
		}

		return METERS_PER_DEGREE_LATITUDE * Math.abs(cosine);
	}

	private double clamp(double value, double min, double max) {
		return Math.max(min, Math.min(max, value));
	}

	private String normalizeRoomCode(String roomCode) {
		return roomCode.trim().toUpperCase();
	}

	private record Coordinate(double latitude, double longitude) {
	}
}
