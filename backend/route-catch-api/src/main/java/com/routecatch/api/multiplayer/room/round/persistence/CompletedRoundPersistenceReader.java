package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
class CompletedRoundPersistenceReader {

	private final GameRoundRepository roundRepository;

	CompletedRoundPersistenceReader(GameRoundRepository roundRepository) {
		this.roundRepository = roundRepository;
	}

	@Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
	Optional<CompletedRoundPersistenceOutcome> findExisting(
		UUID roundInstanceId
	) {
		return roundRepository.findByRoundInstanceId(roundInstanceId)
			.map(round -> new CompletedRoundPersistenceOutcome(
				false,
				round.getGameRoundId(),
				round.getRoundInstanceId()
			));
	}
}
