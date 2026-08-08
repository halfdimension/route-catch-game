package com.routecatch.api.multiplayer.room.round.history;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.history.dto.MultiplayerRoundHistoryResponse;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.MultiplayerRoundHistoryProjection;

import jakarta.persistence.PersistenceException;

class MultiplayerRoundHistoryServiceTests {

	private GameRoundPlayerRepository playerRepository;
	private MultiplayerRoundHistoryService service;

	@BeforeEach
	void setUp() {
		playerRepository = mock(GameRoundPlayerRepository.class);
		service = new MultiplayerRoundHistoryService(playerRepository);
	}

	@Test
	void mapsOneBoundedProjectionPageWithoutAdditionalReads() {
		UUID userId = UUID.randomUUID();
		UUID roundId = UUID.randomUUID();
		MultiplayerRoundHistoryProjection projection = projection(roundId);
		PageRequest pageRequest = PageRequest.of(1, 2);
		when(playerRepository.findCompletedHistoryByUserId(
			userId,
			RoomGameStatus.ENDED,
			pageRequest
		)).thenReturn(new PageImpl<>(List.of(projection), pageRequest, 5));

		MultiplayerRoundHistoryResponse response = service.getHistory(
			userId,
			1,
			2
		);

		assertEquals(1, response.page());
		assertEquals(2, response.size());
		assertEquals(5, response.totalElements());
		assertEquals(3, response.totalPages());
		assertEquals(1, response.content().size());
		assertEquals(roundId, response.content().getFirst().roundId());
		assertEquals("ABC123", response.content().getFirst().roomCode());
		assertEquals(280, response.content().getFirst().score());
		assertEquals(6, response.content().getFirst().creaturesCaught());
		verify(playerRepository).findCompletedHistoryByUserId(
			userId,
			RoomGameStatus.ENDED,
			pageRequest
		);
	}

	@Test
	void rejectsInvalidPaginationBeforeRepositoryAccess() {
		UUID userId = UUID.randomUUID();

		assertThrows(
			InvalidMultiplayerRoundHistoryPaginationException.class,
			() -> service.getHistory(userId, -1, 20)
		);
		assertThrows(
			InvalidMultiplayerRoundHistoryPaginationException.class,
			() -> service.getHistory(userId, 0, 0)
		);
		assertThrows(
			InvalidMultiplayerRoundHistoryPaginationException.class,
			() -> service.getHistory(userId, 0, 101)
		);
		verifyNoInteractions(playerRepository);
	}

	@Test
	void acceptsPaginationBoundaries() {
		UUID userId = UUID.randomUUID();
		PageRequest one = PageRequest.of(0, 1);
		PageRequest hundred = PageRequest.of(0, 100);
		when(playerRepository.findCompletedHistoryByUserId(
			userId, RoomGameStatus.ENDED, one
		)).thenReturn(new PageImpl<>(List.of(), one, 0));
		when(playerRepository.findCompletedHistoryByUserId(
			userId, RoomGameStatus.ENDED, hundred
		)).thenReturn(new PageImpl<>(List.of(), hundred, 0));

		assertEquals(1, service.getHistory(userId, 0, 1).size());
		assertEquals(100, service.getHistory(userId, 0, 100).size());
	}

	@Test
	void repositoryFailureIsSanitizedAndPreservesCause() {
		UUID userId = UUID.randomUUID();
		DataRetrievalFailureException infrastructure =
			new DataRetrievalFailureException(
				"select password from game_round_players"
			);
		when(playerRepository.findCompletedHistoryByUserId(
			userId,
			RoomGameStatus.ENDED,
			PageRequest.of(0, 20)
		)).thenThrow(infrastructure);

		MultiplayerRoundHistoryUnavailableException failure = assertThrows(
			MultiplayerRoundHistoryUnavailableException.class,
			() -> service.getHistory(userId, 0, 20)
		);

		assertEquals("Multiplayer round history is unavailable",
			failure.getMessage());
		assertSame(infrastructure, failure.getCause());
	}

	@Test
	void persistenceAndTransactionFailuresAreSanitized() {
		UUID userId = UUID.randomUUID();
		PersistenceException persistence = new PersistenceException(
			"persistence SQL secret"
		);
		TransactionSystemException transaction = new TransactionSystemException(
			"transaction credentials"
		);
		when(playerRepository.findCompletedHistoryByUserId(
			userId,
			RoomGameStatus.ENDED,
			PageRequest.of(0, 20)
		)).thenThrow(persistence).thenThrow(transaction);

		MultiplayerRoundHistoryUnavailableException persistenceFailure =
			assertThrows(
				MultiplayerRoundHistoryUnavailableException.class,
				() -> service.getHistory(userId, 0, 20)
			);
		MultiplayerRoundHistoryUnavailableException transactionFailure =
			assertThrows(
				MultiplayerRoundHistoryUnavailableException.class,
				() -> service.getHistory(userId, 0, 20)
			);

		assertSame(persistence, persistenceFailure.getCause());
		assertSame(transaction, transactionFailure.getCause());
		assertEquals(
			"Multiplayer round history is unavailable",
			transactionFailure.getMessage()
		);
	}

	@Test
	void serviceHasFocusedDependencyAndReadOnlyTransaction() throws Exception {
		assertArrayEquals(
			new Class<?>[] {GameRoundPlayerRepository.class},
			MultiplayerRoundHistoryService.class
				.getConstructors()[0]
				.getParameterTypes()
		);
		Method method = MultiplayerRoundHistoryService.class.getDeclaredMethod(
			"getHistory",
			UUID.class,
			int.class,
			int.class
		);
		assertTrue(method.getAnnotation(Transactional.class).readOnly());
	}

	private MultiplayerRoundHistoryProjection projection(UUID roundId) {
		MultiplayerRoundHistoryProjection projection = mock(
			MultiplayerRoundHistoryProjection.class
		);
		Instant endedAt = Instant.parse("2026-08-02T12:00:00Z");
		when(projection.getRoundId()).thenReturn(roundId);
		when(projection.getRoomCode()).thenReturn("ABC123");
		when(projection.getStartedAt()).thenReturn(endedAt.minusSeconds(60));
		when(projection.getEndedAt()).thenReturn(endedAt);
		when(projection.getEndReason()).thenReturn(RoundEndReason.TIME_EXPIRED);
		when(projection.getDurationSeconds()).thenReturn(60);
		when(projection.getParticipantCount()).thenReturn(2);
		when(projection.getRank()).thenReturn(1);
		when(projection.getScore()).thenReturn(280);
		when(projection.getCreaturesCaught()).thenReturn(6);
		return projection;
	}
}
