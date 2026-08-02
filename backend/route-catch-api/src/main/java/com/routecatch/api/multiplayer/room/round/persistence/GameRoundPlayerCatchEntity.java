package com.routecatch.api.multiplayer.room.round.persistence;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "game_round_player_catches")
public class GameRoundPlayerCatchEntity {

	@Id
	@Column(name = "game_round_player_catch_id", nullable = false)
	private UUID gameRoundPlayerCatchId;

	@Column(name = "game_round_player_id", nullable = false)
	private UUID gameRoundPlayerId;

	@Column(name = "creature_instance_id", nullable = false)
	private UUID creatureInstanceId;

	@Column(name = "creature_id", length = 64, nullable = false)
	private String creatureId;

	@Column(name = "creature_name", length = 100, nullable = false)
	private String creatureName;

	@Column(name = "rarity", length = 32, nullable = false)
	private String rarity;

	@Column(name = "score_awarded", nullable = false)
	private int scoreAwarded;

	@Column(name = "caught_at", nullable = false)
	private Instant caughtAt;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	protected GameRoundPlayerCatchEntity() {
	}

	public GameRoundPlayerCatchEntity(
		UUID gameRoundPlayerCatchId,
		UUID gameRoundPlayerId,
		UUID creatureInstanceId,
		String creatureId,
		String creatureName,
		String rarity,
		int scoreAwarded,
		Instant caughtAt,
		Instant createdAt
	) {
		this.gameRoundPlayerCatchId = gameRoundPlayerCatchId;
		this.gameRoundPlayerId = gameRoundPlayerId;
		this.creatureInstanceId = creatureInstanceId;
		this.creatureId = creatureId;
		this.creatureName = creatureName;
		this.rarity = rarity;
		this.scoreAwarded = scoreAwarded;
		this.caughtAt = caughtAt;
		this.createdAt = createdAt;
	}

	public UUID getGameRoundPlayerCatchId() {
		return gameRoundPlayerCatchId;
	}

	public UUID getGameRoundPlayerId() {
		return gameRoundPlayerId;
	}

	public UUID getCreatureInstanceId() {
		return creatureInstanceId;
	}

	public String getCreatureId() {
		return creatureId;
	}

	public String getCreatureName() {
		return creatureName;
	}

	public String getRarity() {
		return rarity;
	}

	public int getScoreAwarded() {
		return scoreAwarded;
	}

	public Instant getCaughtAt() {
		return caughtAt;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
