package com.routecatch.api.multiplayer.room.movement.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.movement.dto.CancelRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementSnapshotResponse;
import com.routecatch.api.multiplayer.room.movement.dto.StartRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;
import com.routecatch.api.multiplayer.room.movement.service.RoomMovementService;

class RoomMovementWebSocketControllerTests {

	@Test
	void startMovementRejectsMissingPrincipalBeforeCallingService() {
		RecordingRoomMovementService movementService =
			new RecordingRoomMovementService();
		RoomMovementWebSocketController controller =
			new RoomMovementWebSocketController(movementService);

		assertThrows(
			AccessDeniedException.class,
			() -> controller.startMovement("ROOM01", startRequest(), null)
		);
		assertEquals(0, movementService.startCallCount);
	}

	@Test
	void cancelMovementRejectsAuthenticationWithWrongPrincipalType() {
		RecordingRoomMovementService movementService =
			new RecordingRoomMovementService();
		RoomMovementWebSocketController controller =
			new RoomMovementWebSocketController(movementService);
		UsernamePasswordAuthenticationToken authentication =
			new UsernamePasswordAuthenticationToken("not-a-user-entity", "token");

		assertThrows(
			AccessDeniedException.class,
			() -> controller.cancelMovement(
				"ROOM01",
				cancelRequest(),
				authentication
			)
		);
		assertEquals(0, movementService.cancelCallCount);
	}

	@Test
	void startMovementPassesAuthenticatedUserEntityToService() {
		RecordingRoomMovementService movementService =
			new RecordingRoomMovementService();
		RoomMovementWebSocketController controller =
			new RoomMovementWebSocketController(movementService);
		UserEntity user = user();
		StartRoomMovementRequest request = startRequest();

		controller.startMovement(
			"ROOM01",
			request,
			new UsernamePasswordAuthenticationToken(user, "token")
		);

		assertEquals(1, movementService.startCallCount);
		assertEquals("ROOM01", movementService.startedRoomCode);
		assertSame(user, movementService.startedUser);
		assertSame(request, movementService.startRequest);
	}

	@Test
	void cancelMovementPassesAuthenticatedUserEntityToService() {
		RecordingRoomMovementService movementService =
			new RecordingRoomMovementService();
		RoomMovementWebSocketController controller =
			new RoomMovementWebSocketController(movementService);
		UserEntity user = user();
		CancelRoomMovementRequest request = cancelRequest();

		controller.cancelMovement(
			"ROOM01",
			request,
			new UsernamePasswordAuthenticationToken(user, "token")
		);

		assertEquals(1, movementService.cancelCallCount);
		assertEquals("ROOM01", movementService.cancelledRoomCode);
		assertSame(user, movementService.cancelledUser);
		assertSame(request, movementService.cancelRequest);
	}

	@Test
	void movementCommandDtosDoNotExposeClientControlledPlayerId() {
		assertFalse(hasRecordComponent(StartRoomMovementRequest.class, "playerId"));
		assertFalse(hasRecordComponent(CancelRoomMovementRequest.class, "playerId"));
	}

	private boolean hasRecordComponent(Class<?> type, String componentName) {
		return Arrays.stream(type.getRecordComponents())
			.anyMatch((component) -> component.getName().equals(componentName));
	}

	private StartRoomMovementRequest startRequest() {
		return new StartRoomMovementRequest(
			28.614,
			77.21,
			80.0,
			MovementDestinationType.MAP,
			null,
			UUID.randomUUID(),
			null
		);
	}

	private CancelRoomMovementRequest cancelRequest() {
		return new CancelRoomMovementRequest(
			UUID.randomUUID(),
			1L,
			UUID.randomUUID()
		);
	}

	private UserEntity user() {
		return new UserEntity(
			UUID.randomUUID(),
			"player",
			"player@example.com",
			"Player",
			"hashed-password"
		);
	}

	private static class RecordingRoomMovementService
		implements RoomMovementService {

		private int startCallCount;
		private String startedRoomCode;
		private UserEntity startedUser;
		private StartRoomMovementRequest startRequest;
		private int cancelCallCount;
		private String cancelledRoomCode;
		private UserEntity cancelledUser;
		private CancelRoomMovementRequest cancelRequest;

		@Override
		public RoomMovementPlanResponse startMovement(
			String roomCode,
			UserEntity currentUser,
			StartRoomMovementRequest request
		) {
			startCallCount += 1;
			startedRoomCode = roomCode;
			startedUser = currentUser;
			startRequest = request;
			return null;
		}

		@Override
		public Optional<RoomMovementPlanResponse> cancelMovement(
			String roomCode,
			UserEntity currentUser,
			CancelRoomMovementRequest request
		) {
			cancelCallCount += 1;
			cancelledRoomCode = roomCode;
			cancelledUser = currentUser;
			cancelRequest = request;
			return Optional.empty();
		}

		@Override
		public RoomMovementSnapshotResponse getSnapshot(
			String roomCode,
			UserEntity currentUser
		) {
			throw new UnsupportedOperationException("Snapshot not used by this test");
		}
	}
}
