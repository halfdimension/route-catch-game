package com.routecatch.api.multiplayer.room.round;

public record RoomRoundResultResponse(
	PublicRoundResult publicResult,
	PersonalRoundResult personalResult
) {
}
