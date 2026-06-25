package com.routecatch.api.multiplayer.room.service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.exception.RoomClosedException;
import com.routecatch.api.multiplayer.room.exception.RoomForbiddenException;
import com.routecatch.api.multiplayer.room.exception.RoomGameAlreadyRunningException;
import com.routecatch.api.multiplayer.room.exception.RoomNotFoundException;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;
import com.routecatch.api.multiplayer.room.model.RoomGameState;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

@Service
public class MultiplayerRoomService {

	private static final String ROOM_CODE_ALPHABET =
		"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	private static final int ROOM_CODE_LENGTH = 6;

	private final SecureRandom secureRandom = new SecureRandom();
	private final Map<String, MultiplayerRoom> rooms = new ConcurrentHashMap<>();

	public synchronized MultiplayerRoom createRoom(
		UserEntity currentUser,
		CreateRoomRequest request
	) {
		MultiplayerRoom room = new MultiplayerRoom(
			generateRoomCode(),
			request.roomName().trim(),
			currentUser
		);
		rooms.put(room.getRoomCode(), room);
		return room;
	}

	public synchronized MultiplayerRoom joinRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);

		if (room.getStatus() == MultiplayerRoomStatus.CLOSED) {
			throw new RoomClosedException(normalizeRoomCode(roomCode));
		}

		room.addMember(currentUser);
		return room;
	}

	public synchronized MultiplayerRoom leaveRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		room.removeMember(currentUser.getUserId());
		return room;
	}

	public MultiplayerRoom getRoom(String roomCode) {
		MultiplayerRoom room = rooms.get(normalizeRoomCode(roomCode));

		if (room == null) {
			throw new RoomNotFoundException(normalizeRoomCode(roomCode));
		}

		return room;
	}

	public synchronized MultiplayerRoom startGame(
		String roomCode,
		UserEntity currentUser,
		StartRoomGameRequest request
	) {
		MultiplayerRoom room = getRoom(roomCode);
		autoEndExpiredGame(room, Instant.now());

		if (room.getStatus() == MultiplayerRoomStatus.CLOSED) {
			throw new RoomClosedException(normalizeRoomCode(roomCode));
		}

		requireHost(room, currentUser);

		if (room.getGameState().getStatus() == RoomGameStatus.RUNNING) {
			throw new RoomGameAlreadyRunningException(room.getRoomCode());
		}

		if (room.getStatus() != MultiplayerRoomStatus.OPEN) {
			throw new RoomClosedException(normalizeRoomCode(roomCode));
		}

		if (room.getMembers().isEmpty()) {
			throw new RoomClosedException(normalizeRoomCode(roomCode));
		}

		room.markInProgress();
		room.getGameState().start(
			request.durationSeconds(),
			Instant.now(),
			currentUser
		);
		return room;
	}

	public synchronized MultiplayerRoom getGameState(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		requireMember(room, currentUser);
		autoEndExpiredGame(room, Instant.now());
		return room;
	}

	public synchronized MultiplayerRoom endGame(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		autoEndExpiredGame(room, Instant.now());
		requireHost(room, currentUser);

		if (room.getGameState().getStatus() == RoomGameStatus.RUNNING) {
			room.getGameState().end(Instant.now());
			room.close();
		}

		return room;
	}

	public List<MultiplayerRoom> listMyRooms(UserEntity currentUser) {
		return rooms.values()
			.stream()
			.filter((room) -> room.hasMember(currentUser.getUserId()))
			.sorted(Comparator.comparing(MultiplayerRoom::getCreatedAt).reversed())
			.toList();
	}

	public synchronized MultiplayerRoom closeRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);

		requireHost(room, currentUser);

		room.close();
		return room;
	}

	private void requireHost(MultiplayerRoom room, UserEntity currentUser) {
		if (!room.isHost(currentUser.getUserId())) {
			throw new RoomForbiddenException(
				"Only the room host can perform this action"
			);
		}
	}

	private void requireMember(MultiplayerRoom room, UserEntity currentUser) {
		if (!room.hasMember(currentUser.getUserId())) {
			throw new RoomForbiddenException("Only room members can read this room");
		}
	}

	private void autoEndExpiredGame(MultiplayerRoom room, Instant now) {
		RoomGameState gameState = room.getGameState();

		if (
			gameState.getStatus() == RoomGameStatus.RUNNING &&
			gameState.getEndsAt() != null &&
			!gameState.getEndsAt().isAfter(now)
		) {
			gameState.end(gameState.getEndsAt());
			room.close();
		}
	}

	private String generateRoomCode() {
		String roomCode;

		do {
			roomCode = randomRoomCode();
		} while (rooms.containsKey(roomCode));

		return roomCode;
	}

	private String randomRoomCode() {
		StringBuilder roomCode = new StringBuilder(ROOM_CODE_LENGTH);

		for (int index = 0; index < ROOM_CODE_LENGTH; index += 1) {
			roomCode.append(ROOM_CODE_ALPHABET.charAt(
				secureRandom.nextInt(ROOM_CODE_ALPHABET.length())
			));
		}

		return roomCode.toString();
	}

	private String normalizeRoomCode(String roomCode) {
		return roomCode.trim().toUpperCase();
	}
}
