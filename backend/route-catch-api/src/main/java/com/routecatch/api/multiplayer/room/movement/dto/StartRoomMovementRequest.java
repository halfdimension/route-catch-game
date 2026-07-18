package com.routecatch.api.multiplayer.room.movement.dto;

import java.util.UUID;

import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

public record StartRoomMovementRequest(
	@NotNull
	@DecimalMin(value = "-90.0", message = "must be between -90 and 90")
	@DecimalMax(value = "90.0", message = "must be between -90 and 90")
	Double destinationLat,

	@NotNull
	@DecimalMin(value = "-180.0", message = "must be between -180 and 180")
	@DecimalMax(value = "180.0", message = "must be between -180 and 180")
	Double destinationLon,

	@NotNull
	@Positive
	Double requestedSpeedMps,

	@NotNull
	MovementDestinationType destinationType,

	UUID targetCreatureInstanceId,

	@NotNull
	UUID clientCommandId,

	@PositiveOrZero
	Long expectedMovementVersion
) {
}
