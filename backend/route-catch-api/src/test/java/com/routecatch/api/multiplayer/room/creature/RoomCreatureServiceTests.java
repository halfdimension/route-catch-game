package com.routecatch.api.multiplayer.room.creature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.RoomScoreboardResponse;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;

class RoomCreatureServiceTests {

	@Test
	void listCreaturesFiltersExpiredCreatures() {
		MutableClock clock = new MutableClock(Instant.parse(
			"2026-06-25T10:00:00Z"
		));
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomScoreService scoreService = new RoomScoreService(roomService);
		RoomCreatureService creatureService = new RoomCreatureService(
			roomService,
			scoreService,
			new StubCreatureCatalogService(),
			clock
		);
		UserEntity host = user("host", "Host");
		String roomCode = roomService
			.createRoom(host, new CreateRoomRequest("Delhi Room"))
			.getRoomCode();
		roomService.startGame(roomCode, host, new StartRoomGameRequest(60));

		creatureService.spawnCreatures(
			roomCode,
			host,
			new SpawnRoomCreaturesRequest(28.6139, 77.2090, 2, 30, 500.0)
		);

		assertEquals(2, creatureService.listCreatures(roomCode, host).size());

		clock.advance(Duration.ofSeconds(31));

		assertEquals(List.of(), creatureService.listCreatures(roomCode, host));
	}

	@Test
	void catchExpiredCreatureReturnsConflictException() {
		MutableClock clock = new MutableClock(Instant.parse(
			"2026-06-25T10:00:00Z"
		));
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomScoreService scoreService = new RoomScoreService(roomService);
		RoomCreatureService creatureService = new RoomCreatureService(
			roomService,
			scoreService,
			new StubCreatureCatalogService(),
			clock
		);
		UserEntity host = user("host", "Host");
		String roomCode = roomService
			.createRoom(host, new CreateRoomRequest("Delhi Room"))
			.getRoomCode();
		roomService.startGame(roomCode, host, new StartRoomGameRequest(60));
		RoomCreatureInstance creature = creatureService.spawnCreatures(
			roomCode,
			host,
			new SpawnRoomCreaturesRequest(28.6139, 77.2090, 1, 30, 20.0)
		).getFirst();

		clock.advance(Duration.ofSeconds(31));

		assertThrows(
			RoomCreatureExpiredException.class,
			() -> creatureService.catchCreature(
				roomCode,
				creature.getInstanceId(),
				host,
				catchRequest(creature)
			)
		);
	}

	@Test
	void concurrentDuplicateCatchAllowsOnlyOneSuccess() throws Exception {
		MutableClock clock = new MutableClock(Instant.parse(
			"2026-06-25T10:00:00Z"
		));
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomScoreService scoreService = new RoomScoreService(roomService);
		RoomCreatureService creatureService = new RoomCreatureService(
			roomService,
			scoreService,
			new StubCreatureCatalogService(),
			clock
		);
		UserEntity host = user("host", "Host");
		UserEntity member = user("member", "Member");
		String roomCode = roomService
			.createRoom(host, new CreateRoomRequest("Delhi Room"))
			.getRoomCode();
		roomService.joinRoom(roomCode, member);
		roomService.startGame(roomCode, host, new StartRoomGameRequest(60));
		RoomCreatureInstance creature = creatureService.spawnCreatures(
			roomCode,
			host,
			new SpawnRoomCreaturesRequest(28.6139, 77.2090, 1, 120, 20.0)
		).getFirst();
		CountDownLatch ready = new CountDownLatch(2);
		CountDownLatch start = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(2);

		try {
			Future<Boolean> hostAttempt = executor.submit(catchAttempt(
				ready,
				start,
				creatureService,
				roomCode,
				creature,
				host
			));
			Future<Boolean> memberAttempt = executor.submit(catchAttempt(
				ready,
				start,
				creatureService,
				roomCode,
				creature,
				member
			));

			ready.await();
			start.countDown();

			int successes = (hostAttempt.get() ? 1 : 0)
				+ (memberAttempt.get() ? 1 : 0);

			assertEquals(1, successes);
			assertTrue(creature.isCaught());

			RoomScoreboardResponse scoreboard = scoreService.getScoreboard(
				roomCode,
				host
			);
			assertEquals(
				10,
				scoreboard.entries()
					.stream()
					.mapToInt((entry) -> entry.score())
					.sum()
			);
			assertEquals(
				1,
				scoreboard.entries()
					.stream()
					.mapToInt((entry) -> entry.catches())
					.sum()
			);
		} finally {
			executor.shutdownNow();
		}
	}

	private Callable<Boolean> catchAttempt(
		CountDownLatch ready,
		CountDownLatch start,
		RoomCreatureService creatureService,
		String roomCode,
		RoomCreatureInstance creature,
		UserEntity user
	) {
		return () -> {
			ready.countDown();
			start.await();

			try {
				creatureService.catchCreature(
					roomCode,
					creature.getInstanceId(),
					user,
					catchRequest(creature)
				);
				return true;
			} catch (RoomCreatureAlreadyCaughtException exception) {
				return false;
			}
		};
	}

	private CatchRoomCreatureRequest catchRequest(RoomCreatureInstance creature) {
		return new CatchRoomCreatureRequest(
			creature.getLatitude(),
			creature.getLongitude()
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

	private static class StubCreatureCatalogService
		extends CreatureCatalogService {

		StubCreatureCatalogService() {
			super(null);
		}

		@Override
		public List<CreatureDefinition> getAllCreatures() {
			return List.of(new CreatureDefinition("cat", "Cat", "COMMON", 10));
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
}
