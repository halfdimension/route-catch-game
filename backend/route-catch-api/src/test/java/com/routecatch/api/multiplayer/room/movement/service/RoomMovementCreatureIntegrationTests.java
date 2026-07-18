package com.routecatch.api.multiplayer.room.movement.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;
import com.routecatch.api.multiplayer.room.creature.CatchRoomCreatureRequest;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureAlreadyCaughtException;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureExpiredException;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureInstance;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.creature.SpawnRoomCreaturesRequest;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.event.InMemoryRoomEventSequencer;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;
import com.routecatch.api.multiplayer.room.movement.dto.StartRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRoute;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRouteClient;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;
import com.routecatch.api.multiplayer.service.PresenceService;

class RoomMovementCreatureIntegrationTests {

	@Test
	void creatureChaseIgnoresRequestedCoordinatesAndUsesActiveTarget() {
		Fixture fixture = fixture();
		StartRoomMovementRequest request = creatureRequest(
			fixture.creature().getInstanceId()
		);

		RoomMovementPlanResponse movement = fixture.movementService().startMovement(
			fixture.roomCode(),
			fixture.host(),
			request
		);

		MovementCoordinate authoritativeTarget = new MovementCoordinate(
			fixture.creature().getLatitude(),
			fixture.creature().getLongitude()
		);
		assertEquals(authoritativeTarget, fixture.routeClient().destination());
		assertEquals(authoritativeTarget, movement.destination());
		assertEquals(
			fixture.creature().getInstanceId(),
			movement.targetCreatureInstanceId()
		);
		assertEquals(MovementDestinationType.CREATURE, movement.destinationType());
	}

	@Test
	void caughtCreatureChaseIsRejectedBeforeRouting() {
		Fixture fixture = fixture();
		fixture.creatureService().catchCreature(
			fixture.roomCode(),
			fixture.creature().getInstanceId(),
			fixture.host(),
			new CatchRoomCreatureRequest(
				fixture.creature().getLatitude(),
				fixture.creature().getLongitude()
			)
		);

		assertThrows(
			RoomCreatureAlreadyCaughtException.class,
			() -> fixture.movementService().startMovement(
				fixture.roomCode(),
				fixture.host(),
				creatureRequest(fixture.creature().getInstanceId())
			)
		);
		assertEquals(0, fixture.routeClient().requestCount());
	}

	@Test
	void expiredCreatureChaseIsRejectedBeforeRouting() {
		Fixture fixture = fixture();
		fixture.creature().markExpired();

		assertThrows(
			RoomCreatureExpiredException.class,
			() -> fixture.movementService().startMovement(
				fixture.roomCode(),
				fixture.host(),
				creatureRequest(fixture.creature().getInstanceId())
			)
		);
		assertEquals(0, fixture.routeClient().requestCount());
	}

	private Fixture fixture() {
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomScoreService scoreService = new RoomScoreService(roomService);
		RoomCreatureService creatureService = new RoomCreatureService(
			roomService,
			scoreService,
			new StubCreatureCatalogService(),
			null,
			(roomCode, event) -> {}
		);
		UserEntity host = user("host", "Host");
		String roomCode = roomService
			.createRoom(host, new CreateRoomRequest("Delhi Room"))
			.getRoomCode();
		roomService.startGame(roomCode, host, new StartRoomGameRequest(60));
		RoomCreatureInstance creature = creatureService.spawnCreatures(
			roomCode,
			host,
			new SpawnRoomCreaturesRequest(28.6139, 77.2090, 1, 120, 20.0)
		).getFirst();
		CapturingRouteClient routeClient = new CapturingRouteClient();
		InMemoryRoomMovementService movementService =
			new InMemoryRoomMovementService(
				roomService,
				new PresenceService(),
				creatureService,
				routeClient,
				new InMemoryRoomEventSequencer(),
				(event) -> {},
				(completionTime, completionTask) -> {},
				Clock.systemUTC(),
				new MovementCoordinate(28.550584664849566, 77.26885829983426)
			);

		return new Fixture(
			roomCode,
			host,
			creature,
			creatureService,
			movementService,
			routeClient
		);
	}

	private StartRoomMovementRequest creatureRequest(UUID creatureInstanceId) {
		return new StartRoomMovementRequest(
			0.0,
			0.0,
			40.0,
			MovementDestinationType.CREATURE,
			creatureInstanceId,
			UUID.randomUUID(),
			0L
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

	private String encodePolyline6(
		MovementCoordinate source,
		MovementCoordinate destination
	) {
		StringBuilder encoded = new StringBuilder();
		long previousLatitude = 0L;
		long previousLongitude = 0L;

		for (MovementCoordinate coordinate : List.of(source, destination)) {
			long latitude = Math.round(coordinate.latitude() * 1_000_000.0);
			long longitude = Math.round(coordinate.longitude() * 1_000_000.0);
			appendEncodedValue(encoded, latitude - previousLatitude);
			appendEncodedValue(encoded, longitude - previousLongitude);
			previousLatitude = latitude;
			previousLongitude = longitude;
		}

		return encoded.toString();
	}

	private void appendEncodedValue(StringBuilder encoded, long value) {
		long shifted = value < 0L ? ~(value << 1) : value << 1;

		while (shifted >= 0x20L) {
			encoded.append((char) ((0x20L | (shifted & 0x1fL)) + 63L));
			shifted >>= 5;
		}

		encoded.append((char) (shifted + 63L));
	}

	private record Fixture(
		String roomCode,
		UserEntity host,
		RoomCreatureInstance creature,
		RoomCreatureService creatureService,
		InMemoryRoomMovementService movementService,
		CapturingRouteClient routeClient
	) {
	}

	private class CapturingRouteClient implements MovementRouteClient {

		private MovementCoordinate destination;
		private int requestCount;

		@Override
		public MovementRoute fetchRoute(
			MovementCoordinate source,
			MovementCoordinate destination
		) {
			this.destination = destination;
			requestCount += 1;
			return new MovementRoute(
				encodePolyline6(source, destination),
				1000.0,
				10.0
			);
		}

		MovementCoordinate destination() {
			return destination;
		}

		int requestCount() {
			return requestCount;
		}
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
}
