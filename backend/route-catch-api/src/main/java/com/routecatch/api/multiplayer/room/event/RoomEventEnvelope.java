package com.routecatch.api.multiplayer.room.event;

import java.time.Instant;
import java.util.UUID;

public record RoomEventEnvelope<T>(
	UUID eventId,
	String roomCode,
	long roomSequence,
	RoomEventType eventType,
	Instant serverTimestamp,
	T payload
) {
}
