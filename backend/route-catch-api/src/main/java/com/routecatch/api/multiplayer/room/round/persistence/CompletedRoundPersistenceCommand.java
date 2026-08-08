package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.Objects;

import com.routecatch.api.multiplayer.room.round.FinalizedRoomRound;

/**
 * Immutable persistence input. The finalized result is authoritative; the
 * configured duration is supplied separately because it is not currently part
 * of {@link FinalizedRoomRound}.
 */
public record CompletedRoundPersistenceCommand(
	FinalizedRoomRound finalizedRound,
	int durationSeconds
) {

	public CompletedRoundPersistenceCommand {
		Objects.requireNonNull(finalizedRound, "finalizedRound is required");

		if (durationSeconds <= 0) {
			throw new IllegalArgumentException(
				"durationSeconds must be positive"
			);
		}
	}
}
