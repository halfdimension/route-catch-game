package com.routecatch.api.multiplayer.room.creature;

import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;

public interface RoomRoundAccess {

	MultiplayerRoom refreshGameState(String roomCode);

	boolean isCurrentRoundRunning(String roomCode, long generation);
}
