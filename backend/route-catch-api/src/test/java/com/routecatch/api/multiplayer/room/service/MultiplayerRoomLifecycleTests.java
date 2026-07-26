package com.routecatch.api.multiplayer.room.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

class MultiplayerRoomLifecycleTests {

	@Test
	void startEndRestartPublishesMonotonicRoundGenerations() {
		List<RoomGameLifecycleEvent> events = new ArrayList<>();
		MultiplayerRoomService service = new MultiplayerRoomService((event) -> {
			if (event instanceof RoomGameLifecycleEvent lifecycleEvent) {
				events.add(lifecycleEvent);
			}
		});
		UserEntity host = user();
		MultiplayerRoom room = service.createRoom(
			host,
			new CreateRoomRequest("Restartable Room")
		);

		service.startGame(
			room.getRoomCode(),
			host,
			new StartRoomGameRequest(60)
		);
		service.endGame(room.getRoomCode(), host);
		service.startGame(
			room.getRoomCode(),
			host,
			new StartRoomGameRequest(60)
		);

		assertEquals(
			List.of(
				RoomGameLifecycleEvent.Type.STARTED,
				RoomGameLifecycleEvent.Type.STOPPED,
				RoomGameLifecycleEvent.Type.STARTED
			),
			events.stream().map(RoomGameLifecycleEvent::type).toList()
		);
		assertEquals(
			List.of(1L, 1L, 2L),
			events.stream().map(RoomGameLifecycleEvent::generation).toList()
		);
		assertEquals(RoomGameStatus.RUNNING, room.getGameState().getStatus());
		assertEquals(MultiplayerRoomStatus.IN_PROGRESS, room.getStatus());
	}

	@Test
	void closingRunningRoomEndsRoundAndPublishesClosed() {
		List<RoomGameLifecycleEvent> events = new ArrayList<>();
		MultiplayerRoomService service = new MultiplayerRoomService((event) -> {
			if (event instanceof RoomGameLifecycleEvent lifecycleEvent) {
				events.add(lifecycleEvent);
			}
		});
		UserEntity host = user();
		MultiplayerRoom room = service.createRoom(
			host,
			new CreateRoomRequest("Closable Room")
		);
		service.startGame(
			room.getRoomCode(),
			host,
			new StartRoomGameRequest(60)
		);

		service.closeRoom(room.getRoomCode(), host);

		assertEquals(RoomGameStatus.ENDED, room.getGameState().getStatus());
		assertEquals(MultiplayerRoomStatus.CLOSED, room.getStatus());
		assertEquals(
			RoomGameLifecycleEvent.Type.CLOSED,
			events.getLast().type()
		);
	}

	private UserEntity user() {
		return new UserEntity(
			UUID.randomUUID(),
			"host",
			"host@example.com",
			"Host",
			"hashed-password"
		);
	}
}
