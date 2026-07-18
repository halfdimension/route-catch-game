package com.routecatch.api.multiplayer.room.creature;

import java.time.Instant;
import java.util.UUID;

public class RoomCreatureInstance {

	private final UUID instanceId;
	private final String roomCode;
	private final String creatureId;
	private final String name;
	private final String rarity;
	private final int scoreValue;
	private final double latitude;
	private final double longitude;
	private final Instant spawnedAt;
	private final Instant expiresAt;
	private RoomCreatureStatus status = RoomCreatureStatus.ACTIVE;
	private UUID caughtByUserId;
	private String caughtByDisplayName;
	private Instant caughtAt;

	public RoomCreatureInstance(
		UUID instanceId,
		String roomCode,
		String creatureId,
		String name,
		String rarity,
		int scoreValue,
		double latitude,
		double longitude,
		Instant spawnedAt,
		Instant expiresAt
	) {
		this.instanceId = instanceId;
		this.roomCode = roomCode;
		this.creatureId = creatureId;
		this.name = name;
		this.rarity = rarity;
		this.scoreValue = scoreValue;
		this.latitude = latitude;
		this.longitude = longitude;
		this.spawnedAt = spawnedAt;
		this.expiresAt = expiresAt;
	}

	public boolean isExpired(Instant now) {
		return status == RoomCreatureStatus.EXPIRED || !expiresAt.isAfter(now);
	}

	public void markCaught(
		UUID caughtByUserId,
		String caughtByDisplayName,
		Instant caughtAt
	) {
		this.status = RoomCreatureStatus.CAUGHT;
		this.caughtByUserId = caughtByUserId;
		this.caughtByDisplayName = caughtByDisplayName;
		this.caughtAt = caughtAt;
	}

	public void markExpired() {
		this.status = RoomCreatureStatus.EXPIRED;
	}

	public UUID getInstanceId() {
		return instanceId;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public String getCreatureId() {
		return creatureId;
	}

	public String getName() {
		return name;
	}

	public String getRarity() {
		return rarity;
	}

	public int getScoreValue() {
		return scoreValue;
	}

	public double getLatitude() {
		return latitude;
	}

	public double getLongitude() {
		return longitude;
	}

	public Instant getSpawnedAt() {
		return spawnedAt;
	}

	public Instant getExpiresAt() {
		return expiresAt;
	}

	public RoomCreatureStatus getStatus() {
		return status;
	}

	public boolean isCaught() {
		return status == RoomCreatureStatus.CAUGHT;
	}

	public UUID getCaughtByUserId() {
		return caughtByUserId;
	}

	public String getCaughtByDisplayName() {
		return caughtByDisplayName;
	}

	public Instant getCaughtAt() {
		return caughtAt;
	}
}
