package com.routecatch.api.multiplayer.room.round;

import java.util.UUID;

import com.routecatch.api.multiplayer.room.model.RoomMember;

public record RoundParticipant(
	UUID playerId,
	String username,
	String displayName
) {

	public static RoundParticipant from(RoomMember member) {
		return new RoundParticipant(
			member.getUserId(),
			member.getUsername(),
			member.getDisplayName()
		);
	}
}
