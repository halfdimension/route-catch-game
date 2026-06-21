package com.routecatch.api.multiplayer.room.exception;

public class RoomClosedException extends RuntimeException {

	public RoomClosedException(String roomCode) {
		super("Multiplayer room is closed: " + roomCode);
	}
}
