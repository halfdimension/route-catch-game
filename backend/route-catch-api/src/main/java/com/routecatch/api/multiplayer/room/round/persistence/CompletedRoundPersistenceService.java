package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CompletedRoundPersistenceService {

	private final GameRoundRepository roundRepository;
	private final GameRoundPlayerRepository playerRepository;
	private final GameRoundPlayerCatchRepository catchRepository;
	private final CompletedRoundPersistenceMapper mapper;

	public CompletedRoundPersistenceService(
		GameRoundRepository roundRepository,
		GameRoundPlayerRepository playerRepository,
		GameRoundPlayerCatchRepository catchRepository,
		CompletedRoundPersistenceMapper mapper
	) {
		this.roundRepository = roundRepository;
		this.playerRepository = playerRepository;
		this.catchRepository = catchRepository;
		this.mapper = mapper;
	}

	/**
	 * Stores the public round UUID exactly once. Rankings, scores, aggregate
	 * counts, and individual catches are copied from the finalized result.
	 * GAME_ENDED integration is intentionally deferred to Phase 1B.
	 */
	@Transactional
	public CompletedRoundPersistenceOutcome persistIfAbsent(
		CompletedRoundPersistenceCommand command
	) {
		UUID roundInstanceId = command.finalizedRound().publicResult().roundId();
		GameRoundEntity existing = roundRepository
			.findByRoundInstanceId(roundInstanceId)
			.orElse(null);

		if (existing != null) {
			return outcome(false, existing);
		}

		CompletedRoundPersistenceMapper.MappedCompletedRound mapped =
			mapper.map(command);
		roundRepository.saveAndFlush(mapped.round());
		List<GameRoundPlayerEntity> players = mapped.players()
			.stream()
			.map(CompletedRoundPersistenceMapper.MappedCompletedRoundPlayer::player)
			.toList();
		playerRepository.saveAllAndFlush(players);
		List<GameRoundPlayerCatchEntity> catches = mapped.players()
			.stream()
			.flatMap(player -> player.catches().stream())
			.toList();
		catchRepository.saveAllAndFlush(catches);

		return outcome(true, mapped.round());
	}

	private CompletedRoundPersistenceOutcome outcome(
		boolean created,
		GameRoundEntity round
	) {
		return new CompletedRoundPersistenceOutcome(
			created,
			round.getGameRoundId(),
			round.getRoundInstanceId()
		);
	}
}
