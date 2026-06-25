package com.routecatch.api.multiplayer.room.creature;

public class RoomGameNotRunningException extends RuntimeException {

	public RoomGameNotRunningException(String roomCode) {
		super("Room game is not running: " + roomCode);
	}
}
