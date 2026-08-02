package com.routecatch.api.multiplayer.room.round.persistence;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "game_rounds")
public class GameRoundEntity {

	@Id
	@Column(name = "game_round_id", nullable = false)
	private UUID gameRoundId;

	@Column(name = "round_instance_id", nullable = false, unique = true)
	private UUID roundInstanceId;

	@Column(name = "room_code", length = 16, nullable = false)
	private String roomCode;

	@Column(name = "round_generation", nullable = false)
	private long roundGeneration;

	@Enumerated(EnumType.STRING)
	@Column(name = "status", length = 32, nullable = false)
	private RoomGameStatus status;

	@Enumerated(EnumType.STRING)
	@Column(name = "end_reason", length = 32, nullable = false)
	private RoundEndReason endReason;

	@Column(name = "started_at", nullable = false)
	private Instant startedAt;

	@Column(name = "ended_at", nullable = false)
	private Instant endedAt;

	@Column(name = "duration_seconds", nullable = false)
	private int durationSeconds;

	@Column(name = "participant_count", nullable = false)
	private int participantCount;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	protected GameRoundEntity() {
	}

	public GameRoundEntity(
		UUID gameRoundId,
		UUID roundInstanceId,
		String roomCode,
		long roundGeneration,
		RoomGameStatus status,
		RoundEndReason endReason,
		Instant startedAt,
		Instant endedAt,
		int durationSeconds,
		int participantCount,
		Instant createdAt
	) {
		this.gameRoundId = gameRoundId;
		this.roundInstanceId = roundInstanceId;
		this.roomCode = roomCode;
		this.roundGeneration = roundGeneration;
		this.status = status;
		this.endReason = endReason;
		this.startedAt = startedAt;
		this.endedAt = endedAt;
		this.durationSeconds = durationSeconds;
		this.participantCount = participantCount;
		this.createdAt = createdAt;
	}

	public UUID getGameRoundId() {
		return gameRoundId;
	}

	public UUID getRoundInstanceId() {
		return roundInstanceId;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public long getRoundGeneration() {
		return roundGeneration;
	}

	public RoomGameStatus getStatus() {
		return status;
	}

	public RoundEndReason getEndReason() {
		return endReason;
	}

	public Instant getStartedAt() {
		return startedAt;
	}

	public Instant getEndedAt() {
		return endedAt;
	}

	public int getDurationSeconds() {
		return durationSeconds;
	}

	public int getParticipantCount() {
		return participantCount;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
