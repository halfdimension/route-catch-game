package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.CaughtCreatureResult;
import com.routecatch.api.multiplayer.room.round.PersonalRoundResult;
import com.routecatch.api.multiplayer.room.round.PublicRoundResult;
import com.routecatch.api.multiplayer.room.round.RoomRoundResultResponse;
import com.routecatch.api.multiplayer.room.round.RoundLeaderboardEntry;
import com.routecatch.api.multiplayer.room.round.RoundLifecycleException;

@Component
class DurableCompletedRoundResultMapper {

	RoomRoundResultResponse map(
		GameRoundEntity round,
		List<GameRoundPlayerEntity> players,
		GameRoundPlayerEntity requester,
		List<GameRoundPlayerCatchEntity> catches
	) {
		validateRound(round, players);
		validateRequester(round, players, requester, catches);

		List<RoundLeaderboardEntry> leaderboard = players.stream()
			.map(player -> new RoundLeaderboardEntry(
				player.getUserId(),
				player.getDisplayName(),
				player.getFinalScore(),
				player.getFinalRank(),
				player.getCaughtTotal()
			))
			.toList();
		PublicRoundResult publicResult = new PublicRoundResult(
			round.getRoundInstanceId(),
			round.getRoomCode(),
			round.getStartedAt(),
			round.getEndedAt(),
			round.getEndReason(),
			round.getParticipantCount(),
			leaderboard
		);
		List<CaughtCreatureResult> caughtCreatures = catches.stream()
			.sorted(
				Comparator
					.comparing(GameRoundPlayerCatchEntity::getCaughtAt)
					.thenComparing(
						GameRoundPlayerCatchEntity::getCreatureInstanceId
					)
			)
			.map(caught -> new CaughtCreatureResult(
				caught.getCreatureInstanceId(),
				caught.getCreatureId(),
				caught.getCreatureName(),
				caught.getRarity(),
				caught.getScoreAwarded(),
				caught.getCaughtAt()
			))
			.toList();
		PersonalRoundResult personalResult = new PersonalRoundResult(
			round.getRoundInstanceId(),
			round.getRoomCode(),
			requester.getUserId(),
			requester.getDisplayName(),
			requester.getFinalScore(),
			requester.getFinalRank(),
			round.getParticipantCount(),
			requester.getCaughtTotal(),
			rarityCounts(requester),
			caughtCreatures,
			round.getStartedAt(),
			round.getEndedAt(),
			round.getEndReason()
		);

		return new RoomRoundResultResponse(publicResult, personalResult);
	}

	void validateRound(
		GameRoundEntity round,
		List<GameRoundPlayerEntity> players
	) {
		validateRoundMetadata(round);
		if (
			players == null ||
			round.getParticipantCount() != players.size()
		) {
			throw unavailable();
		}

		Set<UUID> playerIds = new HashSet<>();
		Set<UUID> playerRowIds = new HashSet<>();
		for (int index = 0; index < players.size(); index += 1) {
			GameRoundPlayerEntity player = players.get(index);
			if (
				player == null ||
				!round.getGameRoundId().equals(player.getGameRoundId()) ||
				player.getLeaderboardPosition() != index + 1 ||
				player.getGameRoundPlayerId() == null ||
				player.getUserId() == null ||
				player.getDisplayName() == null ||
				player.getDisplayName().isBlank() ||
				player.getFinalScore() < 0 ||
				player.getFinalRank() <= 0 ||
				player.getCaughtTotal() < 0 ||
				player.getCommonCatches() < 0 ||
				player.getRareCatches() < 0 ||
				player.getLegendaryCatches() < 0 ||
				!playerRowIds.add(player.getGameRoundPlayerId()) ||
				!playerIds.add(player.getUserId())
			) {
				throw unavailable();
			}
		}
	}

	void validateRoundMetadata(GameRoundEntity round) {
		if (
			round == null ||
			round.getStatus() != RoomGameStatus.ENDED ||
			round.getGameRoundId() == null ||
			round.getRoundInstanceId() == null ||
			round.getRoomCode() == null ||
			round.getRoomCode().isBlank() ||
			round.getStartedAt() == null ||
			round.getEndedAt() == null ||
			round.getEndedAt().isBefore(round.getStartedAt()) ||
			round.getEndReason() == null ||
			round.getRoundGeneration() <= 0 ||
			round.getDurationSeconds() <= 0 ||
			round.getParticipantCount() < 0
		) {
			throw unavailable();
		}
	}

	private void validateRequester(
		GameRoundEntity round,
		List<GameRoundPlayerEntity> players,
		GameRoundPlayerEntity requester,
		List<GameRoundPlayerCatchEntity> catches
	) {
		if (
			requester == null ||
			catches == null ||
			!round.getGameRoundId().equals(requester.getGameRoundId()) ||
			players.stream().noneMatch(player ->
				Objects.equals(
					player.getGameRoundPlayerId(),
					requester.getGameRoundPlayerId()
				)
			) ||
			requester.getCaughtTotal() != catches.size() ||
			requester.getCaughtTotal() != (
				(long) requester.getCommonCatches() +
					requester.getRareCatches() +
					requester.getLegendaryCatches()
			)
		) {
			throw unavailable();
		}

		int common = 0;
		int rare = 0;
		int legendary = 0;
		long score = 0;

		for (GameRoundPlayerCatchEntity caught : catches) {
			if (
				caught == null ||
				caught.getCreatureInstanceId() == null ||
				caught.getCreatureId() == null ||
				caught.getCreatureId().isBlank() ||
				caught.getCreatureName() == null ||
				caught.getCreatureName().isBlank() ||
				caught.getRarity() == null ||
				caught.getScoreAwarded() < 0 ||
				caught.getCaughtAt() == null ||
				!requester.getGameRoundPlayerId().equals(
					caught.getGameRoundPlayerId()
				)
			) {
				throw unavailable();
			}

			switch (caught.getRarity()) {
				case "common" -> common += 1;
				case "rare" -> rare += 1;
				case "legendary" -> legendary += 1;
				default -> throw unavailable();
			}
			score += caught.getScoreAwarded();
		}

		if (
			common != requester.getCommonCatches() ||
			rare != requester.getRareCatches() ||
			legendary != requester.getLegendaryCatches() ||
			score != requester.getFinalScore()
		) {
			throw unavailable();
		}
	}

	private Map<String, Integer> rarityCounts(
		GameRoundPlayerEntity requester
	) {
		Map<String, Integer> counts = new LinkedHashMap<>();
		putPositive(counts, "common", requester.getCommonCatches());
		putPositive(counts, "rare", requester.getRareCatches());
		putPositive(counts, "legendary", requester.getLegendaryCatches());
		return counts;
	}

	private void putPositive(
		Map<String, Integer> counts,
		String rarity,
		int count
	) {
		if (count > 0) {
			counts.put(rarity, count);
		}
	}

	private RoundLifecycleException unavailable() {
		return new RoundLifecycleException(
			"ROUND_RESULT_UNAVAILABLE",
			"Completed round result is unavailable",
			HttpStatus.INTERNAL_SERVER_ERROR
		);
	}
}
