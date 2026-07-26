package com.routecatch.api.multiplayer.room.event;

public record RoomGameLifecycleEvent(
	String roomCode,
	long generation,
	Type type
) {

	public enum Type {
		STARTED,
		STOPPED,
		CLOSED
	}
}
