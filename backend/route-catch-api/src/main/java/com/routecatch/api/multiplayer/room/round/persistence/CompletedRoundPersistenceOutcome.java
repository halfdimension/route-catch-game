package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.UUID;

public record CompletedRoundPersistenceOutcome(
	boolean created,
	UUID gameRoundId,
	UUID roundInstanceId
) {
}
