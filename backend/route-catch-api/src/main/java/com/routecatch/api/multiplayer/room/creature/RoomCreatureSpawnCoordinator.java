package com.routecatch.api.multiplayer.room.creature;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomMember;

@Service
public class RoomCreatureSpawnCoordinator {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomCreatureSpawnCoordinator.class
	);
	private static final int ROOM_LOCK_COUNT = 64;

	private final RoomRoundAccess roomService;
	private final RoomCreaturePopulationStore creatureService;
	private final RoomPlayerPositionResolver positionResolver;
	private final RoomCreatureSpawnPolicy spawnPolicy;
	private final RoomCreatureRoadSnapper roadSnapper;
	private final RoomCreatureSpawnScheduler scheduler;
	private final RoomCreatureSpawnProperties properties;
	private final SpawnRandomSource random;
	private final Clock clock;
	private final Map<String, SpawnLoop> loops = new ConcurrentHashMap<>();
	private final Object[] roomLocks = createLocks(ROOM_LOCK_COUNT);

	@Autowired
	public RoomCreatureSpawnCoordinator(
		RoomRoundAccess roomService,
		RoomCreaturePopulationStore creatureService,
		RoomPlayerPositionResolver positionResolver,
		RoomCreatureSpawnPolicy spawnPolicy,
		RoomCreatureRoadSnapper roadSnapper,
		RoomCreatureSpawnScheduler scheduler,
		RoomCreatureSpawnProperties properties,
		SpawnRandomSource random
	) {
		this(
			roomService,
			creatureService,
			positionResolver,
			spawnPolicy,
			roadSnapper,
			scheduler,
			properties,
			random,
			Clock.systemUTC()
		);
	}

	RoomCreatureSpawnCoordinator(
		RoomRoundAccess roomService,
		RoomCreaturePopulationStore creatureService,
		RoomPlayerPositionResolver positionResolver,
		RoomCreatureSpawnPolicy spawnPolicy,
		RoomCreatureRoadSnapper roadSnapper,
		RoomCreatureSpawnScheduler scheduler,
		RoomCreatureSpawnProperties properties,
		SpawnRandomSource random,
		Clock clock
	) {
		this.roomService = roomService;
		this.creatureService = creatureService;
		this.positionResolver = positionResolver;
		this.spawnPolicy = spawnPolicy;
		this.roadSnapper = roadSnapper;
		this.scheduler = scheduler;
		this.properties = properties;
		this.random = random;
		this.clock = clock;
	}

	@EventListener
	public void onRoomLifecycle(RoomGameLifecycleEvent event) {
		if (event.type() == RoomGameLifecycleEvent.Type.STARTED) {
			start(event.roomCode(), event.generation());
		} else {
			stop(event.roomCode(), event.generation(), event.type().name());
		}
	}

	public void start(String roomCode, long generation) {
		if (!properties.enabled()) {
			return;
		}

		String normalizedRoomCode = normalizeRoomCode(roomCode);

		if (!roomService.isCurrentRoundRunning(
			normalizedRoomCode,
			generation
		)) {
			return;
		}

		synchronized (roomLock(normalizedRoomCode)) {
			SpawnLoop current = loops.get(normalizedRoomCode);

			if (current != null && current.generation() >= generation) {
				return;
			}
			if (current != null) {
				current.cancel();
			}

			creatureService.clearRoom(normalizedRoomCode);
			SpawnLoop next = new SpawnLoop(generation);
			loops.put(normalizedRoomCode, next);

			try {
				next.setCancellable(scheduler.scheduleWithFixedDelay(
					() -> runGuardedCycle(normalizedRoomCode, generation),
					properties.interval()
				));
			} catch (RuntimeException exception) {
				loops.remove(normalizedRoomCode, next);
				throw exception;
			}

			LOGGER.info(
				"automatic creature scheduler started roomCode={} generation={} interval={}",
				normalizedRoomCode,
				generation,
				properties.interval()
			);
		}
	}

	public void stop(String roomCode, long generation, String reason) {
		String normalizedRoomCode = normalizeRoomCode(roomCode);

		synchronized (roomLock(normalizedRoomCode)) {
			SpawnLoop current = loops.get(normalizedRoomCode);

			if (current != null && current.generation() > generation) {
				return;
			}
			if (current != null) {
				loops.remove(normalizedRoomCode, current);
				current.cancel();
			}

			creatureService.clearRoom(normalizedRoomCode);
			LOGGER.info(
				"automatic creature scheduler stopped roomCode={} generation={} reason={}",
				normalizedRoomCode,
				generation,
				reason
			);
		}
	}

	void runCycle(String roomCode, long generation) {
		if (!roomService.isCurrentRoundRunning(roomCode, generation)) {
			stop(roomCode, generation, "ROOM_NOT_RUNNING");
			return;
		}

		MultiplayerRoom room = roomService.refreshGameState(roomCode);
		List<EligibleSpawnPlayer> players = eligiblePlayers(room);
		List<RoomCreatureInstance> activeCreatures =
			creatureService.activeCreatures(roomCode);
		int desired = spawnPolicy.desiredActiveCount(
			players.size(),
			properties
		);
		int deficit = Math.max(0, desired - activeCreatures.size());
		int requested = Math.min(deficit, properties.maxSpawnsPerCycle());

		LOGGER.debug(
			"automatic creature cycle roomCode={} generation={} activePlayerCount={} activeCreatureCount={} desiredCount={} deficit={}",
			roomCode,
			generation,
			players.size(),
			activeCreatures.size(),
			desired,
			deficit
		);

		int created = 0;

		for (int index = 0; index < requested; index += 1) {
			if (!roomService.isCurrentRoundRunning(roomCode, generation)) {
				break;
			}

			if (placeOne(roomCode, generation)) {
				created += 1;
			}
		}

		if (created > 0) {
			LOGGER.info(
				"automatic creatures created roomCode={} generation={} createdCount={}",
				roomCode,
				generation,
				created
			);
		}
	}

	boolean hasLoop(String roomCode) {
		return loops.containsKey(normalizeRoomCode(roomCode));
	}

	private boolean placeOne(String roomCode, long generation) {
		MultiplayerRoom room = roomService.refreshGameState(roomCode);
		List<EligibleSpawnPlayer> players = eligiblePlayers(room);
		List<RoomCreatureInstance> active =
			creatureService.activeCreatures(roomCode);
		Optional<EligibleSpawnPlayer> selected = spawnPolicy.selectAnchor(
			players,
			active,
			properties.maxRadiusMeters()
		);

		if (selected.isEmpty()) {
			LOGGER.debug(
				"automatic creature placement failed roomCode={} generation={} category=no_eligible_anchor",
				roomCode,
				generation
			);
			return false;
		}

		EligibleSpawnPlayer anchor = selected.get();
		LOGGER.debug(
			"automatic creature anchor selected roomCode={} generation={} playerId={} displayName={}",
			roomCode,
			generation,
			anchor.playerId(),
			anchor.displayName()
		);
		String failureCategory = "attempt_limit";

		for (
			int attempt = 0;
			attempt < properties.maxPlacementAttempts();
			attempt += 1
		) {
			GeoPoint candidate = spawnPolicy.generateCandidate(
				anchor.position(),
				properties.minRadiusMeters(),
				properties.maxRadiusMeters(),
				random
			);
			Optional<GeoPoint> snapped = roadSnapper.snap(candidate);

			if (snapped.isEmpty()) {
				failureCategory = "osrm_snap_failed";
				continue;
			}

			GeoPoint snappedPoint = snapped.get();

			if (!snappedPoint.isValid()) {
				failureCategory = "invalid_snapped_coordinate";
				continue;
			}
			double anchorDistance = spawnPolicy.distanceMeters(
				anchor.position(),
				snappedPoint
			);
			if (anchorDistance < properties.minRadiusMeters()) {
				failureCategory = "too_close_to_anchor";
				continue;
			}
			if (anchorDistance > properties.maxRadiusMeters()) {
				failureCategory = "too_far_from_anchor";
				continue;
			}

			active = creatureService.activeCreatures(roomCode);
			if (!spawnPolicy.isSeparatedFromCreatures(
				snappedPoint,
				active,
				properties.minCreatureSeparationMeters()
			)) {
				failureCategory = "too_close_to_creature";
				continue;
			}
			if (!roomService.isCurrentRoundRunning(roomCode, generation)) {
				failureCategory = "stale_round";
				break;
			}

			Optional<RoomCreatureInstance> created =
				creatureService.createAutomaticCreature(
					roomCode,
					generation,
					snappedPoint,
					anchor.playerId().toString()
				);
			if (created.isPresent()) {
				return true;
			}

			failureCategory = "authoritative_creation_rejected";
		}

		LOGGER.debug(
			"automatic creature placement failed roomCode={} generation={} anchorPlayerId={} category={}",
			roomCode,
			generation,
			anchor.playerId(),
			failureCategory
		);
		return false;
	}

	private List<EligibleSpawnPlayer> eligiblePlayers(MultiplayerRoom room) {
		Instant now = Instant.now(clock);
		return room.getMembers().stream()
			.map((member) -> eligiblePlayer(room.getRoomCode(), member, now))
			.flatMap(Optional::stream)
			.toList();
	}

	private Optional<EligibleSpawnPlayer> eligiblePlayer(
		String roomCode,
		RoomMember member,
		Instant now
	) {
		return positionResolver.resolveAuthoritativePosition(
			roomCode,
			member.getUserId(),
			now
		).filter(GeoPoint::isValid)
			.map((position) -> new EligibleSpawnPlayer(
				member.getUserId(),
				member.getDisplayName(),
				position
			));
	}

	private void runGuardedCycle(String roomCode, long generation) {
		SpawnLoop loop = loops.get(roomCode);

		if (
			loop == null ||
			loop.generation() != generation ||
			!loop.running().compareAndSet(false, true)
		) {
			return;
		}

		try {
			runCycle(roomCode, generation);
		} catch (RuntimeException exception) {
			LOGGER.error(
				"automatic creature cycle failed roomCode={} generation={}",
				roomCode,
				generation,
				exception
			);
		} finally {
			loop.running().set(false);
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

	private static final class SpawnLoop {

		private final long generation;
		private final AtomicBoolean running = new AtomicBoolean();
		private final AtomicReference<
			RoomCreatureSpawnScheduler.Cancellable
		> cancellable = new AtomicReference<>();

		private SpawnLoop(long generation) {
			this.generation = generation;
		}

		private long generation() {
			return generation;
		}

		private AtomicBoolean running() {
			return running;
		}

		private void setCancellable(
			RoomCreatureSpawnScheduler.Cancellable nextCancellable
		) {
			cancellable.set(nextCancellable);
		}

		private void cancel() {
			RoomCreatureSpawnScheduler.Cancellable current =
				cancellable.getAndSet(null);

			if (current != null) {
				current.cancel();
			}
		}
	}
}
