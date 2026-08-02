package com.routecatch.api.multiplayer.room.round.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.TransactionException;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoomRoundResultResponse;
import com.routecatch.api.multiplayer.room.round.RoundLifecycleException;

import jakarta.persistence.PersistenceException;

@Service
public class DurableCompletedRoundReadService {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		DurableCompletedRoundReadService.class
	);

	private final GameRoundRepository roundRepository;
	private final GameRoundPlayerRepository playerRepository;
	private final GameRoundPlayerCatchRepository catchRepository;
	private final DurableCompletedRoundResultMapper mapper;

	public DurableCompletedRoundReadService(
		GameRoundRepository roundRepository,
		GameRoundPlayerRepository playerRepository,
		GameRoundPlayerCatchRepository catchRepository,
		DurableCompletedRoundResultMapper mapper
	) {
		this.roundRepository = roundRepository;
		this.playerRepository = playerRepository;
		this.catchRepository = catchRepository;
		this.mapper = mapper;
	}

	@Transactional(readOnly = true)
	public Optional<RoomRoundResultResponse> findExactResult(
		String normalizedRoomCode,
		UUID requesterUserId,
		UUID roundId
	) {
		return translateInfrastructureFailures(
			"exact",
			normalizedRoomCode,
			roundId,
			() -> {
				Optional<GameRoundEntity> persisted = roundRepository
					.findByRoundInstanceIdAndStatus(
						roundId,
						RoomGameStatus.ENDED
					);
				if (persisted.isEmpty()) {
					return Optional.empty();
				}

				GameRoundEntity round = persisted.get();
				mapper.validateRoundMetadata(round);
				if (!normalizedRoomCode.equals(round.getRoomCode())) {
					throw error(
						"ROUND_NOT_FOUND",
						"Round result was not found",
						HttpStatus.NOT_FOUND
					);
				}

				return Optional.of(readParticipantResult(
					round,
					requesterUserId
				));
			}
		);
	}

	@Transactional(readOnly = true)
	public Optional<RoomRoundResultResponse> findLatestResult(
		String normalizedRoomCode,
		UUID requesterUserId
	) {
		return translateInfrastructureFailures(
			"latest",
			normalizedRoomCode,
			null,
			() -> roundRepository
				.findFirstByRoomCodeAndStatusOrderByEndedAtDescRoundInstanceIdDesc(
					normalizedRoomCode,
					RoomGameStatus.ENDED
				)
				.map(round -> readParticipantResult(round, requesterUserId))
		);
	}

	private RoomRoundResultResponse readParticipantResult(
		GameRoundEntity round,
		UUID requesterUserId
	) {
		mapper.validateRoundMetadata(round);
		List<GameRoundPlayerEntity> players = playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			);
		mapper.validateRound(round, players);
		GameRoundPlayerEntity requester = players.stream()
			.filter(player -> requesterUserId.equals(player.getUserId()))
			.findFirst()
			.orElseThrow(() -> error(
				"ROUND_RESULT_FORBIDDEN",
				"Only participants of this round can retrieve its result",
				HttpStatus.FORBIDDEN
			));
		List<GameRoundPlayerCatchEntity> catches = catchRepository
			.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
				requester.getGameRoundPlayerId()
			);

		return mapper.map(round, players, requester, catches);
	}

	private RoundLifecycleException error(
		String code,
		String message,
		HttpStatus status
	) {
		return new RoundLifecycleException(code, message, status);
	}

	private <T> T translateInfrastructureFailures(
		String readType,
		String roomCode,
		UUID roundId,
		Supplier<T> read
	) {
		try {
			return read.get();
		} catch (
			DataAccessException |
			PersistenceException |
			TransactionException exception
		) {
			LOGGER.error(
				"durable completed-round read failed readType={} roomCode={} roundId={} failureType={}",
				readType,
				roomCode,
				roundId,
				exception.getClass().getSimpleName()
			);
			throw unavailable(exception);
		}
	}

	private RoundLifecycleException unavailable(RuntimeException cause) {
		return new RoundLifecycleException(
			"ROUND_RESULT_UNAVAILABLE",
			"Completed round result is unavailable",
			HttpStatus.INTERNAL_SERVER_ERROR,
			cause
		);
	}
}
