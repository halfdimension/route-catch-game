package com.routecatch.api.multiplayer.room.creature;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface RoomPlayerPositionResolver {

	Optional<GeoPoint> resolveAuthoritativePosition(
		String roomCode,
		UUID playerId,
		Instant now
	);
}
