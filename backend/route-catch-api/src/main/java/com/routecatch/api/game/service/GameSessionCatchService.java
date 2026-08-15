package com.routecatch.api.game.service;

import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;

@Service
class GameSessionCatchService {

	private final GameSessionCatchWriter writer;
	private final GameSessionCatchReader reader;

	GameSessionCatchService(
		GameSessionCatchWriter writer,
		GameSessionCatchReader reader
	) {
		this.writer = writer;
		this.reader = reader;
	}

	/**
	 * A supplied catch ID owns one logical catch. The database primary key is
	 * the final race arbiter; recovery runs only after the losing transaction
	 * has rolled back, using a fresh persistence context.
	 */
	SubmitCatchResponse submit(
		UUID sessionId,
		SubmitCatchRequest request,
		UUID authenticatedUserId
	) {
		UUID catchId = request.catchId() == null
			? UUID.randomUUID()
			: request.catchId();
		GameSessionCatchCommand command = new GameSessionCatchCommand(
			sessionId,
			catchId,
			request.creatureId(),
			authenticatedUserId
		);

		try {
			return writer.submit(command);
		} catch (DataIntegrityViolationException exception) {
			return reader.recoverAfterUniqueRace(command)
				.orElseThrow(() -> exception);
		}
	}
}
