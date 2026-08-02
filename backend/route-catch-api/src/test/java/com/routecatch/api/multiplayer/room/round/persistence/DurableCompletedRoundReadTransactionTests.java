package com.routecatch.api.multiplayer.room.round.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoomRoundResultResponse;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;

@SpringBootTest
class DurableCompletedRoundReadTransactionTests {

	@MockitoBean
	private GameRoundRepository roundRepository;

	@MockitoBean
	private GameRoundPlayerRepository playerRepository;

	@MockitoBean
	private GameRoundPlayerCatchRepository catchRepository;

	@MockitoSpyBean
	private DurableCompletedRoundResultMapper mapper;

	@Autowired
	private DurableCompletedRoundReadService service;

	@Test
	void actualProxyKeepsReadOnlyTransactionActiveThroughMapping() {
		String roomCode = "AB12CD";
		UUID roundId = UUID.randomUUID();
		UUID requesterId = UUID.randomUUID();
		Instant endedAt = Instant.parse("2026-08-02T10:01:00Z");
		GameRoundEntity round = new GameRoundEntity(
			UUID.randomUUID(),
			roundId,
			roomCode,
			1L,
			RoomGameStatus.ENDED,
			RoundEndReason.HOST_ENDED,
			endedAt.minusSeconds(60),
			endedAt,
			60,
			1,
			endedAt
		);
		GameRoundPlayerEntity requester = new GameRoundPlayerEntity(
			UUID.randomUUID(),
			round.getGameRoundId(),
			requesterId,
			1,
			"Historical Player",
			0,
			1,
			0,
			0,
			0,
			0,
			null,
			endedAt
		);
		List<GameRoundPlayerEntity> players = List.of(requester);
		List<GameRoundPlayerCatchEntity> catches = List.of();
		when(roundRepository.findByRoundInstanceIdAndStatus(
			roundId,
			RoomGameStatus.ENDED
		)).thenReturn(Optional.of(round));
		when(playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			)).thenReturn(players);
		when(catchRepository
			.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
				requester.getGameRoundPlayerId()
			)).thenReturn(catches);
		doAnswer(invocation -> {
			assertTrue(
				TransactionSynchronizationManager.isActualTransactionActive()
			);
			assertTrue(
				TransactionSynchronizationManager.isCurrentTransactionReadOnly()
			);
			return invocation.callRealMethod();
		}).when(mapper).map(round, players, requester, catches);

		RoomRoundResultResponse response = service.findExactResult(
			roomCode,
			requesterId,
			roundId
		).orElseThrow();

		assertTrue(AopUtils.isAopProxy(service));
		assertEquals(roundId, response.publicResult().roundId());
		assertEquals(requesterId, response.personalResult().playerId());
	}
}
