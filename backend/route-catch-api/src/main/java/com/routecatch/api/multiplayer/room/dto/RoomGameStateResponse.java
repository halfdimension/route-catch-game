package com.routecatch.api.multiplayer.room.dto;

import java.time.Duration;
import java.time.Instant;

import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;
import com.routecatch.api.multiplayer.room.model.RoomGameState;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

public record RoomGameStateResponse(
	String roomCode,
	MultiplayerRoomStatus roomStatus,
	RoomGameStatus gameStatus,
	int durationSeconds,
	Instant startedAt,
	Instant endsAt,
	Instant endedAt,
	long remainingSeconds,
	String startedByUserId,
	String startedByDisplayName
) {

	public static RoomGameStateResponse from(MultiplayerRoom room) {
		return from(room, Instant.now());
	}

	public static RoomGameStateResponse from(MultiplayerRoom room, Instant now) {
		RoomGameState gameState = room.getGameState();
		return new RoomGameStateResponse(
			room.getRoomCode(),
			room.getStatus(),
			gameState.getStatus(),
			gameState.getDurationSeconds(),
			gameState.getStartedAt(),
			gameState.getEndsAt(),
			gameState.getEndedAt(),
			remainingSeconds(gameState, now),
			gameState.getStartedByUserId() == null
				? null
				: gameState.getStartedByUserId().toString(),
			gameState.getStartedByDisplayName()
		);
	}

	private static long remainingSeconds(RoomGameState gameState, Instant now) {
		if (
			gameState.getStatus() != RoomGameStatus.RUNNING ||
			gameState.getEndsAt() == null ||
			!gameState.getEndsAt().isAfter(now)
		) {
			return 0;
		}

		return Duration.between(now, gameState.getEndsAt()).toSeconds();
	}
}
