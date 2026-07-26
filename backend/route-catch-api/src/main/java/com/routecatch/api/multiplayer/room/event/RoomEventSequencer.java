package com.routecatch.api.multiplayer.room.event;

public interface RoomEventSequencer {

	long next(String roomCode);

	long current(String roomCode);
}
