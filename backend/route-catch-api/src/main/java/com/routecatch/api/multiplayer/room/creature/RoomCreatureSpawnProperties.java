package com.routecatch.api.multiplayer.room.creature;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("multiplayer.creatures.auto-spawn")
public record RoomCreatureSpawnProperties(
	boolean enabled,
	Duration interval,
	int baseActiveCount,
	int perPlayerActiveCount,
	int maxActiveCount,
	int maxSpawnsPerCycle,
	double minRadiusMeters,
	double maxRadiusMeters,
	double minCreatureSeparationMeters,
	int maxPlacementAttempts,
	Duration creatureTtl
) {

	public RoomCreatureSpawnProperties {
		if (interval == null || interval.isZero() || interval.isNegative()) {
			throw new IllegalArgumentException("interval must be positive");
		}
		if (baseActiveCount < 0 || perPlayerActiveCount < 0) {
			throw new IllegalArgumentException("active counts cannot be negative");
		}
		if (maxActiveCount < 0 || maxSpawnsPerCycle < 1) {
			throw new IllegalArgumentException("spawn limits are invalid");
		}
		if (
			!Double.isFinite(minRadiusMeters) ||
			!Double.isFinite(maxRadiusMeters) ||
			minRadiusMeters < 0.0 ||
			maxRadiusMeters < minRadiusMeters
		) {
			throw new IllegalArgumentException("spawn radii are invalid");
		}
		if (
			!Double.isFinite(minCreatureSeparationMeters) ||
			minCreatureSeparationMeters < 0.0
		) {
			throw new IllegalArgumentException(
				"minimum creature separation is invalid"
			);
		}
		if (maxPlacementAttempts < 1) {
			throw new IllegalArgumentException(
				"max placement attempts must be positive"
			);
		}
		if (
			creatureTtl == null ||
			creatureTtl.isZero() ||
			creatureTtl.isNegative()
		) {
			throw new IllegalArgumentException("creature TTL must be positive");
		}
	}
}
