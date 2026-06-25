package com.routecatch.api.multiplayer.room.creature;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record SpawnRoomCreaturesRequest(
	@NotNull(message = "is required")
	@DecimalMin(value = "-90.0", message = "must be at least -90")
	@DecimalMax(value = "90.0", message = "must be at most 90")
	Double centerLat,

	@NotNull(message = "is required")
	@DecimalMin(value = "-180.0", message = "must be at least -180")
	@DecimalMax(value = "180.0", message = "must be at most 180")
	Double centerLon,

	@NotNull(message = "is required")
	@Min(value = 1, message = "must be at least 1")
	@Max(value = 20, message = "must be at most 20")
	Integer count,

	@NotNull(message = "is required")
	@Min(value = 30, message = "must be at least 30")
	@Max(value = 600, message = "must be at most 600")
	Integer ttlSeconds,

	@NotNull(message = "is required")
	@DecimalMin(value = "20.0", message = "must be at least 20")
	@DecimalMax(value = "2000.0", message = "must be at most 2000")
	Double radiusMeters
) {
}
