package com.routecatch.api.multiplayer.room.creature;

import java.util.UUID;

public class RoomCreatureAlreadyCaughtException extends RuntimeException {

	public RoomCreatureAlreadyCaughtException(UUID instanceId) {
		super("Room creature is already caught: " + instanceId);
	}
}
