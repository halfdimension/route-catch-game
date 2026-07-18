package com.routecatch.api.multiplayer.room.movement.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record CancelRoomMovementRequest(
	@NotNull
	UUID movementId,

	@Positive
	long movementVersion,

	@NotNull
	UUID clientCommandId
) {
}
