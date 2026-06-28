package com.routecatch.api.multiplayer.room.creature;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

public record CatchRoomCreatureRequest(
	@NotNull(message = "is required")
	@DecimalMin(value = "-90.0", message = "must be at least -90")
	@DecimalMax(value = "90.0", message = "must be at most 90")
	Double playerLat,

	@NotNull(message = "is required")
	@DecimalMin(value = "-180.0", message = "must be at least -180")
	@DecimalMax(value = "180.0", message = "must be at most 180")
	Double playerLon
) {
}
