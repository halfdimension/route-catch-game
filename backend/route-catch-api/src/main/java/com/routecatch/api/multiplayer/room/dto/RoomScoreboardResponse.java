package com.routecatch.api.multiplayer.room.dto;

import java.util.List;

import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

public record RoomScoreboardResponse(
	String roomCode,
	MultiplayerRoomStatus roomStatus,
	RoomGameStatus gameStatus,
	List<RoomScoreEntryResponse> entries
) {
}
