package com.routecatch.api.multiplayer.room.dto;

import java.time.Instant;

import com.routecatch.api.multiplayer.room.model.RoomMember;

public record RoomMemberResponse(
	String userId,
	String username,
	String displayName,
	Instant joinedAt,
	boolean host
) {

	public static RoomMemberResponse from(RoomMember member) {
		return new RoomMemberResponse(
			member.getUserId().toString(),
			member.getUsername(),
			member.getDisplayName(),
			member.getJoinedAt(),
			member.isHost()
		);
	}
}
