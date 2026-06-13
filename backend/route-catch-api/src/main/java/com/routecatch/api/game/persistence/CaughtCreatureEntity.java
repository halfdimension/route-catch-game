package com.routecatch.api.game.persistence;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.game.creature.CreatureDefinition;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "caught_creatures")
public class CaughtCreatureEntity {

	@Id
	@Column(name = "catch_id", nullable = false)
	private UUID catchId;

	@Column(name = "session_id", nullable = false)
	private UUID sessionId;

	@Column(name = "creature_id", length = 64, nullable = false)
	private String creatureId;

	@Column(name = "creature_name", length = 100, nullable = false)
	private String creatureName;

	@Column(name = "rarity", length = 32, nullable = false)
	private String rarity;

	@Column(name = "score_value", nullable = false)
	private int scoreValue;

	@Column(name = "caught_at", nullable = false)
	private Instant caughtAt;

	protected CaughtCreatureEntity() {
	}

	public CaughtCreatureEntity(
		UUID sessionId,
		CreatureDefinition creature
	) {
		this.catchId = UUID.randomUUID();
		this.sessionId = sessionId;
		this.creatureId = creature.creatureId();
		this.creatureName = creature.creatureName();
		this.rarity = creature.rarity();
		this.scoreValue = creature.scoreValue();
		this.caughtAt = Instant.now();
	}

	public UUID getCatchId() {
		return catchId;
	}

	public UUID getSessionId() {
		return sessionId;
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

	public int getScoreValue() {
		return scoreValue;
	}

	public Instant getCaughtAt() {
		return caughtAt;
	}
}
