package com.routecatch.api.multiplayer.room.creature;

import java.util.UUID;

public record RoomCreatureMovementTarget(
	UUID instanceId,
	double latitude,
	double longitude
) {
}
