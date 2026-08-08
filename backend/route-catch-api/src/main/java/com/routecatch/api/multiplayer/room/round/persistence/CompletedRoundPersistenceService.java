package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.Locale;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

@Service
public class CompletedRoundPersistenceService {

	private static final String ROUND_INSTANCE_CONSTRAINT =
		"uk_game_rounds_round_instance_id";

	private final CompletedRoundPersistenceWriter writer;
	private final CompletedRoundPersistenceReader reader;

	public CompletedRoundPersistenceService(
		CompletedRoundPersistenceWriter writer,
		CompletedRoundPersistenceReader reader
	) {
		this.writer = writer;
		this.reader = reader;
	}

	/**
	 * Stores the public round UUID exactly once. Rankings, scores, aggregate
	 * counts, and individual catches are copied from the finalized result.
	 * A unique-key loser is recovered only after its insert transaction has
	 * rolled back, using a fresh read transaction.
	 */
	public CompletedRoundPersistenceOutcome persistIfAbsent(
		CompletedRoundPersistenceCommand command
	) {
		UUID roundInstanceId = command.finalizedRound().publicResult().roundId();

		try {
			return writer.persistIfAbsent(command);
		} catch (DataIntegrityViolationException exception) {
			if (!isRoundInstanceDuplicate(exception)) {
				throw exception;
			}

			return reader.findExisting(roundInstanceId).orElseThrow(() -> exception);
		}
	}

	private boolean isRoundInstanceDuplicate(Throwable failure) {
		Throwable current = failure;

		while (current != null) {
			String message = current.getMessage();
			if (
				message != null &&
				message.toLowerCase(Locale.ROOT).contains(
					ROUND_INSTANCE_CONSTRAINT
				)
			) {
				return true;
			}
			current = current.getCause();
		}

		return false;
	}
}
