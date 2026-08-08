package com.routecatch.api.multiplayer.room.round.persistence;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.multiplayer.room.round.RoundEndReason;

public interface MultiplayerRoundHistoryProjection {

	UUID getRoundId();

	String getRoomCode();

	Instant getStartedAt();

	Instant getEndedAt();

	RoundEndReason getEndReason();

	int getDurationSeconds();

	int getParticipantCount();

	int getRank();

	int getScore();

	int getCreaturesCaught();
}
