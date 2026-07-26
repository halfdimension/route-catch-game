package com.routecatch.api.multiplayer.room.creature;

import java.util.UUID;

public record EligibleSpawnPlayer(
	UUID playerId,
	String displayName,
	GeoPoint position
) {
}
