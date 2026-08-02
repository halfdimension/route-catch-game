package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GameRoundRepository
	extends JpaRepository<GameRoundEntity, UUID> {

	Optional<GameRoundEntity> findByRoundInstanceId(UUID roundInstanceId);

	boolean existsByRoundInstanceId(UUID roundInstanceId);
}
