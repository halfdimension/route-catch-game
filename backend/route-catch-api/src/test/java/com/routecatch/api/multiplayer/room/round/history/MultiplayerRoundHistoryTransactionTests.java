package com.routecatch.api.multiplayer.room.round.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;

@SpringBootTest
class MultiplayerRoundHistoryTransactionTests {

	@MockitoBean
	private GameRoundPlayerRepository playerRepository;

	@Autowired
	private MultiplayerRoundHistoryService service;

	@Test
	void actualSpringProxyKeepsReadOnlyTransactionActiveDuringQuery() {
		UUID userId = UUID.randomUUID();
		when(playerRepository.findCompletedHistoryByUserId(
			eq(userId),
			eq(RoomGameStatus.ENDED),
			any(Pageable.class)
		)).thenAnswer(invocation -> {
			assertTrue(
				TransactionSynchronizationManager.isActualTransactionActive()
			);
			assertTrue(
				TransactionSynchronizationManager.isCurrentTransactionReadOnly()
			);
			Pageable pageable = invocation.getArgument(2);
			return new PageImpl<>(List.of(), pageable, 0);
		});

		var response = service.getHistory(userId, 0, 20);

		assertTrue(AopUtils.isAopProxy(service));
		assertEquals(0, response.totalElements());
	}
}
