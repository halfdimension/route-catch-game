package com.routecatch.api.multiplayer.room.service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.dto.UpdateRoomSettingsRequest;
import com.routecatch.api.multiplayer.room.creature.RoomRoundAccess;
import com.routecatch.api.multiplayer.room.exception.RoomClosedException;
import com.routecatch.api.multiplayer.room.exception.RoomForbiddenException;
import com.routecatch.api.multiplayer.room.exception.RoomGameAlreadyRunningException;
import com.routecatch.api.multiplayer.room.exception.RoomNotFoundException;
import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;
import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent.Type;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;
import com.routecatch.api.multiplayer.room.model.RoomGameState;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

@Service
public class MultiplayerRoomService implements RoomRoundAccess {

	private static final Logger log = LoggerFactory.getLogger(
		MultiplayerRoomService.class
	);
	private static final String ROOM_CODE_ALPHABET =
		"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	private static final int ROOM_CODE_LENGTH = 6;

	private final SecureRandom secureRandom = new SecureRandom();
	private final Map<String, MultiplayerRoom> rooms = new ConcurrentHashMap<>();
	private final ApplicationEventPublisher eventPublisher;

	public MultiplayerRoomService() {
		this((event) -> {});
	}

	@Autowired
	public MultiplayerRoomService(ApplicationEventPublisher eventPublisher) {
		this.eventPublisher = eventPublisher;
	}

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
		boolean hostLeaving = room.isHost(currentUser.getUserId());
		log.debug(
			"leave room request roomCode={} userId={} hostLeaving={}",
			room.getRoomCode(),
			currentUser.getUserId(),
			hostLeaving
		);
		room.removeMember(currentUser.getUserId());

		if (hostLeaving && room.getMembers().isEmpty()) {
			stopClosedRoom(room);
			log.debug(
				"no members left, room closed roomCode={}",
				room.getRoomCode()
			);
		} else if (hostLeaving) {
			log.debug(
				"new host selected roomCode={} hostUserId={} hostDisplayName={}",
				room.getRoomCode(),
				room.getHostUserId(),
				room.getHostDisplayName()
			);
		}

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
		publishLifecycle(room, Type.STARTED);
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
			room.markOpen();
			publishLifecycle(room, Type.STOPPED);
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

		stopClosedRoom(room);
		return room;
	}

	@Override
	public synchronized MultiplayerRoom refreshGameState(String roomCode) {
		MultiplayerRoom room = getRoom(roomCode);
		autoEndExpiredGame(room, Instant.now());
		return room;
	}

	@Override
	public synchronized boolean isCurrentRoundRunning(
		String roomCode,
		long generation
	) {
		MultiplayerRoom room = refreshGameState(roomCode);
		return room.getStatus() == MultiplayerRoomStatus.IN_PROGRESS
			&& room.getGameState().getStatus() == RoomGameStatus.RUNNING
			&& room.getGameState().getGeneration() == generation;
	}

	public synchronized <T> Optional<T> withCurrentRoundRunning(
		String roomCode,
		long generation,
		Supplier<T> action
	) {
		MultiplayerRoom room = getRoom(roomCode);
		autoEndExpiredGame(room, Instant.now());

		if (
			room.getStatus() != MultiplayerRoomStatus.IN_PROGRESS ||
			room.getGameState().getStatus() != RoomGameStatus.RUNNING ||
			room.getGameState().getGeneration() != generation
		) {
			return Optional.empty();
		}

		return Optional.ofNullable(action.get());
	}

	public synchronized MultiplayerRoom updateSettings(
		String roomCode,
		UserEntity currentUser,
		UpdateRoomSettingsRequest request
	) {
		MultiplayerRoom room = getRoom(roomCode);
		requireHost(room, currentUser);
		room.getGameplaySettings().update(
			request.maxSpeedMps(),
			request.allowPlayerSpeedControl(),
			request.allowManualCreatureSpawn()
		);
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
			room.markOpen();
			publishLifecycle(room, Type.STOPPED);
		}
	}

	private void stopClosedRoom(MultiplayerRoom room) {
		if (room.getGameState().getStatus() == RoomGameStatus.RUNNING) {
			room.getGameState().end(Instant.now());
		}

		room.close();
		publishLifecycle(room, Type.CLOSED);
	}

	private void publishLifecycle(
		MultiplayerRoom room,
		RoomGameLifecycleEvent.Type type
	) {
		eventPublisher.publishEvent(new RoomGameLifecycleEvent(
			room.getRoomCode(),
			room.getGameState().getGeneration(),
			type
		));
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
