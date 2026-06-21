package com.routecatch.api.multiplayer.room.dto;

import java.time.Instant;
import java.util.List;

import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoomStatus;

public record RoomResponse(
	String roomCode,
	String roomName,
	String hostUserId,
	String hostDisplayName,
	MultiplayerRoomStatus status,
	Instant createdAt,
	List<RoomMemberResponse> members
) {

	public static RoomResponse from(MultiplayerRoom room) {
		return new RoomResponse(
			room.getRoomCode(),
			room.getRoomName(),
			room.getHostUserId().toString(),
			room.getHostDisplayName(),
			room.getStatus(),
			room.getCreatedAt(),
			room.getMembers().stream()
				.map(RoomMemberResponse::from)
				.toList()
		);
	}
}
