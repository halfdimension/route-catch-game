package com.routecatch.api.multiplayer.room.movement.controller;

import java.security.Principal;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.movement.dto.CancelRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.dto.StartRoomMovementRequest;
import com.routecatch.api.multiplayer.room.movement.service.RoomMovementService;

import jakarta.validation.Valid;

@Controller
public class RoomMovementWebSocketController {

	private final RoomMovementService movementService;

	public RoomMovementWebSocketController(
		RoomMovementService movementService
	) {
		this.movementService = movementService;
	}

	@MessageMapping("/rooms/{roomCode}/movements/start")
	public void startMovement(
		@DestinationVariable String roomCode,
		@Valid @Payload StartRoomMovementRequest request,
		Principal principal
	) {
		movementService.startMovement(
			roomCode,
			authenticatedUser(principal),
			request
		);
	}

	@MessageMapping("/rooms/{roomCode}/movements/cancel")
	public void cancelMovement(
		@DestinationVariable String roomCode,
		@Valid @Payload CancelRoomMovementRequest request,
		Principal principal
	) {
		movementService.cancelMovement(
			roomCode,
			authenticatedUser(principal),
			request
		);
	}

	private UserEntity authenticatedUser(Principal principal) {
		if (!(principal instanceof Authentication authentication)) {
			throw new AccessDeniedException(
				"Authenticated WebSocket user is required"
			);
		}

		if (authentication.getPrincipal() instanceof UserEntity user) {
			return user;
		}

		throw new AccessDeniedException(
			"Authenticated WebSocket user is required"
		);
	}
}
