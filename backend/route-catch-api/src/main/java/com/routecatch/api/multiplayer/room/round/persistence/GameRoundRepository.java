package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

public interface GameRoundRepository
	extends JpaRepository<GameRoundEntity, UUID> {

	Optional<GameRoundEntity> findByRoundInstanceId(UUID roundInstanceId);

	Optional<GameRoundEntity> findByRoundInstanceIdAndStatus(
		UUID roundInstanceId,
		RoomGameStatus status
	);

	Optional<GameRoundEntity>
		findFirstByRoomCodeAndStatusOrderByEndedAtDescRoundInstanceIdDesc(
			String roomCode,
			RoomGameStatus status
		);

	boolean existsByRoundInstanceId(UUID roundInstanceId);
}
