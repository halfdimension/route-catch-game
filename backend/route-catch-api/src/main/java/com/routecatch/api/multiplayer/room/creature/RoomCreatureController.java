package com.routecatch.api.multiplayer.room.creature;

import java.time.Instant;
import java.util.List;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.service.CurrentUserService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/multiplayer/rooms/{roomCode}/creatures")
public class RoomCreatureController {

	private final RoomCreatureService roomCreatureService;
	private final CurrentUserService currentUserService;

	public RoomCreatureController(
		RoomCreatureService roomCreatureService,
		CurrentUserService currentUserService
	) {
		this.roomCreatureService = roomCreatureService;
		this.currentUserService = currentUserService;
	}

	@PostMapping("/spawn")
	public List<RoomCreatureResponse> spawnCreatures(
		@PathVariable String roomCode,
		@Valid @RequestBody SpawnRoomCreaturesRequest request,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		Instant now = Instant.now();
		return roomCreatureService.spawnCreatures(roomCode, currentUser, request)
			.stream()
			.map((creature) -> RoomCreatureResponse.from(creature, now))
			.toList();
	}

	@GetMapping
	public List<RoomCreatureResponse> listCreatures(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		Instant now = Instant.now();
		return roomCreatureService.listCreatures(roomCode, currentUser)
			.stream()
			.map((creature) -> RoomCreatureResponse.from(creature, now))
			.toList();
	}
}
