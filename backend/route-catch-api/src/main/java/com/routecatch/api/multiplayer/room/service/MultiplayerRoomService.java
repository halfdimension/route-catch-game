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
import com.routecatch.api.multiplayer.room.round.RoomRoundCoordinator;
import com.routecatch.api.multiplayer.room.round.RoomRoundFinalizationGateway;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;

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
	private final RoomRoundCoordinator roundCoordinator =
		new RoomRoundCoordinator();
	private volatile RoomRoundFinalizationGateway finalizationGateway;

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

	public MultiplayerRoom joinRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			if (room.getStatus() == MultiplayerRoomStatus.CLOSED) {
				throw new RoomClosedException(normalizeRoomCode(roomCode));
			}

			room.addMember(currentUser);
			return room;
		});
	}

	public MultiplayerRoom leaveRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			boolean hostLeaving = room.isHost(currentUser.getUserId());
			log.debug(
				"leave room request roomCode={} userId={} hostLeaving={}",
				room.getRoomCode(),
				currentUser.getUserId(),
				hostLeaving
			);
			room.removeMember(currentUser.getUserId());

			if (hostLeaving && room.getMembers().isEmpty()) {
				closeAuthoritatively(room);
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
		});
	}

	public MultiplayerRoom getRoom(String roomCode) {
		MultiplayerRoom room = rooms.get(normalizeRoomCode(roomCode));

		if (room == null) {
			throw new RoomNotFoundException(normalizeRoomCode(roomCode));
		}

		return room;
	}

	public MultiplayerRoom startGame(
		String roomCode,
		UserEntity currentUser,
		StartRoomGameRequest request
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			autoEndExpiredGame(room, Instant.now());

			if (room.getStatus() == MultiplayerRoomStatus.CLOSED) {
				throw new RoomClosedException(normalizeRoomCode(roomCode));
			}

			requireHost(room, currentUser);

			if (
				room.getGameState().getStatus() == RoomGameStatus.RUNNING ||
				room.getGameState().getStatus() == RoomGameStatus.FINALIZING
			) {
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
				currentUser,
				room.getMembers()
			);
			publishLifecycle(room, Type.STARTED);
			return room;
		});
	}

	public MultiplayerRoom getGameState(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			requireMember(room, currentUser);
			autoEndExpiredGame(room, Instant.now());
			return room;
		});
	}

	public MultiplayerRoom endGame(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			autoEndExpiredGame(room, Instant.now());
			requireHost(room, currentUser);
			finalizeOrLegacy(room, RoundEndReason.HOST_ENDED);
			return room;
		});
	}

	public List<MultiplayerRoom> listMyRooms(UserEntity currentUser) {
		return rooms.values()
			.stream()
			.filter((room) -> room.hasMember(currentUser.getUserId()))
			.sorted(Comparator.comparing(MultiplayerRoom::getCreatedAt).reversed())
			.toList();
	}

	public MultiplayerRoom closeRoom(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			requireHost(room, currentUser);
			closeAuthoritatively(room);
			return room;
		});
	}

	@Override
	public MultiplayerRoom refreshGameState(String roomCode) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			autoEndExpiredGame(room, Instant.now());
			return room;
		});
	}

	@Override
	public boolean isCurrentRoundRunning(
		String roomCode,
		long generation
	) {
		MultiplayerRoom room = refreshGameState(roomCode);
		return room.getStatus() == MultiplayerRoomStatus.IN_PROGRESS
			&& room.getGameState().getStatus() == RoomGameStatus.RUNNING
			&& room.getGameState().getGeneration() == generation;
	}

	public <T> Optional<T> withCurrentRoundRunning(
		String roomCode,
		long generation,
		Supplier<T> action
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			autoEndExpiredGame(room, Instant.now());

			if (
				room.getStatus() != MultiplayerRoomStatus.IN_PROGRESS ||
				room.getGameState().getStatus() != RoomGameStatus.RUNNING ||
				room.getGameState().getGeneration() != generation
			) {
				return Optional.empty();
			}

			return Optional.ofNullable(action.get());
		});
	}

	public MultiplayerRoom updateSettings(
		String roomCode,
		UserEntity currentUser,
		UpdateRoomSettingsRequest request
	) {
		MultiplayerRoom room = getRoom(roomCode);
		return roundCoordinator.withRoom(room.getRoomCode(), () -> {
			requireHost(room, currentUser);
			room.getGameplaySettings().update(
				request.maxSpeedMps(),
				request.allowPlayerSpeedControl(),
				request.allowManualCreatureSpawn()
			);
			return room;
		});
	}

	public RoomRoundCoordinator getRoundCoordinator() {
		return roundCoordinator;
	}

	public void registerFinalizationGateway(
		RoomRoundFinalizationGateway finalizationGateway
	) {
		this.finalizationGateway = finalizationGateway;
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
		if (gameState.getStatus() == RoomGameStatus.FINALIZING) {
			finalizeOrLegacy(room, RoundEndReason.TIME_EXPIRED);
			return;
		}

		if (
			gameState.getStatus() == RoomGameStatus.RUNNING &&
			gameState.getEndsAt() != null &&
			!gameState.getEndsAt().isAfter(now)
		) {
			finalizeOrLegacy(room, RoundEndReason.TIME_EXPIRED);
		}
	}

	private void closeAuthoritatively(MultiplayerRoom room) {
		if (
			room.getGameState().getStatus() == RoomGameStatus.RUNNING ||
			room.getGameState().getStatus() == RoomGameStatus.FINALIZING
		) {
			finalizeOrLegacy(room, RoundEndReason.ROOM_CLOSED);
			return;
		}

		room.close();
		publishLifecycle(room, Type.CLOSED);
	}

	private void finalizeOrLegacy(
		MultiplayerRoom room,
		RoundEndReason reason
	) {
		RoomGameState state = room.getGameState();

		if (finalizationGateway != null && state.getRoundId() != null) {
			finalizationGateway.finalizeRound(
				room.getRoomCode(),
				state.getRoundId(),
				state.getGeneration(),
				reason
			);
			return;
		}

		if (state.getStatus() == RoomGameStatus.RUNNING) {
			state.beginFinalizing(state.getRoundId(), state.getGeneration());
			state.end(
				reason == RoundEndReason.TIME_EXPIRED
					? state.getEndsAt()
					: Instant.now()
			);
			if (reason == RoundEndReason.ROOM_CLOSED) {
				room.close();
				publishLifecycle(room, Type.CLOSED);
			} else {
				room.markOpen();
				publishLifecycle(room, Type.STOPPED);
			}
		}
	}

	public void publishLifecycle(
		MultiplayerRoom room,
		RoomGameLifecycleEvent.Type type
	) {
		eventPublisher.publishEvent(new RoomGameLifecycleEvent(
			room.getRoomCode(),
			room.getGameState().getGeneration(),
			room.getGameState().getRoundId(),
			room.getGameState().getEndsAt(),
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
