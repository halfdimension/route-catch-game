package com.routecatch.api.multiplayer.room.creature;

public record RoomCreatureEvent(
	RoomCreatureEventType eventType,
	String roomCode,
	String playerId,
	RoomCreatureResponse creature
) {
}
