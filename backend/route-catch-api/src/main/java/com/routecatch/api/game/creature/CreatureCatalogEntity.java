package com.routecatch.api.game.creature;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "creature_catalog")
public class CreatureCatalogEntity {

	@Id
	@Column(name = "creature_id", length = 64, nullable = false)
	private String creatureId;

	@Column(name = "creature_name", length = 100, nullable = false)
	private String creatureName;

	@Column(name = "rarity", length = 32, nullable = false)
	private String rarity;

	@Column(name = "score_value", nullable = false)
	private int scoreValue;

	@Column(name = "created_at", nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	protected CreatureCatalogEntity() {
	}

	public CreatureCatalogEntity(
		String creatureId,
		String creatureName,
		String rarity,
		int scoreValue
	) {
		this.creatureId = creatureId;
		this.creatureName = creatureName;
		this.rarity = rarity;
		this.scoreValue = scoreValue;
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

	public Instant getCreatedAt() {
		return createdAt;
	}
}
