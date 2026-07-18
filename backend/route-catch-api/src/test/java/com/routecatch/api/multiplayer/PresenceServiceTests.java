package com.routecatch.api.multiplayer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.dto.PresenceResponse;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.service.PresenceService;

class PresenceServiceTests {

	private final PresenceService presenceService = new PresenceService();

	@Test
	void updatePresenceStoresPresenceForRoom() {
		UserEntity user = user("harsh", "Harsh");
		presenceService.registerSocketSession("socket-1");

		List<PresenceResponse> roomPresence = presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "IDLE"),
			"socket-1"
		);

		assertEquals(1, roomPresence.size());
		assertEquals(user.getUserId().toString(), roomPresence.getFirst().userId());
		assertEquals("harsh", roomPresence.getFirst().username());
		assertEquals("Harsh", roomPresence.getFirst().displayName());
		assertEquals(28.6, roomPresence.getFirst().lat());
		assertEquals(77.2, roomPresence.getFirst().lon());
		assertEquals("IDLE", roomPresence.getFirst().status());
	}

	@Test
	void blankStatusDefaultsToIdle() {
		UserEntity user = user("harsh", "Harsh");
		presenceService.registerSocketSession("socket-1");

		List<PresenceResponse> roomPresence = presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "   "),
			"socket-1"
		);

		assertEquals("IDLE", roomPresence.getFirst().status());
	}

	@Test
	void roomsAreIsolated() {
		UserEntity harsh = user("harsh", "Harsh");
		UserEntity other = user("other", "Other");
		presenceService.registerSocketSession("socket-1");
		presenceService.registerSocketSession("socket-2");

		presenceService.updatePresence(
			"room-a",
			harsh,
			new PresenceUpdateRequest(28.6, 77.2, "IDLE"),
			"socket-1"
		);
		presenceService.updatePresence(
			"room-b",
			other,
			new PresenceUpdateRequest(29.0, 78.0, "MOVING"),
			"socket-2"
		);

		assertEquals(1, presenceService.listRoomPresence("room-a").size());
		assertEquals("harsh", presenceService
			.listRoomPresence("room-a")
			.getFirst()
			.username());
		assertEquals(1, presenceService.listRoomPresence("room-b").size());
		assertEquals("other", presenceService
			.listRoomPresence("room-b")
			.getFirst()
			.username());
	}

	@Test
	void disconnectRemovesUserFromTrackedRooms() {
		UserEntity user = user("harsh", "Harsh");
		presenceService.registerSocketSession("socket-1");

		presenceService.updatePresence(
			"room-a",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "IDLE"),
			"socket-1"
		);
		presenceService.updatePresence(
			"room-b",
			user,
			new PresenceUpdateRequest(29.0, 78.0, "MOVING"),
			"socket-1"
		);

		Map<String, List<PresenceResponse>> updatedRooms =
			presenceService.removeSocketSession("socket-1");

		assertTrue(updatedRooms.containsKey("room-a"));
		assertTrue(updatedRooms.containsKey("room-b"));
		assertTrue(updatedRooms.get("room-a").isEmpty());
		assertTrue(updatedRooms.get("room-b").isEmpty());
		assertTrue(presenceService.listRoomPresence("room-a").isEmpty());
		assertTrue(presenceService.listRoomPresence("room-b").isEmpty());
	}

	@Test
	void unknownDisconnectReturnsNoUpdates() {
		assertTrue(presenceService.removeSocketSession("missing").isEmpty());
	}

	@Test
	void repeatedLongMovementKeepsLatestPositionAndMonotonicTimestamp() {
		UserEntity user = user("harsh", "Harsh");
		Instant previousTimestamp = null;
		presenceService.registerSocketSession("socket-1");

		for (int sequence = 0; sequence < 450; sequence += 1) {
			List<PresenceResponse> roomPresence = presenceService.updatePresence(
				"long-route",
				user,
				new PresenceUpdateRequest(
					28.6 + sequence * 0.00001,
					77.2 + sequence * 0.00001,
					"MOVING"
				),
				"socket-1"
			);
			Instant nextTimestamp = roomPresence.getFirst().lastSeenAt();

			if (previousTimestamp != null) {
				assertTrue(nextTimestamp.isAfter(previousTimestamp));
			}
			previousTimestamp = nextTimestamp;
		}

		PresenceResponse latest = presenceService
			.listRoomPresence("long-route")
			.getFirst();
		assertEquals(28.6 + 449 * 0.00001, latest.lat());
		assertEquals(77.2 + 449 * 0.00001, latest.lon());
		assertEquals("MOVING", latest.status());
	}

	@Test
	void oldSocketDisconnectDoesNotRemoveReconnectedPresence() {
		UserEntity user = user("harsh", "Harsh");
		presenceService.registerSocketSession("old-socket");
		presenceService.registerSocketSession("new-socket");

		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "MOVING"),
			"old-socket"
		);
		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.7, 77.3, "MOVING"),
			"new-socket"
		);

		Map<String, List<PresenceResponse>> oldSocketUpdates =
			presenceService.removeSocketSession("old-socket");

		assertTrue(oldSocketUpdates.isEmpty());
		assertEquals(1, presenceService.listRoomPresence("demo-room").size());
		assertEquals(
			28.7,
			presenceService.listRoomPresence("demo-room").getFirst().lat()
		);

		Map<String, List<PresenceResponse>> newSocketUpdates =
			presenceService.removeSocketSession("new-socket");
		assertFalse(newSocketUpdates.isEmpty());
		assertTrue(presenceService.listRoomPresence("demo-room").isEmpty());
	}

	@Test
	void lateUpdateFromDisconnectedSocketCannotReplaceReconnectedPresence() {
		UserEntity user = user("harsh", "Harsh");
		presenceService.registerSocketSession("old-socket");
		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "MOVING"),
			"old-socket"
		);
		presenceService.removeSocketSession("old-socket");

		presenceService.registerSocketSession("new-socket");
		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.7, 77.3, "MOVING"),
			"new-socket"
		);

		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.61, 77.21, "MOVING"),
			"old-socket"
		);

		List<PresenceResponse> presence = presenceService.listRoomPresence(
			"demo-room"
		);
		assertEquals(1, presence.size());
		assertEquals(28.7, presence.getFirst().lat());
		assertEquals(77.3, presence.getFirst().lon());
	}

	@Test
	void disconnectedSocketCannotCreatePresenceAfterCleanup() {
		UserEntity user = user("harsh", "Harsh");
		presenceService.registerSocketSession("socket-1");
		presenceService.removeSocketSession("socket-1");

		List<PresenceResponse> presence = presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "MOVING"),
			"socket-1"
		);

		assertTrue(presence.isEmpty());
		assertTrue(presenceService.listRoomPresence("demo-room").isEmpty());
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
}
