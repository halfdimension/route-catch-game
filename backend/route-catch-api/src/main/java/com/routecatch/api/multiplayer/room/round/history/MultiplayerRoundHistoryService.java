package com.routecatch.api.multiplayer.room.round.history;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.history.dto.MultiplayerRoundHistoryItemResponse;
import com.routecatch.api.multiplayer.room.round.history.dto.MultiplayerRoundHistoryResponse;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.MultiplayerRoundHistoryProjection;

import jakarta.persistence.PersistenceException;

@Service
public class MultiplayerRoundHistoryService {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		MultiplayerRoundHistoryService.class
	);
	private static final int MAXIMUM_PAGE_SIZE = 100;

	private final GameRoundPlayerRepository playerRepository;

	public MultiplayerRoundHistoryService(
		GameRoundPlayerRepository playerRepository
	) {
		this.playerRepository = playerRepository;
	}

	@Transactional(readOnly = true)
	public MultiplayerRoundHistoryResponse getHistory(
		UUID userId,
		int page,
		int size
	) {
		validatePagination(page, size);

		try {
			Page<MultiplayerRoundHistoryProjection> history = playerRepository
				.findCompletedHistoryByUserId(
					userId,
					RoomGameStatus.ENDED,
					PageRequest.of(page, size)
				);

			return new MultiplayerRoundHistoryResponse(
				history.getContent().stream()
					.map(MultiplayerRoundHistoryItemResponse::from)
					.toList(),
				history.getNumber(),
				history.getSize(),
				history.getTotalElements(),
				history.getTotalPages()
			);
		} catch (
			DataAccessException |
			PersistenceException |
			TransactionException exception
		) {
			LOGGER.error(
				"multiplayer round history read failed userId={} page={} size={} failureType={}",
				userId,
				page,
				size,
				exception.getClass().getSimpleName()
			);
			throw new MultiplayerRoundHistoryUnavailableException(exception);
		}
	}

	private void validatePagination(int page, int size) {
		if (page < 0) {
			throw new InvalidMultiplayerRoundHistoryPaginationException(
				"page must be greater than or equal to 0"
			);
		}
		if (size < 1 || size > MAXIMUM_PAGE_SIZE) {
			throw new InvalidMultiplayerRoundHistoryPaginationException(
				"size must be between 1 and 100"
			);
		}
	}
}
