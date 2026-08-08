package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;

public interface GameRoundPlayerRepository
	extends JpaRepository<GameRoundPlayerEntity, UUID> {

	List<GameRoundPlayerEntity>
		findAllByGameRoundIdOrderByLeaderboardPositionAsc(UUID gameRoundId);

	Optional<GameRoundPlayerEntity> findByGameRoundIdAndUserId(
		UUID gameRoundId,
		UUID userId
	);

	long countByGameRoundId(UUID gameRoundId);

	@Query(
		value = """
			select
				round.roundInstanceId as roundId,
				round.roomCode as roomCode,
				round.startedAt as startedAt,
				round.endedAt as endedAt,
				round.endReason as endReason,
				round.durationSeconds as durationSeconds,
				round.participantCount as participantCount,
				player.finalRank as rank,
				player.finalScore as score,
				player.caughtTotal as creaturesCaught
			from GameRoundPlayerEntity player
			join GameRoundEntity round
				on round.gameRoundId = player.gameRoundId
			where player.userId = :userId
				and round.status = :status
			order by round.endedAt desc, round.roundInstanceId desc
			""",
		countQuery = """
			select count(player)
			from GameRoundPlayerEntity player
			join GameRoundEntity round
				on round.gameRoundId = player.gameRoundId
			where player.userId = :userId
				and round.status = :status
			"""
	)
	Page<MultiplayerRoundHistoryProjection> findCompletedHistoryByUserId(
		@Param("userId") UUID userId,
		@Param("status") RoomGameStatus status,
		Pageable pageable
	);
}
