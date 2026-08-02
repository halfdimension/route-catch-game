package com.routecatch.api.multiplayer.room.round.persistence;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "game_round_players")
public class GameRoundPlayerEntity {

	@Id
	@Column(name = "game_round_player_id", nullable = false)
	private UUID gameRoundPlayerId;

	@Column(name = "game_round_id", nullable = false)
	private UUID gameRoundId;

	@Column(name = "user_id", nullable = false)
	private UUID userId;

	@Column(name = "leaderboard_position", nullable = false)
	private int leaderboardPosition;

	@Column(name = "display_name", length = 80, nullable = false)
	private String displayName;

	@Column(name = "final_score", nullable = false)
	private int finalScore;

	@Column(name = "final_rank", nullable = false)
	private int finalRank;

	@Column(name = "caught_total", nullable = false)
	private int caughtTotal;

	@Column(name = "common_catches", nullable = false)
	private int commonCatches;

	@Column(name = "rare_catches", nullable = false)
	private int rareCatches;

	@Column(name = "legendary_catches", nullable = false)
	private int legendaryCatches;

	@Column(name = "joined_at")
	private Instant joinedAt;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	protected GameRoundPlayerEntity() {
	}

	public GameRoundPlayerEntity(
		UUID gameRoundPlayerId,
		UUID gameRoundId,
		UUID userId,
		int leaderboardPosition,
		String displayName,
		int finalScore,
		int finalRank,
		int caughtTotal,
		int commonCatches,
		int rareCatches,
		int legendaryCatches,
		Instant joinedAt,
		Instant createdAt
	) {
		this.gameRoundPlayerId = gameRoundPlayerId;
		this.gameRoundId = gameRoundId;
		this.userId = userId;
		this.leaderboardPosition = leaderboardPosition;
		this.displayName = displayName;
		this.finalScore = finalScore;
		this.finalRank = finalRank;
		this.caughtTotal = caughtTotal;
		this.commonCatches = commonCatches;
		this.rareCatches = rareCatches;
		this.legendaryCatches = legendaryCatches;
		this.joinedAt = joinedAt;
		this.createdAt = createdAt;
	}

	public UUID getGameRoundPlayerId() {
		return gameRoundPlayerId;
	}

	public UUID getGameRoundId() {
		return gameRoundId;
	}

	public UUID getUserId() {
		return userId;
	}

	public int getLeaderboardPosition() {
		return leaderboardPosition;
	}

	public String getDisplayName() {
		return displayName;
	}

	public int getFinalScore() {
		return finalScore;
	}

	public int getFinalRank() {
		return finalRank;
	}

	public int getCaughtTotal() {
		return caughtTotal;
	}

	public int getCommonCatches() {
		return commonCatches;
	}

	public int getRareCatches() {
		return rareCatches;
	}

	public int getLegendaryCatches() {
		return legendaryCatches;
	}

	public Instant getJoinedAt() {
		return joinedAt;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
