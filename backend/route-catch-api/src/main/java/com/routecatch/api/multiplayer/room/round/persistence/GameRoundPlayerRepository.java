package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GameRoundPlayerRepository
	extends JpaRepository<GameRoundPlayerEntity, UUID> {

	List<GameRoundPlayerEntity>
		findAllByGameRoundIdOrderByLeaderboardPositionAsc(UUID gameRoundId);

	Optional<GameRoundPlayerEntity> findByGameRoundIdAndUserId(
		UUID gameRoundId,
		UUID userId
	);

	long countByGameRoundId(UUID gameRoundId);
}
