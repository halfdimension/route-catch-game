package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GameRoundPlayerCatchRepository
	extends JpaRepository<GameRoundPlayerCatchEntity, UUID> {

	List<GameRoundPlayerCatchEntity>
		findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
			UUID gameRoundPlayerId
		);

	long countByGameRoundPlayerId(UUID gameRoundPlayerId);
}
