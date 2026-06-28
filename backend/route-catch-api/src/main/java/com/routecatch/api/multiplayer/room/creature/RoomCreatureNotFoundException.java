package com.routecatch.api.multiplayer.room.creature;

import java.util.UUID;

public class RoomCreatureNotFoundException extends RuntimeException {

	public RoomCreatureNotFoundException(UUID instanceId) {
		super("Room creature not found: " + instanceId);
	}
}
