package com.routecatch.api.multiplayer.room.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record StartRoomGameRequest(
	@NotNull(message = "is required")
	@Min(value = 30, message = "must be at least 30")
	@Max(value = 600, message = "must be at most 600")
	Integer durationSeconds
) {
}
