package com.routecatch.api.multiplayer.room.creature;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;

class RoomCreatureServiceTests {

	@Test
	void listCreaturesFiltersExpiredCreatures() {
		MutableClock clock = new MutableClock(Instant.parse(
			"2026-06-25T10:00:00Z"
		));
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomCreatureService creatureService = new RoomCreatureService(
			roomService,
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
