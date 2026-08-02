package com.routecatch.api.multiplayer.room.round.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.multiplayer.room.round.FinalizedRoomRound;
import com.routecatch.api.multiplayer.room.round.PublicRoundResult;

class CompletedRoundPersistenceCoordinatorTests {

	@Test
	void roundInstanceDuplicateRaceRecoversThroughFreshReader() {
		CompletedRoundPersistenceWriter writer = mock(
			CompletedRoundPersistenceWriter.class
		);
		CompletedRoundPersistenceReader reader = mock(
			CompletedRoundPersistenceReader.class
		);
		CompletedRoundPersistenceService service =
			new CompletedRoundPersistenceService(writer, reader);
		UUID roundInstanceId = UUID.randomUUID();
		CompletedRoundPersistenceCommand command = command(roundInstanceId);
		DataIntegrityViolationException duplicate =
			new DataIntegrityViolationException(
				"duplicate key violates constraint uk_game_rounds_round_instance_id"
			);
		CompletedRoundPersistenceOutcome existing =
			new CompletedRoundPersistenceOutcome(
				false,
				UUID.randomUUID(),
				roundInstanceId
			);
		when(writer.persistIfAbsent(command)).thenThrow(duplicate);
		when(reader.findExisting(roundInstanceId)).thenReturn(Optional.of(existing));

		CompletedRoundPersistenceOutcome outcome = service.persistIfAbsent(command);

		assertSame(existing, outcome);
		verify(writer).persistIfAbsent(command);
		verify(reader).findExisting(roundInstanceId);
	}

	@Test
	void unrelatedIntegrityViolationStillPropagates() {
		CompletedRoundPersistenceWriter writer = mock(
			CompletedRoundPersistenceWriter.class
		);
		CompletedRoundPersistenceReader reader = mock(
			CompletedRoundPersistenceReader.class
		);
		CompletedRoundPersistenceService service =
			new CompletedRoundPersistenceService(writer, reader);
		CompletedRoundPersistenceCommand command = command(UUID.randomUUID());
		DataIntegrityViolationException unrelated =
			new DataIntegrityViolationException(
				"constraint uk_game_round_player_catches_player_instance"
			);
		when(writer.persistIfAbsent(command)).thenThrow(unrelated);

		assertSame(
			unrelated,
			assertThrows(
				DataIntegrityViolationException.class,
				() -> service.persistIfAbsent(command)
			)
		);
		verifyNoInteractions(reader);
	}

	@Test
	void duplicateConstraintWithoutWinningRoundStillPropagates() {
		CompletedRoundPersistenceWriter writer = mock(
			CompletedRoundPersistenceWriter.class
		);
		CompletedRoundPersistenceReader reader = mock(
			CompletedRoundPersistenceReader.class
		);
		CompletedRoundPersistenceService service =
			new CompletedRoundPersistenceService(writer, reader);
		UUID roundInstanceId = UUID.randomUUID();
		CompletedRoundPersistenceCommand command = command(roundInstanceId);
		DataIntegrityViolationException duplicate =
			new DataIntegrityViolationException(
				"constraint uk_game_rounds_round_instance_id"
			);
		when(writer.persistIfAbsent(command)).thenThrow(duplicate);
		when(reader.findExisting(roundInstanceId)).thenReturn(Optional.empty());

		assertSame(
			duplicate,
			assertThrows(
				DataIntegrityViolationException.class,
				() -> service.persistIfAbsent(command)
			)
		);
	}

	@Test
	void writerAndRecoveryReaderOwnSeparateTransactionalBoundaries()
		throws Exception {
		Method coordinator = CompletedRoundPersistenceService.class
			.getDeclaredMethod(
				"persistIfAbsent",
				CompletedRoundPersistenceCommand.class
			);
		Method writer = CompletedRoundPersistenceWriter.class.getDeclaredMethod(
			"persistIfAbsent",
			CompletedRoundPersistenceCommand.class
		);
		Method reader = CompletedRoundPersistenceReader.class.getDeclaredMethod(
			"findExisting",
			UUID.class
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

	private CompletedRoundPersistenceCommand command(UUID roundInstanceId) {
		PublicRoundResult publicResult = mock(PublicRoundResult.class);
		when(publicResult.roundId()).thenReturn(roundInstanceId);
		FinalizedRoomRound finalized = mock(FinalizedRoomRound.class);
		when(finalized.publicResult()).thenReturn(publicResult);
		return new CompletedRoundPersistenceCommand(finalized, 60);
	}
}
