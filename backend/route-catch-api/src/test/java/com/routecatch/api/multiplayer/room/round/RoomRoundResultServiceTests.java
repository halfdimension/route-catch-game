package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.CannotCreateTransactionException;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.exception.RoomNotFoundException;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.round.persistence.DurableCompletedRoundReadService;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;

class RoomRoundResultServiceTests {

	@Test
	void exactResultEvictedFromMemoryFallsBackToDurableReader() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = mock(UserEntity.class);
		when(requester.getUserId()).thenReturn(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		FinalizedRoomRound evicted = result(roomCode, UUID.randomUUID(), requesterId);
		store.saveIfAbsent(evicted);
		for (
			int index = 0;
			index < InMemoryRoomRoundResultStore.MAX_RESULTS_PER_ROOM;
			index += 1
		) {
			store.saveIfAbsent(result(roomCode, UUID.randomUUID(), requesterId));
		}
		assertTrue(store.find(
			roomCode,
			evicted.publicResult().roundId()
		).isEmpty());

		RoomRoundResultResponse durableResponse = new RoomRoundResultResponse(
			evicted.publicResult(),
			evicted.personalResults().get(requesterId)
		);
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		when(durable.findExactResult(
			roomCode,
			requesterId,
			evicted.publicResult().roundId()
		)).thenReturn(Optional.of(durableResponse));
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		assertEquals(
			durableResponse,
			service.getResult(
				" ab12cd ",
				evicted.publicResult().roundId(),
				requester
			)
		);
		verifyNoInteractions(roomService);
	}

	@Test
	void newerDurableLatestResultMasksOlderInMemoryResult() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		FinalizedRoomRound older = result(
			roomCode,
			UUID.randomUUID(),
			requesterId
		);
		store.saveIfAbsent(older);
		FinalizedRoomRound newer = result(
			roomCode,
			UUID.randomUUID(),
			requesterId
		);
		RoomRoundResultResponse durableResponse = response(newer, requesterId);
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		when(durable.findLatestResult(roomCode, requesterId)).thenReturn(
			Optional.of(durableResponse)
		);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoomRoundResultResponse response = service.getLatestResult(
			"ab12cd",
			requester
		);

		assertEquals(newer.publicResult(), response.publicResult());
		verify(durable).findLatestResult(roomCode, requesterId);
		verifyNoInteractions(roomService);
	}

	@Test
	void durableLatestAuthorizationFailureDoesNotFallBackToOlderMemory() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		store.saveIfAbsent(result(roomCode, UUID.randomUUID(), requesterId));
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		RoundLifecycleException forbidden = new RoundLifecycleException(
			"ROUND_RESULT_FORBIDDEN",
			"Only participants of this round can retrieve its result",
			HttpStatus.FORBIDDEN
		);
		when(durable.findLatestResult(roomCode, requesterId)).thenThrow(forbidden);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			() -> service.getLatestResult(roomCode, requester)
		);

		assertSame(forbidden, failure);
		verifyNoInteractions(roomService);
	}

	@Test
	void durableLatestParticipantWinsWhenOlderMemoryWouldForbidRequester() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UUID olderParticipantId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		store.saveIfAbsent(result(
			roomCode,
			UUID.randomUUID(),
			olderParticipantId
		));
		FinalizedRoomRound newer = result(
			roomCode,
			UUID.randomUUID(),
			requesterId
		);
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		when(durable.findLatestResult(roomCode, requesterId)).thenReturn(
			Optional.of(response(newer, requesterId))
		);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoomRoundResultResponse actual = service.getLatestResult(
			roomCode,
			requester
		);

		assertEquals(newer.publicResult(), actual.publicResult());
		verifyNoInteractions(roomService);
	}

	@Test
	void emptyDurableLatestFallsBackToInMemoryResult() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		FinalizedRoomRound inMemory = result(
			roomCode,
			UUID.randomUUID(),
			requesterId
		);
		store.saveIfAbsent(inMemory);
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		when(durable.findLatestResult(roomCode, requesterId)).thenReturn(
			Optional.empty()
		);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoomRoundResultResponse actual = service.getLatestResult(
			roomCode,
			requester
		);

		assertEquals(inMemory.publicResult(), actual.publicResult());
		verifyNoInteractions(roomService);
	}

	@Test
	void latestInfrastructureFailureDoesNotFallBackToOlderMemory() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		store.saveIfAbsent(result(roomCode, UUID.randomUUID(), requesterId));
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		CannotCreateTransactionException infrastructure =
			new CannotCreateTransactionException("database credentials unavailable");
		when(durable.findLatestResult(roomCode, requesterId)).thenThrow(
			infrastructure
		);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoundLifecycleException failure = assertUnavailable(() ->
			service.getLatestResult(roomCode, requester)
		);

		assertSame(infrastructure, failure.getCause());
		verifyNoInteractions(roomService);
	}

	@Test
	void exactInMemoryResultSkipsFailingDurableReader() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		FinalizedRoomRound inMemory = result(
			roomCode,
			UUID.randomUUID(),
			requesterId
		);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		store.saveIfAbsent(inMemory);
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		when(durable.findExactResult(
			roomCode,
			requesterId,
			inMemory.publicResult().roundId()
		)).thenThrow(new DataRetrievalFailureException("database unavailable"));
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoomRoundResultResponse actual = service.getResult(
			roomCode,
			inMemory.publicResult().roundId(),
			requester
		);

		assertEquals(inMemory.publicResult(), actual.publicResult());
		verifyNoInteractions(durable, roomService);
	}

	@Test
	void exactMemoryMissInfrastructureFailureFailsClosed() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UUID roundId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		InMemoryRoomRoundResultStore store = new InMemoryRoomRoundResultStore();
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		DataRetrievalFailureException infrastructure =
			new DataRetrievalFailureException("connection credentials");
		when(durable.findExactResult(roomCode, requesterId, roundId)).thenThrow(
			infrastructure
		);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			store,
			durable
		);

		RoundLifecycleException failure = assertUnavailable(() ->
			service.getResult(roomCode, roundId, requester)
		);

		assertSame(infrastructure, failure.getCause());
		verifyNoInteractions(roomService);
	}

	@Test
	void bothExactSourcesMissingConsultsRoomForExistingAndAbsentSemantics() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UUID roundId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		DurableCompletedRoundReadService durable = emptyDurable(roomCode, requesterId);
		MultiplayerRoomService existingRooms = mock(MultiplayerRoomService.class);
		MultiplayerRoom existingRoom = room(roomCode, requester);
		when(existingRooms.getRoom(roomCode)).thenReturn(existingRoom);
		RoomRoundResultService existingService = new RoomRoundResultService(
			existingRooms,
			new InMemoryRoomRoundResultStore(),
			durable
		);

		assertFailure(
			() -> existingService.getResult(roomCode, roundId, requester),
			HttpStatus.NOT_FOUND,
			"ROUND_NOT_FOUND"
		);

		MultiplayerRoomService absentRooms = mock(MultiplayerRoomService.class);
		when(absentRooms.getRoom(roomCode)).thenThrow(
			new RoomNotFoundException(roomCode)
		);
		RoomRoundResultService absentService = new RoomRoundResultService(
			absentRooms,
			new InMemoryRoomRoundResultStore(),
			durable
		);
		assertThrows(
			RoomNotFoundException.class,
			() -> absentService.getResult(roomCode, roundId, requester)
		);
	}

	@Test
	void bothLatestSourcesMissingPreservesExistingRoomNotFoundResult() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		DurableCompletedRoundReadService durable = emptyDurable(roomCode, requesterId);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		MultiplayerRoom existingRoom = room(roomCode, requester);
		when(roomService.getRoom(roomCode)).thenReturn(existingRoom);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			new InMemoryRoomRoundResultStore(),
			durable
		);

		assertFailure(
			() -> service.getLatestResult(roomCode, requester),
			HttpStatus.NOT_FOUND,
			"ROUND_NOT_FOUND"
		);
	}

	@Test
	void matchingRunningAndFinalizingExactRoundRemainNotReady() {
		String roomCode = "AB12CD";
		UUID requesterId = UUID.randomUUID();
		UserEntity requester = requester(requesterId);
		MultiplayerRoom room = room(roomCode, requester);
		room.getGameState().start(
			60,
			Instant.parse("2026-08-02T10:00:00Z"),
			requester,
			room.getMembers()
		);
		UUID roundId = room.getGameState().getRoundId();
		DurableCompletedRoundReadService durable = emptyDurable(roomCode, requesterId);
		MultiplayerRoomService roomService = mock(MultiplayerRoomService.class);
		when(roomService.getRoom(roomCode)).thenReturn(room);
		RoomRoundResultService service = new RoomRoundResultService(
			roomService,
			new InMemoryRoomRoundResultStore(),
			durable
		);

		assertFailure(
			() -> service.getResult(roomCode, roundId, requester),
			HttpStatus.CONFLICT,
			"ROUND_RESULT_NOT_READY"
		);
		assertTrue(room.getGameState().beginFinalizing(roundId, 1L));
		assertFailure(
			() -> service.getResult(roomCode, roundId, requester),
			HttpStatus.CONFLICT,
			"ROUND_RESULT_NOT_READY"
		);
	}

	private DurableCompletedRoundReadService emptyDurable(
		String roomCode,
		UUID requesterId
	) {
		DurableCompletedRoundReadService durable = mock(
			DurableCompletedRoundReadService.class
		);
		when(durable.findLatestResult(roomCode, requesterId)).thenReturn(
			Optional.empty()
		);
		return durable;
	}

	private UserEntity requester(UUID requesterId) {
		UserEntity requester = mock(UserEntity.class);
		when(requester.getUserId()).thenReturn(requesterId);
		when(requester.getDisplayName()).thenReturn("Player");
		return requester;
	}

	private MultiplayerRoom room(String roomCode, UserEntity host) {
		return new MultiplayerRoom(roomCode, "Result Room", host);
	}

	private RoomRoundResultResponse response(
		FinalizedRoomRound round,
		UUID requesterId
	) {
		return new RoomRoundResultResponse(
			round.publicResult(),
			round.personalResults().get(requesterId)
		);
	}

	private RoundLifecycleException assertUnavailable(
		org.junit.jupiter.api.function.Executable action
	) {
		return assertFailure(
			action,
			HttpStatus.INTERNAL_SERVER_ERROR,
			"ROUND_RESULT_UNAVAILABLE"
		);
	}

	private RoundLifecycleException assertFailure(
		org.junit.jupiter.api.function.Executable action,
		HttpStatus status,
		String code
	) {
		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			action
		);
		assertEquals(status, failure.getStatus());
		assertEquals(code, failure.getErrorCode());
		return failure;
	}

	private FinalizedRoomRound result(
		String roomCode,
		UUID roundId,
		UUID requesterId
	) {
		Instant startedAt = Instant.parse("2026-08-02T10:00:00Z");
		Instant endedAt = startedAt.plusSeconds(60);
		RoundLeaderboardEntry entry = new RoundLeaderboardEntry(
			requesterId,
			"Player",
			0,
			1,
			0
		);
		PublicRoundResult publicResult = new PublicRoundResult(
			roundId,
			roomCode,
			startedAt,
			endedAt,
			RoundEndReason.HOST_ENDED,
			1,
			List.of(entry)
		);
		PersonalRoundResult personal = new PersonalRoundResult(
			roundId,
			roomCode,
			requesterId,
			"Player",
			0,
			1,
			1,
			0,
			Map.of(),
			List.of(),
			startedAt,
			endedAt,
			RoundEndReason.HOST_ENDED
		);
		return new FinalizedRoomRound(1L, publicResult, Map.of(
			requesterId,
			personal
		));
	}
}
