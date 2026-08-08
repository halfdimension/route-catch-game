package com.routecatch.api.multiplayer.room.round;

import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.persistence.DurableCompletedRoundReadService;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;

import jakarta.persistence.PersistenceException;

@Service
public class RoomRoundResultService {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomRoundResultService.class
	);

	private final MultiplayerRoomService roomService;
	private final RoomRoundResultStore resultStore;
	private final DurableCompletedRoundReadService durableReadService;

	public RoomRoundResultService(
		MultiplayerRoomService roomService,
		RoomRoundResultStore resultStore,
		DurableCompletedRoundReadService durableReadService
	) {
		this.roomService = roomService;
		this.resultStore = resultStore;
		this.durableReadService = durableReadService;
	}

	public RoomRoundResultResponse getResult(
		String roomCode,
		UUID roundId,
		UserEntity requester
	) {
		String normalizedRoomCode = normalize(roomCode);
		FinalizedRoomRound result = resultStore
			.find(normalizedRoomCode, roundId)
			.orElse(null);
		if (result != null) {
			return authorizedResponse(result, requester);
		}

		return findDurableExactResult(
			normalizedRoomCode,
			requester.getUserId(),
			roundId
		).orElseGet(() -> {
			MultiplayerRoom room = roomService.getRoom(normalizedRoomCode);
			throw missingResult(room, roundId);
		});
	}

	public RoomRoundResultResponse getLatestResult(
		String roomCode,
		UserEntity requester
	) {
		String normalizedRoomCode = normalize(roomCode);
		RoomRoundResultResponse durable = findDurableLatestResult(
			normalizedRoomCode,
			requester.getUserId()
		).orElse(null);
		if (durable != null) {
			return durable;
		}

		FinalizedRoomRound inMemory = resultStore
			.findLatest(normalizedRoomCode)
			.orElse(null);
		if (inMemory != null) {
			return authorizedResponse(inMemory, requester);
		}

		return missingLatestResult(normalizedRoomCode);
	}

	private Optional<RoomRoundResultResponse> findDurableExactResult(
		String roomCode,
		UUID requesterUserId,
		UUID roundId
	) {
		try {
			return durableReadService.findExactResult(
				roomCode,
				requesterUserId,
				roundId
			);
		} catch (
			DataAccessException |
			PersistenceException |
			TransactionException exception
		) {
			throw unavailable("exact", roomCode, roundId, exception);
		}
	}

	private Optional<RoomRoundResultResponse> findDurableLatestResult(
		String roomCode,
		UUID requesterUserId
	) {
		try {
			return durableReadService.findLatestResult(roomCode, requesterUserId);
		} catch (
			DataAccessException |
			PersistenceException |
			TransactionException exception
		) {
			throw unavailable("latest", roomCode, null, exception);
		}
	}

	private RoomRoundResultResponse missingLatestResult(String roomCode) {
		MultiplayerRoom room = roomService.getRoom(roomCode);
		if (
			room.getGameState().getStatus() == RoomGameStatus.RUNNING ||
			room.getGameState().getStatus() == RoomGameStatus.FINALIZING
		) {
			throw error(
				"ROUND_RESULT_NOT_READY",
				"Current round result is not finalized",
				HttpStatus.CONFLICT
			);
		}
		throw error(
			"ROUND_NOT_FOUND",
			"No completed round exists for this room",
			HttpStatus.NOT_FOUND
		);
	}

	private RoomRoundResultResponse authorizedResponse(
		FinalizedRoomRound result,
		UserEntity requester
	) {
		PersonalRoundResult personal = result.personalResults().get(
			requester.getUserId()
		);

		if (personal == null) {
			throw error(
				"ROUND_RESULT_FORBIDDEN",
				"Only participants of this round can retrieve its result",
				HttpStatus.FORBIDDEN
			);
		}

		return new RoomRoundResultResponse(result.publicResult(), personal);
	}

	private RoundLifecycleException missingResult(
		MultiplayerRoom room,
		UUID roundId
	) {
		if (
			roundId.equals(room.getGameState().getRoundId()) &&
			room.getGameState().getStatus() != RoomGameStatus.ENDED
		) {
			return error(
				"ROUND_RESULT_NOT_READY",
				"Round result is not finalized",
				HttpStatus.CONFLICT
			);
		}

		return error(
			"ROUND_NOT_FOUND",
			"Round result was not found",
			HttpStatus.NOT_FOUND
		);
	}

	private RoundLifecycleException error(
		String code,
		String message,
		HttpStatus status
	) {
		return new RoundLifecycleException(code, message, status);
	}

	private RoundLifecycleException unavailable(
		String readType,
		String roomCode,
		UUID roundId,
		RuntimeException cause
	) {
		LOGGER.error(
			"durable completed-round transaction failed readType={} roomCode={} roundId={} failureType={}",
			readType,
			roomCode,
			roundId,
			cause.getClass().getSimpleName()
		);
		return new RoundLifecycleException(
			"ROUND_RESULT_UNAVAILABLE",
			"Completed round result is unavailable",
			HttpStatus.INTERNAL_SERVER_ERROR,
			cause
		);
	}

	private String normalize(String roomCode) {
		return roomCode.trim().toUpperCase();
	}
}
