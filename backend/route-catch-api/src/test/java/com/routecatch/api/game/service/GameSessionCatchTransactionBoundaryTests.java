package com.routecatch.api.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.lang.reflect.Method;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.game.dto.SubmitCatchRequest;

class GameSessionCatchTransactionBoundaryTests {

	@Test
	void uniqueRaceRecoveryUsesAFreshTransactionAfterWriterRollback()
		throws Exception {
		Method coordinator = GameSessionCatchService.class.getDeclaredMethod(
			"submit",
			UUID.class,
			SubmitCatchRequest.class,
			UUID.class
		);
		Method writer = GameSessionCatchWriter.class.getDeclaredMethod(
			"submit",
			GameSessionCatchCommand.class
		);
		Method reader = GameSessionCatchReader.class.getDeclaredMethod(
			"recoverAfterUniqueRace",
			GameSessionCatchCommand.class
		);

		assertNull(coordinator.getAnnotation(Transactional.class));
		assertEquals(
			Propagation.REQUIRED,
			writer.getAnnotation(Transactional.class).propagation()
		);
		assertEquals(
			Propagation.REQUIRES_NEW,
			reader.getAnnotation(Transactional.class).propagation()
		);
	}
}
