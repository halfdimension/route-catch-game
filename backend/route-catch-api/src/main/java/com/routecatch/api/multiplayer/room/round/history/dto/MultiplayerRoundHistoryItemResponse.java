package com.routecatch.api.multiplayer.room.round.history.dto;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.persistence.MultiplayerRoundHistoryProjection;

public record MultiplayerRoundHistoryItemResponse(
	UUID roundId,
	String roomCode,
	Instant startedAt,
	Instant endedAt,
	RoundEndReason endReason,
	int durationSeconds,
	int participantCount,
	int rank,
	int score,
	int creaturesCaught
) {

	public static MultiplayerRoundHistoryItemResponse from(
		MultiplayerRoundHistoryProjection projection
	) {
		return new MultiplayerRoundHistoryItemResponse(
			projection.getRoundId(),
			projection.getRoomCode(),
			projection.getStartedAt(),
			projection.getEndedAt(),
			projection.getEndReason(),
			projection.getDurationSeconds(),
			projection.getParticipantCount(),
			projection.getRank(),
			projection.getScore(),
			projection.getCreaturesCaught()
		);
	}
}
