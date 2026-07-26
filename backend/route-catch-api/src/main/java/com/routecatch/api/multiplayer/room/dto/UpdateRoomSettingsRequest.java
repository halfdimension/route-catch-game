package com.routecatch.api.multiplayer.room.dto;

import com.routecatch.api.multiplayer.room.model.RoomGameplaySettings;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record UpdateRoomSettingsRequest(
	@NotNull
	@Min(RoomGameplaySettings.MIN_MAX_SPEED_MPS)
	@Max(RoomGameplaySettings.MAX_MAX_SPEED_MPS)
	Integer maxSpeedMps,

	@NotNull
	Boolean allowPlayerSpeedControl,

	@NotNull
	Boolean allowManualCreatureSpawn
) {
}
