package com.routecatch.api.multiplayer.room.round.persistence;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.CaughtCreatureResult;
import com.routecatch.api.multiplayer.room.round.FinalizedRoomRound;
import com.routecatch.api.multiplayer.room.round.PersonalRoundResult;
import com.routecatch.api.multiplayer.room.round.PublicRoundResult;
import com.routecatch.api.multiplayer.room.round.RoundLeaderboardEntry;

@Component
public class CompletedRoundPersistenceMapper {

	private static final Set<String> PERSISTED_RARITIES = Set.of(
		"common",
		"rare",
		"legendary"
	);

	MappedCompletedRound map(CompletedRoundPersistenceCommand command) {
		FinalizedRoomRound finalized = command.finalizedRound();
		PublicRoundResult publicResult = Objects.requireNonNull(
			finalized.publicResult(),
			"publicResult is required"
		);
		validateRound(finalized, publicResult);

		UUID gameRoundId = UUID.randomUUID();
		Instant createdAt = Instant.now();
		GameRoundEntity round = new GameRoundEntity(
			gameRoundId,
			publicResult.roundId(),
			publicResult.roomCode(),
			finalized.generation(),
			RoomGameStatus.ENDED,
			publicResult.endReason(),
			publicResult.startedAt(),
			publicResult.endedAt(),
			command.durationSeconds(),
			publicResult.playerCount(),
			createdAt
		);
		List<MappedCompletedRoundPlayer> players = new ArrayList<>();

		for (
			int index = 0;
			index < publicResult.leaderboard().size();
			index += 1
		) {
			RoundLeaderboardEntry leaderboardEntry =
				publicResult.leaderboard().get(index);
			PersonalRoundResult personal = finalized.personalResults().get(
				leaderboardEntry.playerId()
			);
			validatePersonalResult(publicResult, leaderboardEntry, personal);

			UUID gameRoundPlayerId = UUID.randomUUID();
			Map<String, Integer> rarityCounts = personal.rarityCounts();
			GameRoundPlayerEntity player = new GameRoundPlayerEntity(
				gameRoundPlayerId,
				gameRoundId,
				leaderboardEntry.playerId(),
				index + 1,
				personal.displayName(),
				personal.score(),
				personal.rank(),
				personal.creaturesCaught(),
				rarityCount(rarityCounts, "common"),
				rarityCount(rarityCounts, "rare"),
				rarityCount(rarityCounts, "legendary"),
				null,
				createdAt
			);
			List<GameRoundPlayerCatchEntity> catches = personal
				.caughtCreatures()
				.stream()
				.map(caught -> mapCatch(gameRoundPlayerId, caught, createdAt))
				.toList();
			players.add(new MappedCompletedRoundPlayer(player, catches));
		}

		return new MappedCompletedRound(round, players);
	}

	private void validateRound(
		FinalizedRoomRound finalized,
		PublicRoundResult publicResult
	) {
		requirePositive(finalized.generation(), "generation");
		Objects.requireNonNull(publicResult.roundId(), "roundId is required");
		requireText(publicResult.roomCode(), 16, "roomCode");
		Objects.requireNonNull(publicResult.startedAt(), "startedAt is required");
		Objects.requireNonNull(publicResult.endedAt(), "endedAt is required");
		Objects.requireNonNull(publicResult.endReason(), "endReason is required");

		if (publicResult.playerCount() < 0) {
			throw invalid("playerCount must be non-negative");
		}
		if (publicResult.playerCount() != publicResult.leaderboard().size()) {
			throw invalid("playerCount must match the public leaderboard size");
		}
		if (publicResult.playerCount() != finalized.personalResults().size()) {
			throw invalid("public and personal participant counts must match");
		}

		Set<UUID> publicPlayerIds = new HashSet<>();
		for (RoundLeaderboardEntry entry : publicResult.leaderboard()) {
			Objects.requireNonNull(entry, "leaderboard entry is required");
			Objects.requireNonNull(entry.playerId(), "leaderboard playerId is required");
			if (!publicPlayerIds.add(entry.playerId())) {
				throw invalid("duplicate player identity in public leaderboard");
			}
		}

		Set<UUID> personalPlayerIds = new HashSet<>();
		for (
			Map.Entry<UUID, PersonalRoundResult> entry
				: finalized.personalResults().entrySet()
		) {
			UUID mapPlayerId = Objects.requireNonNull(
				entry.getKey(),
				"personal result key is required"
			);
			PersonalRoundResult personal = Objects.requireNonNull(
				entry.getValue(),
				"personal result is required"
			);
			if (!mapPlayerId.equals(personal.playerId())) {
				throw invalid("personal result map key must match playerId");
			}
			if (!personalPlayerIds.add(personal.playerId())) {
				throw invalid("duplicate personal result player identity");
			}
		}

		if (!publicPlayerIds.equals(personalPlayerIds)) {
			throw invalid("public and personal participant identities must match");
		}
	}

	private void validatePersonalResult(
		PublicRoundResult publicResult,
		RoundLeaderboardEntry leaderboard,
		PersonalRoundResult personal
	) {
		if (personal == null) {
			throw invalid("personal result is missing for leaderboard player");
		}
		if (!publicResult.roundId().equals(personal.roundId())) {
			throw invalid("personal result roundId does not match public result");
		}
		if (!publicResult.roomCode().equals(personal.roomCode())) {
			throw invalid("personal result roomCode does not match public result");
		}
		if (!publicResult.startedAt().equals(personal.startedAt())) {
			throw invalid("personal result startedAt does not match public result");
		}
		if (!publicResult.endedAt().equals(personal.endedAt())) {
			throw invalid("personal result endedAt does not match public result");
		}
		if (publicResult.endReason() != personal.endReason()) {
			throw invalid("personal result endReason does not match public result");
		}
		if (publicResult.playerCount() != personal.playerCount()) {
			throw invalid("personal playerCount does not match public result");
		}
		if (!leaderboard.playerId().equals(personal.playerId())) {
			throw invalid("personal playerId does not match leaderboard entry");
		}
		if (!leaderboard.displayName().equals(personal.displayName())) {
			throw invalid("personal displayName does not match leaderboard entry");
		}
		if (leaderboard.score() != personal.score()) {
			throw invalid("personal score does not match leaderboard entry");
		}
		if (leaderboard.rank() != personal.rank()) {
			throw invalid("personal rank does not match leaderboard entry");
		}
		if (leaderboard.creaturesCaught() != personal.creaturesCaught()) {
			throw invalid("personal caught total does not match leaderboard entry");
		}

		requireText(personal.displayName(), 80, "displayName");
		requireNonNegative(personal.score(), "score");
		requirePositive(personal.rank(), "rank");
		requireNonNegative(personal.creaturesCaught(), "creaturesCaught");
		validateCatchAggregates(personal);
	}

	private void validateCatchAggregates(PersonalRoundResult personal) {
		Map<String, Integer> rarityCounts = Objects.requireNonNull(
			personal.rarityCounts(),
			"rarityCounts is required"
		);
		int aggregateTotal = 0;

		for (Map.Entry<String, Integer> entry : rarityCounts.entrySet()) {
			String rarity = requireText(entry.getKey(), 32, "rarity count key");
			Integer count = Objects.requireNonNull(
				entry.getValue(),
				"rarity count is required"
			);
			requireNonNegative(count, "rarity count");
			if (!PERSISTED_RARITIES.contains(rarity) && count > 0) {
				throw invalid("unsupported non-zero rarity count: " + rarity);
			}
			aggregateTotal += count;
		}

		if (aggregateTotal != personal.creaturesCaught()) {
			throw invalid("rarity counts must equal caught total");
		}
		if (personal.caughtCreatures().size() != personal.creaturesCaught()) {
			throw invalid("individual catches must equal caught total");
		}

		Map<String, Integer> catchCounts = new HashMap<>();
		int catchScore = 0;
		for (CaughtCreatureResult caught : personal.caughtCreatures()) {
			validateCatch(caught);
			catchCounts.merge(caught.rarity(), 1, Integer::sum);
			catchScore += caught.scoreAwarded();
		}
		if (catchScore != personal.score()) {
			throw invalid("individual catch scores must equal final score");
		}

		Map<String, Integer> normalizedRarityCounts = new LinkedHashMap<>();
		PERSISTED_RARITIES.forEach(rarity -> normalizedRarityCounts.put(
			rarity,
			rarityCount(rarityCounts, rarity)
		));
		if (!normalizedRarityCounts.equals(withAllRarities(catchCounts))) {
			throw invalid("individual catch rarities must match rarity counts");
		}
	}

	private Map<String, Integer> withAllRarities(Map<String, Integer> counts) {
		Map<String, Integer> result = new LinkedHashMap<>();
		PERSISTED_RARITIES.forEach(rarity -> result.put(
			rarity,
			counts.getOrDefault(rarity, 0)
		));
		return result;
	}

	private GameRoundPlayerCatchEntity mapCatch(
		UUID gameRoundPlayerId,
		CaughtCreatureResult caught,
		Instant createdAt
	) {
		return new GameRoundPlayerCatchEntity(
			UUID.randomUUID(),
			gameRoundPlayerId,
			caught.instanceId(),
			caught.creatureId(),
			caught.name(),
			caught.rarity(),
			caught.scoreAwarded(),
			caught.caughtAt(),
			createdAt
		);
	}

	private void validateCatch(CaughtCreatureResult caught) {
		Objects.requireNonNull(caught, "caught creature is required");
		Objects.requireNonNull(caught.instanceId(), "creature instanceId is required");
		requireText(caught.creatureId(), 64, "creatureId");
		requireText(caught.name(), 100, "creature name");
		String rarity = requireText(caught.rarity(), 32, "rarity");
		if (!PERSISTED_RARITIES.contains(rarity)) {
			throw invalid("unsupported catch rarity: " + rarity);
		}
		requireNonNegative(caught.scoreAwarded(), "scoreAwarded");
		Objects.requireNonNull(caught.caughtAt(), "caughtAt is required");
	}

	private int rarityCount(Map<String, Integer> counts, String rarity) {
		return counts.getOrDefault(rarity, 0);
	}

	private String requireText(String value, int maxLength, String name) {
		if (value == null || value.isBlank()) {
			throw invalid(name + " must not be blank");
		}
		if (value.length() > maxLength) {
			throw invalid(name + " exceeds maximum length " + maxLength);
		}
		return value;
	}

	private void requireNonNegative(long value, String name) {
		if (value < 0) {
			throw invalid(name + " must be non-negative");
		}
	}

	private void requirePositive(long value, String name) {
		if (value <= 0) {
			throw invalid(name + " must be positive");
		}
	}

	private IllegalArgumentException invalid(String message) {
		return new IllegalArgumentException(message);
	}

	record MappedCompletedRound(
		GameRoundEntity round,
		List<MappedCompletedRoundPlayer> players
	) {

		MappedCompletedRound {
			players = List.copyOf(players);
		}
	}

	record MappedCompletedRoundPlayer(
		GameRoundPlayerEntity player,
		List<GameRoundPlayerCatchEntity> catches
	) {

		MappedCompletedRoundPlayer {
			catches = List.copyOf(catches);
		}
	}
}
