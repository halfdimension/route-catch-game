package com.routecatch.api.multiplayer.room.model;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.auth.persistence.UserEntity;

public class RoomGameState {

	private final String roomCode;
	private RoomGameStatus status;
	private int durationSeconds;
	private Instant startedAt;
	private Instant endsAt;
	private Instant endedAt;
	private UUID startedByUserId;
	private String startedByDisplayName;

	public RoomGameState(String roomCode) {
		this.roomCode = roomCode;
		this.status = RoomGameStatus.WAITING;
		this.durationSeconds = 0;
	}

	public void start(
		int requestedDurationSeconds,
		Instant now,
		UserEntity currentUser
	) {
		status = RoomGameStatus.RUNNING;
		durationSeconds = requestedDurationSeconds;
		startedAt = now;
		endsAt = now.plusSeconds(requestedDurationSeconds);
		endedAt = null;
		startedByUserId = currentUser.getUserId();
		startedByDisplayName = currentUser.getDisplayName();
	}

	public void end(Instant endedAt) {
		status = RoomGameStatus.ENDED;
		this.endedAt = endedAt;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public RoomGameStatus getStatus() {
		return status;
	}

	public int getDurationSeconds() {
		return durationSeconds;
	}

	public Instant getStartedAt() {
		return startedAt;
	}

	public Instant getEndsAt() {
		return endsAt;
	}

	public Instant getEndedAt() {
		return endedAt;
	}

	public UUID getStartedByUserId() {
		return startedByUserId;
	}

	public String getStartedByDisplayName() {
		return startedByDisplayName;
	}
}
