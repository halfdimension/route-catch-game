package com.routecatch.api.multiplayer.room.model;

import java.time.Instant;
import java.util.UUID;

public class RoomScoreEntry {

	private final String roomCode;
	private final UUID userId;
	private final String username;
	private final String displayName;
	private int score;
	private int catches;
	private Instant lastCatchAt;

	public RoomScoreEntry(
		String roomCode,
		UUID userId,
		String username,
		String displayName
	) {
		this.roomCode = roomCode;
		this.userId = userId;
		this.username = username;
		this.displayName = displayName;
	}

	public void awardCatch(int scoreValue, Instant caughtAt) {
		score += scoreValue;
		catches += 1;
		lastCatchAt = caughtAt;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public UUID getUserId() {
		return userId;
	}

	public String getUsername() {
		return username;
	}

	public String getDisplayName() {
		return displayName;
	}

	public int getScore() {
		return score;
	}

	public int getCatches() {
		return catches;
	}

	public Instant getLastCatchAt() {
		return lastCatchAt;
	}
}
