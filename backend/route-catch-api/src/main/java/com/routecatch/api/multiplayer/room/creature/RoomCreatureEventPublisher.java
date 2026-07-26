package com.routecatch.api.multiplayer.room.creature;

public interface RoomCreatureEventPublisher {
	void publish(String roomCode, RoomCreatureEvent event);
}
