package com.routecatch.api.game.persistence;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.game.model.GameSessionStatus;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "game_sessions")
public class GameSessionEntity {

	@Id
	@Column(name = "session_id", nullable = false)
	private UUID sessionId;

	@Enumerated(EnumType.STRING)
	@Column(name = "status", length = 32, nullable = false)
	private GameSessionStatus status;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	@Column(name = "started_at")
	private Instant startedAt;

	@Column(name = "ended_at")
	private Instant endedAt;

	@Column(name = "duration_seconds", nullable = false)
	private int durationSeconds;

	@Column(name = "score", nullable = false)
	private int score;

	@Column(name = "caught_count", nullable = false)
	private int caughtCount;

	@Column(name = "player_name", length = 80, nullable = false)
	private String playerName;

	@Column(name = "user_id")
	private UUID userId;

	protected GameSessionEntity() {
	}

	public GameSessionEntity(UUID sessionId, int durationSeconds) {
		this(sessionId, durationSeconds, "Guest");
	}

	public GameSessionEntity(
		UUID sessionId,
		int durationSeconds,
		String playerName
	) {
		this.sessionId = sessionId;
		this.status = GameSessionStatus.CREATED;
		this.createdAt = Instant.now();
		this.durationSeconds = durationSeconds;
		this.playerName = playerName;
	}

	public void assignUser(UUID userId) {
		this.userId = userId;
	}

	public void start(Instant startTime) {
		status = GameSessionStatus.RUNNING;
		startedAt = startTime;
	}

	public void end(Instant endTime) {
		status = GameSessionStatus.ENDED;
		endedAt = endTime;
	}

	public boolean expireIfStale(Instant currentTime) {
		if (status != GameSessionStatus.RUNNING || startedAt == null) {
			return false;
		}

		Instant expiresAt = startedAt.plusSeconds(durationSeconds);

		if (!currentTime.isAfter(expiresAt)) {
			return false;
		}

		end(expiresAt);
		return true;
	}

	public void recordCatch(int scoreValue) {
		score += scoreValue;
		caughtCount += 1;
	}

	public UUID getSessionId() {
		return sessionId;
	}

	public GameSessionStatus getStatus() {
		return status;
	}

	public Instant getCreatedAt() {
		return createdAt;
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

	public int getScore() {
		return score;
	}

	public int getCaughtCount() {
		return caughtCount;
	}

	public String getPlayerName() {
		return playerName;
	}

	public UUID getUserId() {
		return userId;
	}
}
