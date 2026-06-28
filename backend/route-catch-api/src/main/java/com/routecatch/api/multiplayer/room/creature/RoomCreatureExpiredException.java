package com.routecatch.api.multiplayer.room.creature;

import java.util.UUID;

public class RoomCreatureExpiredException extends RuntimeException {

	public RoomCreatureExpiredException(UUID instanceId) {
		super("Room creature is expired: " + instanceId);
	}
}
