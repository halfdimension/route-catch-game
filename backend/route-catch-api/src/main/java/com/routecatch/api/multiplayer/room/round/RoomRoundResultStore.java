package com.routecatch.api.multiplayer.room.round;

import java.util.Optional;
import java.util.UUID;

public interface RoomRoundResultStore {

	FinalizedRoomRound saveIfAbsent(FinalizedRoomRound result);

	Optional<FinalizedRoomRound> find(String roomCode, UUID roundId);

	Optional<FinalizedRoomRound> findLatest(String roomCode);
}
