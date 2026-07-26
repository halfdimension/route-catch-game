package com.routecatch.api.multiplayer.room.round;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;

@Service
public class RoomRoundResultService {

	private final MultiplayerRoomService roomService;
	private final RoomRoundResultStore resultStore;

	public RoomRoundResultService(
		MultiplayerRoomService roomService,
		RoomRoundResultStore resultStore
	) {
		this.roomService = roomService;
		this.resultStore = resultStore;
	}

	public RoomRoundResultResponse getResult(
		String roomCode,
		UUID roundId,
		UserEntity requester
	) {
		MultiplayerRoom room = roomService.getRoom(roomCode);
		FinalizedRoomRound result = resultStore
			.find(room.getRoomCode(), roundId)
			.orElseThrow(() -> missingResult(room, roundId));
		return authorizedResponse(result, requester);
	}

	public RoomRoundResultResponse getLatestResult(
		String roomCode,
		UserEntity requester
	) {
		MultiplayerRoom room = roomService.getRoom(roomCode);
		FinalizedRoomRound result = resultStore
			.findLatest(room.getRoomCode())
			.orElseThrow(() -> {
				if (
					room.getGameState().getStatus() == RoomGameStatus.RUNNING ||
					room.getGameState().getStatus() == RoomGameStatus.FINALIZING
				) {
					return error(
						"ROUND_RESULT_NOT_READY",
						"Current round result is not finalized",
						HttpStatus.CONFLICT
					);
				}
				return error(
					"ROUND_NOT_FOUND",
					"No completed round exists for this room",
					HttpStatus.NOT_FOUND
				);
			});
		return authorizedResponse(result, requester);
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
}
