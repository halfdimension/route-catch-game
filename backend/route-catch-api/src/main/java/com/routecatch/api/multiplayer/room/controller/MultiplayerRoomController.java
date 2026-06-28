package com.routecatch.api.multiplayer.room.controller;

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
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.RoomGameStateResponse;
import com.routecatch.api.multiplayer.room.dto.RoomResponse;
import com.routecatch.api.multiplayer.room.dto.RoomScoreboardResponse;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/multiplayer/rooms")
public class MultiplayerRoomController {

	private final MultiplayerRoomService roomService;
	private final RoomScoreService scoreService;
	private final CurrentUserService currentUserService;

	public MultiplayerRoomController(
		MultiplayerRoomService roomService,
		RoomScoreService scoreService,
		CurrentUserService currentUserService
	) {
		this.roomService = roomService;
		this.scoreService = scoreService;
		this.currentUserService = currentUserService;
	}

	@PostMapping
	public RoomResponse createRoom(
		@Valid @RequestBody CreateRoomRequest request,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomResponse.from(roomService.createRoom(currentUser, request));
	}

	@GetMapping("/me")
	public List<RoomResponse> listMyRooms(Authentication authentication) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return roomService.listMyRooms(currentUser)
			.stream()
			.map(RoomResponse::from)
			.toList();
	}

	@GetMapping("/{roomCode}")
	public RoomResponse getRoom(@PathVariable String roomCode) {
		return RoomResponse.from(roomService.getRoom(roomCode));
	}

	@PostMapping("/{roomCode}/join")
	public RoomResponse joinRoom(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomResponse.from(roomService.joinRoom(roomCode, currentUser));
	}

	@PostMapping("/{roomCode}/leave")
	public RoomResponse leaveRoom(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomResponse.from(roomService.leaveRoom(roomCode, currentUser));
	}

	@PostMapping("/{roomCode}/close")
	public RoomResponse closeRoom(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomResponse.from(roomService.closeRoom(roomCode, currentUser));
	}

	@PostMapping("/{roomCode}/game/start")
	public RoomGameStateResponse startRoomGame(
		@PathVariable String roomCode,
		@Valid @RequestBody StartRoomGameRequest request,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomGameStateResponse.from(
			roomService.startGame(roomCode, currentUser, request)
		);
	}

	@GetMapping("/{roomCode}/game")
	public RoomGameStateResponse getRoomGameState(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomGameStateResponse.from(
			roomService.getGameState(roomCode, currentUser)
		);
	}

	@PostMapping("/{roomCode}/game/end")
	public RoomGameStateResponse endRoomGame(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return RoomGameStateResponse.from(
			roomService.endGame(roomCode, currentUser)
		);
	}

	@GetMapping("/{roomCode}/scoreboard")
	public RoomScoreboardResponse getScoreboard(
		@PathVariable String roomCode,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return scoreService.getScoreboard(roomCode, currentUser);
	}
}
