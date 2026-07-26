package com.routecatch.api.multiplayer.room.event;

import java.time.Instant;
import java.util.UUID;

public record RoomGameLifecycleEvent(
	String roomCode,
	long generation,
	UUID roundId,
	Instant endsAt,
	Type type
) {

	public enum Type {
		STARTED,
		FINALIZING,
		STOPPED,
		CLOSED
	}
}
