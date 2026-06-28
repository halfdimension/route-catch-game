package com.routecatch.api.multiplayer.room.dto;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.multiplayer.room.model.RoomMember;
import com.routecatch.api.multiplayer.room.model.RoomScoreEntry;

public record RoomScoreEntryResponse(
	UUID userId,
	String username,
	String displayName,
	boolean host,
	int score,
	int catches,
	Instant lastCatchAt
) {

	public static RoomScoreEntryResponse from(
		RoomMember member,
		RoomScoreEntry scoreEntry
	) {
		return new RoomScoreEntryResponse(
			member.getUserId(),
			member.getUsername(),
			member.getDisplayName(),
			member.isHost(),
			scoreEntry.getScore(),
			scoreEntry.getCatches(),
			scoreEntry.getLastCatchAt()
		);
	}
}
