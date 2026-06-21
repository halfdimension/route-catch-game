package com.routecatch.api.multiplayer.room.exception;

public class RoomGameAlreadyRunningException extends RuntimeException {

	public RoomGameAlreadyRunningException(String roomCode) {
		super("Room game is already running: " + roomCode);
	}
}
