package com.routecatch.api.multiplayer.room.movement.controller;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.service.CurrentUserService;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementSnapshotResponse;
import com.routecatch.api.multiplayer.room.movement.service.RoomMovementService;

@RestController
@RequestMapping("/api/multiplayer/rooms/{roomCode}/movements")
public class RoomMovementRestController {

	private final RoomMovementService movementService;
	private final CurrentUserService currentUserService;

	public RoomMovementRestController(
		RoomMovementService movementService,
		CurrentUserService currentUserService
	) {
		this.movementService = movementService;
		this.currentUserService = currentUserService;
	}

	@GetMapping
	public RoomMovementSnapshotResponse getMovementSnapshot(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return movementService.getSnapshot(roomCode, currentUser);
	}
}
