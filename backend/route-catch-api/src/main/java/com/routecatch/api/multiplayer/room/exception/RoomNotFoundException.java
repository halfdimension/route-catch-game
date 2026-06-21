package com.routecatch.api.multiplayer.room.exception;

public class RoomNotFoundException extends RuntimeException {

	public RoomNotFoundException(String roomCode) {
		super("Multiplayer room not found: " + roomCode);
	}
}
