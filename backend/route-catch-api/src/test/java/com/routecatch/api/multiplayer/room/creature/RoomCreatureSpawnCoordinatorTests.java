package com.routecatch.api.multiplayer.room.creature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;

class RoomCreatureSpawnCoordinatorTests {

	@Test
	void schedulerStartsOnlyOnceAndStopsIdempotently() {
		Fixture fixture = fixture(properties(4, 2, 5, 8));
		fixture.roundAccess.setRunning(1L, false);

		assertEquals(0, fixture.scheduler.tasks.size());
		fixture.coordinator.start(fixture.room.getRoomCode(), 1L);
		assertEquals(0, fixture.scheduler.tasks.size());

		fixture.roundAccess.setRunning(1L, true);
		fixture.coordinator.start(fixture.room.getRoomCode(), 1L);
		fixture.coordinator.start(fixture.room.getRoomCode(), 1L);

		assertEquals(1, fixture.scheduler.tasks.size());
		assertTrue(fixture.coordinator.hasLoop(fixture.room.getRoomCode()));

		fixture.coordinator.stop(fixture.room.getRoomCode(), 1L, "ENDED");
		fixture.coordinator.stop(fixture.room.getRoomCode(), 1L, "ENDED");

		assertTrue(fixture.scheduler.tasks.getFirst().cancelled);
		assertFalse(fixture.coordinator.hasLoop(fixture.room.getRoomCode()));

		fixture.roundAccess.setRunning(1L, false);
		fixture.positionResolver.position = Optional.of(
			new GeoPoint(0.0, 0.0)
		);
		fixture.snapper.results.add(Optional.of(new GeoPoint(0.002, 0.0)));
		fixture.scheduler.runEvenIfCancelled(0);

		assertEquals(0, fixture.population.createCalls);
	}

	@Test
	void restartCancelsOldLoopAndOldTaskCannotStopNewGeneration() {
		Fixture fixture = fixture(properties(4, 2, 5, 8));
		fixture.roundAccess.setRunning(1L, true);

		fixture.coordinator.start(fixture.room.getRoomCode(), 1L);
		fixture.roundAccess.setRunning(1L, false);
		fixture.coordinator.start(fixture.room.getRoomCode(), 2L);
		fixture.scheduler.runEvenIfCancelled(0);

		assertEquals(2, fixture.scheduler.tasks.size());
		assertTrue(fixture.scheduler.tasks.getFirst().cancelled);
		assertTrue(fixture.coordinator.hasLoop(fixture.room.getRoomCode()));
		assertEquals(0, fixture.population.createCalls);
	}

	@Test
	void cycleUsesSnappedPointRetriesAndCapsDeficitFill() {
		RoomCreatureSpawnProperties properties = properties(0, 10, 5, 3);
		Fixture fixture = fixture(properties);
		GeoPoint snapped = new GeoPoint(0.002, 0.0);
		fixture.snapper.results.add(Optional.empty());
		for (int index = 0; index < 5; index += 1) {
			fixture.snapper.results.add(Optional.of(new GeoPoint(
				snapped.latitude() + index * 0.002,
				snapped.longitude()
			)));
		}
		fixture.roundAccess.setRunning(1L, true);
		fixture.positionResolver.position = Optional.of(
			new GeoPoint(0.0, 0.0)
		);

		fixture.coordinator.runCycle(fixture.room.getRoomCode(), 1L);

		assertEquals(5, fixture.population.createCalls);
		assertEquals(6, fixture.snapper.callCount);
		assertEquals(snapped, fixture.snapper.successfulPoints.getFirst());
		assertEquals(snapped, fixture.population.createdPoints.getFirst());
		assertEquals(
			fixture.host.getUserId().toString(),
			fixture.population.anchorPlayerIds.getFirst()
		);
	}

	@Test
	void existingActiveCreaturesReduceThePopulationDeficit() {
		Fixture fixture = fixture(properties(4, 0, 5, 2));
		fixture.roundAccess.setRunning(1L, true);
		fixture.positionResolver.position = Optional.of(
			new GeoPoint(0.0, 0.0)
		);
		fixture.population.active.add(creature(0.02, 0.0));
		fixture.population.active.add(creature(0.04, 0.0));
		fixture.population.active.add(creature(0.06, 0.0));
		GeoPoint snapped = new GeoPoint(0.002, 0.0);
		fixture.snapper.results.add(Optional.of(snapped));

		fixture.coordinator.runCycle(fixture.room.getRoomCode(), 1L);

		assertEquals(1, fixture.population.createCalls);
		assertEquals(List.of(snapped), fixture.population.createdPoints);
	}

	@Test
	void placementFailureDoesNotEscapeCycleOrCreateCreature() {
		RoomCreatureSpawnProperties properties = properties(0, 1, 1, 2);
		Fixture fixture = fixture(properties);
		fixture.roundAccess.setRunning(1L, true);
		fixture.positionResolver.position = Optional.of(
			new GeoPoint(0.0, 0.0)
		);

		fixture.coordinator.runCycle(fixture.room.getRoomCode(), 1L);

		assertEquals(2, fixture.snapper.callCount);
		assertEquals(0, fixture.population.createCalls);
	}

	private Fixture fixture(RoomCreatureSpawnProperties properties) {
		UserEntity host = user("host");
		MultiplayerRoom room = new MultiplayerRoom(
			"ROOM01",
			"Room",
			host
		);
		FakeRoundAccess roundAccess = new FakeRoundAccess(room);
		FakePopulationStore population = new FakePopulationStore();
		FakePositionResolver positionResolver = new FakePositionResolver();
		ManualScheduler scheduler = new ManualScheduler();
		RecordingSnapper snapper = new RecordingSnapper();
		RoomCreatureSpawnCoordinator coordinator =
			new RoomCreatureSpawnCoordinator(
				roundAccess,
				population,
				positionResolver,
				new RoomCreatureSpawnPolicy(),
				snapper,
				scheduler,
				properties,
				new FixedRandom(),
				Clock.fixed(
					Instant.parse("2026-07-26T00:00:00Z"),
					ZoneOffset.UTC
				)
			);
		return new Fixture(
			roundAccess,
			population,
			positionResolver,
			scheduler,
			snapper,
			coordinator,
			room,
			host
		);
	}

	private RoomCreatureSpawnProperties properties(
		int base,
		int perPlayer,
		int maxPerCycle,
		int attempts
	) {
		return new RoomCreatureSpawnProperties(
			true,
			Duration.ofSeconds(5),
			base,
			perPlayer,
			30,
			maxPerCycle,
			150.0,
			1200.0,
			100.0,
			attempts,
			Duration.ofMinutes(2)
		);
	}

	private UserEntity user(String username) {
		return new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			"Host",
			"hashed-password"
		);
	}

	private RoomCreatureInstance creature(double latitude, double longitude) {
		Instant now = Instant.parse("2026-07-26T00:00:00Z");
		return new RoomCreatureInstance(
			UUID.randomUUID(),
			"ROOM01",
			"cat",
			"Cat",
			"COMMON",
			10,
			latitude,
			longitude,
			now,
			now.plusSeconds(120)
		);
	}

	private record Fixture(
		FakeRoundAccess roundAccess,
		FakePopulationStore population,
		FakePositionResolver positionResolver,
		ManualScheduler scheduler,
		RecordingSnapper snapper,
		RoomCreatureSpawnCoordinator coordinator,
		MultiplayerRoom room,
		UserEntity host
	) {
	}

	private static final class FakeRoundAccess implements RoomRoundAccess {

		private final MultiplayerRoom room;
		private final Map<Long, Boolean> running = new ConcurrentHashMap<>();

		private FakeRoundAccess(MultiplayerRoom room) {
			this.room = room;
		}

		private void setRunning(long generation, boolean value) {
			running.put(generation, value);
		}

		@Override
		public MultiplayerRoom refreshGameState(String roomCode) {
			return room;
		}

		@Override
		public boolean isCurrentRoundRunning(
			String roomCode,
			long generation
		) {
			return running.getOrDefault(generation, true);
		}
	}

	private static final class FakePopulationStore
		implements RoomCreaturePopulationStore {

		private final List<RoomCreatureInstance> active = new ArrayList<>();
		private final List<String> anchorPlayerIds = new ArrayList<>();
		private final List<GeoPoint> createdPoints = new ArrayList<>();
		private int createCalls;

		@Override
		public List<RoomCreatureInstance> activeCreatures(String roomCode) {
			return List.copyOf(active);
		}

		@Override
		public Optional<RoomCreatureInstance> createAutomaticCreature(
			String roomCode,
			long generation,
			GeoPoint snappedPoint,
			String anchorPlayerId
		) {
			createCalls += 1;
			anchorPlayerIds.add(anchorPlayerId);
			createdPoints.add(snappedPoint);
			Instant now = Instant.parse("2026-07-26T00:00:00Z");
			RoomCreatureInstance creature = new RoomCreatureInstance(
				UUID.randomUUID(),
				roomCode,
				"cat",
				"Cat",
				"COMMON",
				10,
				snappedPoint.latitude(),
				snappedPoint.longitude(),
				now,
				now.plusSeconds(120)
			);
			active.add(creature);
			return Optional.of(creature);
		}

		@Override
		public void clearRoom(String roomCode) {
			active.clear();
		}
	}

	private static final class FakePositionResolver
		implements RoomPlayerPositionResolver {

		private Optional<GeoPoint> position = Optional.empty();

		@Override
		public Optional<GeoPoint> resolveAuthoritativePosition(
			String roomCode,
			UUID playerId,
			Instant now
		) {
			return position;
		}
	}

	private static final class ManualScheduler
		implements RoomCreatureSpawnScheduler {

		private final List<ScheduledTask> tasks = new ArrayList<>();

		@Override
		public Cancellable scheduleWithFixedDelay(
			Runnable task,
			Duration interval
		) {
			ScheduledTask scheduled = new ScheduledTask(task);
			tasks.add(scheduled);
			return () -> scheduled.cancelled = true;
		}

		private void runEvenIfCancelled(int index) {
			tasks.get(index).task.run();
		}
	}

	private static final class ScheduledTask {

		private final Runnable task;
		private boolean cancelled;

		private ScheduledTask(Runnable task) {
			this.task = task;
		}
	}

	private static final class RecordingSnapper
		implements RoomCreatureRoadSnapper {

		private final List<Optional<GeoPoint>> results = new ArrayList<>();
		private final List<GeoPoint> successfulPoints = new ArrayList<>();
		private int callCount;

		@Override
		public Optional<GeoPoint> snap(GeoPoint candidate) {
			Optional<GeoPoint> result = callCount < results.size()
				? results.get(callCount)
				: Optional.empty();
			callCount += 1;
			result.ifPresent(successfulPoints::add);
			return result;
		}
	}

	private static final class FixedRandom implements SpawnRandomSource {

		@Override
		public double nextDouble() {
			return 0.5;
		}

		@Override
		public int nextInt(int bound) {
			return 0;
		}
	}
}
