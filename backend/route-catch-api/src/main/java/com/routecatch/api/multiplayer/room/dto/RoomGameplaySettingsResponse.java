package com.routecatch.api.multiplayer.room.dto;

import com.routecatch.api.multiplayer.room.model.RoomGameplaySettings;

public record RoomGameplaySettingsResponse(
	int maxSpeedMps,
	boolean allowPlayerSpeedControl,
	boolean allowManualCreatureSpawn
) {

	public static RoomGameplaySettingsResponse from(
		RoomGameplaySettings settings
	) {
		return new RoomGameplaySettingsResponse(
			settings.getMaxSpeedMps(),
			settings.isAllowPlayerSpeedControl(),
			settings.isAllowManualCreatureSpawn()
		);
	}
}
