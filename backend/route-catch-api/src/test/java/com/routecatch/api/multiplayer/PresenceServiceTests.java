package com.routecatch.api.multiplayer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
