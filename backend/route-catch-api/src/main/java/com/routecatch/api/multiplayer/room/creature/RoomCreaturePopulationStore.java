package com.routecatch.api.multiplayer.room.creature;

import java.util.List;
import java.util.Optional;

public interface RoomCreaturePopulationStore {

	List<RoomCreatureInstance> activeCreatures(String roomCode);

	Optional<RoomCreatureInstance> createAutomaticCreature(
		String roomCode,
		long generation,
		GeoPoint snappedPoint,
		String anchorPlayerId
	);

	void clearRoom(String roomCode);
}
