package com.routecatch.api.multiplayer.room.round.persistence;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.orm.jpa.JpaSystemException;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoomRoundResultResponse;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.RoundLifecycleException;

import jakarta.persistence.PersistenceException;

class DurableCompletedRoundReadServiceTests {

	private static final String ROOM_CODE = "AB12CD";
	private static final Instant ENDED_AT = Instant.parse(
		"2026-08-02T10:01:00Z"
	);

	private GameRoundRepository roundRepository;
	private GameRoundPlayerRepository playerRepository;
	private GameRoundPlayerCatchRepository catchRepository;
	private DurableCompletedRoundReadService service;

	@BeforeEach
	void setUp() {
		roundRepository = mock(GameRoundRepository.class);
		playerRepository = mock(GameRoundPlayerRepository.class);
		catchRepository = mock(GameRoundPlayerCatchRepository.class);
		service = new DurableCompletedRoundReadService(
			roundRepository,
			playerRepository,
			catchRepository,
			new DurableCompletedRoundResultMapper()
		);
	}

	@Test
	void exactReadReconstructsAuthoritativeResultWithFixedQueries() {
		UUID roundId = UUID.randomUUID();
		GameRoundEntity round = round(roundId, ROOM_CODE, ENDED_AT, 4);
		GameRoundPlayerEntity alpha = player(
			round, UUID.randomUUID(), 1, "Historical Alpha", 180, 1, 1, 0, 0, 1
		);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 2, "Historical Beta", 150, 2, 2, 1, 1, 0
		);
		GameRoundPlayerEntity gamma = player(
			round, UUID.randomUUID(), 3, "Historical Gamma", 150, 2, 1, 1, 0, 0
		);
		GameRoundPlayerEntity delta = player(
			round, UUID.randomUUID(), 4, "Historical Delta", 90, 4, 1, 1, 0, 0
		);
		UUID firstInstance = UUID.fromString(
			"00000000-0000-0000-0000-000000000001"
		);
		UUID secondInstance = UUID.fromString(
			"00000000-0000-0000-0000-000000000002"
		);
		List<GameRoundPlayerCatchEntity> catches = List.of(
			caught(
				requester,
				firstInstance,
				"sparkbit",
				"Historical Sparkbit",
				"common",
				50,
				ENDED_AT.minusSeconds(30)
			),
			caught(
				requester,
				secondInstance,
				"voltfox",
				"Historical Voltfox",
				"rare",
				100,
				ENDED_AT.minusSeconds(20)
			)
		);
		when(roundRepository.findByRoundInstanceIdAndStatus(
			roundId,
			RoomGameStatus.ENDED
		)).thenReturn(Optional.of(round));
		when(playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			)).thenReturn(List.of(alpha, requester, gamma, delta));
		when(catchRepository
			.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
				requester.getGameRoundPlayerId()
			)).thenReturn(catches);

		RoomRoundResultResponse response = service.findExactResult(
			ROOM_CODE,
			requester.getUserId(),
			roundId
		).orElseThrow();

		assertEquals(roundId, response.publicResult().roundId());
		assertEquals(ROOM_CODE, response.publicResult().roomCode());
		assertEquals(4, response.publicResult().playerCount());
		assertEquals(
			List.of(180, 150, 150, 90),
			response.publicResult().leaderboard().stream()
				.map(entry -> entry.score())
				.toList()
		);
		assertEquals(
			List.of(1, 2, 2, 4),
			response.publicResult().leaderboard().stream()
				.map(entry -> entry.rank())
				.toList()
		);
		assertEquals("Historical Beta", response.personalResult().displayName());
		assertEquals(150, response.personalResult().score());
		assertEquals(2, response.personalResult().rank());
		assertEquals(
			java.util.Map.of("common", 1, "rare", 1),
			response.personalResult().rarityCounts()
		);
		assertEquals(
			List.of(firstInstance, secondInstance),
			response.personalResult().caughtCreatures().stream()
				.map(caught -> caught.instanceId())
				.toList()
		);
		assertEquals(
			"Historical Sparkbit",
			response.personalResult().caughtCreatures().getFirst().name()
		);
		verify(roundRepository).findByRoundInstanceIdAndStatus(
			roundId,
			RoomGameStatus.ENDED
		);
		verify(playerRepository)
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			);
		verify(catchRepository)
			.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
				requester.getGameRoundPlayerId()
			);
		verifyNoMoreInteractions(
			roundRepository,
			playerRepository,
			catchRepository
		);
	}

	@Test
	void zeroCatchParticipantGetsEmptyRarityMapAndCatchList() {
		UUID roundId = UUID.randomUUID();
		GameRoundEntity round = round(roundId, ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 1, "Zero", 0, 1, 0, 0, 0, 0
		);
		stubExact(round, List.of(requester), requester, List.of());

		RoomRoundResultResponse response = service.findExactResult(
			ROOM_CODE,
			requester.getUserId(),
			roundId
		).orElseThrow();

		assertTrue(response.personalResult().rarityCounts().isEmpty());
		assertTrue(response.personalResult().caughtCreatures().isEmpty());
	}

	@Test
	void absentDurableRoundReturnsEmptyWithoutChildQueries() {
		UUID roundId = UUID.randomUUID();
		when(roundRepository.findByRoundInstanceIdAndStatus(
			roundId,
			RoomGameStatus.ENDED
		)).thenReturn(Optional.empty());

		assertTrue(service.findExactResult(
			ROOM_CODE,
			UUID.randomUUID(),
			roundId
		).isEmpty());
		verifyNoInteractions(playerRepository, catchRepository);
	}

	@Test
	void exactRoomCodeMismatchReturnsNotFoundWithoutLoadingChildren() {
		UUID roundId = UUID.randomUUID();
		GameRoundEntity round = round(roundId, "OTHER1", ENDED_AT, 1);
		when(roundRepository.findByRoundInstanceIdAndStatus(
			roundId,
			RoomGameStatus.ENDED
		)).thenReturn(Optional.of(round));

		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			() -> service.findExactResult(ROOM_CODE, UUID.randomUUID(), roundId)
		);

		assertEquals(HttpStatus.NOT_FOUND, failure.getStatus());
		assertEquals("ROUND_NOT_FOUND", failure.getErrorCode());
		verifyNoInteractions(playerRepository, catchRepository);
	}

	@Test
	void latestRoundIsSelectedBeforeAuthorizationAndDoesNotLoadCatchesForOutsider() {
		GameRoundEntity latest = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity participant = player(
			latest, UUID.randomUUID(), 1, "Latest Player", 0, 1, 0, 0, 0, 0
		);
		when(roundRepository
			.findFirstByRoomCodeAndStatusOrderByEndedAtDescRoundInstanceIdDesc(
				ROOM_CODE,
				RoomGameStatus.ENDED
			)).thenReturn(Optional.of(latest));
		when(playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				latest.getGameRoundId()
			)).thenReturn(List.of(participant));

		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			() -> service.findLatestResult(ROOM_CODE, UUID.randomUUID())
		);

		assertEquals(HttpStatus.FORBIDDEN, failure.getStatus());
		assertEquals("ROUND_RESULT_FORBIDDEN", failure.getErrorCode());
		verifyNoInteractions(catchRepository);
	}

	@Test
	void malformedParticipantCountFailsClosedBeforeAuthorization() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 2);
		GameRoundPlayerEntity onlyPlayer = player(
			round, UUID.randomUUID(), 1, "Only", 0, 1, 0, 0, 0, 0
		);
		when(roundRepository.findByRoundInstanceIdAndStatus(
			round.getRoundInstanceId(),
			RoomGameStatus.ENDED
		)).thenReturn(Optional.of(round));
		when(playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			)).thenReturn(List.of(onlyPlayer));

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			UUID.randomUUID(),
			round.getRoundInstanceId()
		));
		verifyNoInteractions(catchRepository);
	}

	@Test
	void malformedLeaderboardPositionFailsClosed() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 2);
		GameRoundPlayerEntity first = player(
			round, UUID.randomUUID(), 1, "First", 0, 1, 0, 0, 0, 0
		);
		GameRoundPlayerEntity third = player(
			round, UUID.randomUUID(), 3, "Third", 0, 2, 0, 0, 0, 0
		);
		stubExact(round, List.of(first, third), first, List.of());

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			first.getUserId(),
			round.getRoundInstanceId()
		));
		verifyNoInteractions(catchRepository);
	}

	@Test
	void duplicatePlayerIdentityFailsClosed() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 2);
		UUID duplicateUserId = UUID.randomUUID();
		GameRoundPlayerEntity first = player(
			round, duplicateUserId, 1, "First", 0, 1, 0, 0, 0, 0
		);
		GameRoundPlayerEntity duplicate = player(
			round, duplicateUserId, 2, "Duplicate", 0, 2, 0, 0, 0, 0
		);
		stubExact(round, List.of(first, duplicate), first, List.of());

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			duplicateUserId,
			round.getRoundInstanceId()
		));
		verifyNoInteractions(catchRepository);
	}

	@Test
	void malformedRequesterCatchCountFailsClosed() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 1, "Requester", 10, 1, 1, 1, 0, 0
		);
		stubExact(round, List.of(requester), requester, List.of());

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			requester.getUserId(),
			round.getRoundInstanceId()
		));
	}

	@Test
	void malformedRarityAggregateFailsClosed() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 1, "Requester", 10, 1, 1, 1, 0, 0
		);
		List<GameRoundPlayerCatchEntity> catches = List.of(caught(
			requester,
			UUID.randomUUID(),
			"voltfox",
			"Voltfox",
			"rare",
			10,
			ENDED_AT.minusSeconds(1)
		));
		stubExact(round, List.of(requester), requester, catches);

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			requester.getUserId(),
			round.getRoundInstanceId()
		));
	}

	@Test
	void malformedCatchScoreFailsClosed() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 1, "Requester", 20, 1, 1, 1, 0, 0
		);
		List<GameRoundPlayerCatchEntity> catches = List.of(caught(
			requester,
			UUID.randomUUID(),
			"sparkbit",
			"Sparkbit",
			"common",
			10,
			ENDED_AT.minusSeconds(1)
		));
		stubExact(round, List.of(requester), requester, catches);

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			requester.getUserId(),
			round.getRoundInstanceId()
		));
	}

	@Test
	void catchOwnedByDifferentPlayerRowFailsClosed() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 1, "Requester", 10, 1, 1, 1, 0, 0
		);
		GameRoundPlayerEntity differentOwner = player(
			round, UUID.randomUUID(), 2, "Different", 10, 2, 1, 1, 0, 0
		);
		List<GameRoundPlayerCatchEntity> catches = List.of(caught(
			differentOwner,
			UUID.randomUUID(),
			"sparkbit",
			"Sparkbit",
			"common",
			10,
			ENDED_AT.minusSeconds(1)
		));
		stubExact(round, List.of(requester), requester, catches);

		assertUnavailable(() -> service.findExactResult(
			ROOM_CODE,
			requester.getUserId(),
			round.getRoundInstanceId()
		));
	}

	@Test
	void readMethodsHaveReadOnlyTransactionBoundaries() throws Exception {
		Method exact = DurableCompletedRoundReadService.class.getDeclaredMethod(
			"findExactResult",
			String.class,
			UUID.class,
			UUID.class
		);
		Method latest = DurableCompletedRoundReadService.class.getDeclaredMethod(
			"findLatestResult",
			String.class,
			UUID.class
		);

		assertTrue(exact.getAnnotation(Transactional.class).readOnly());
		assertTrue(latest.getAnnotation(Transactional.class).readOnly());
	}

	@Test
	void durableReaderHasOnlyPersistenceReadDependencies() {
		assertArrayEquals(
			new Class<?>[] {
				GameRoundRepository.class,
				GameRoundPlayerRepository.class,
				GameRoundPlayerCatchRepository.class,
				DurableCompletedRoundResultMapper.class
			},
			DurableCompletedRoundReadService.class
				.getConstructors()[0]
				.getParameterTypes()
		);
	}

	@Test
	void roundRepositoryFailureIsSanitizedAndPreservedAsCause() {
		UUID roundId = UUID.randomUUID();
		DataRetrievalFailureException infrastructure =
			new DataRetrievalFailureException("select secret from game_rounds");
		when(roundRepository.findByRoundInstanceIdAndStatus(
			roundId,
			RoomGameStatus.ENDED
		)).thenThrow(infrastructure);

		RoundLifecycleException failure = assertUnavailable(() ->
			service.findExactResult(ROOM_CODE, UUID.randomUUID(), roundId)
		);

		assertSame(infrastructure, failure.getCause());
		verifyNoInteractions(playerRepository, catchRepository);
	}

	@Test
	void playerRepositoryFailureIsSanitizedWithoutLoadingCatches() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		DataRetrievalFailureException infrastructure =
			new DataRetrievalFailureException("game_round_players unavailable");
		when(roundRepository.findByRoundInstanceIdAndStatus(
			round.getRoundInstanceId(),
			RoomGameStatus.ENDED
		)).thenReturn(Optional.of(round));
		when(playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			)).thenThrow(infrastructure);

		RoundLifecycleException failure = assertUnavailable(() ->
			service.findExactResult(
				ROOM_CODE,
				UUID.randomUUID(),
				round.getRoundInstanceId()
			)
		);

		assertSame(infrastructure, failure.getCause());
		verifyNoInteractions(catchRepository);
	}

	@Test
	void catchRepositoryFailureIsSanitized() {
		GameRoundEntity round = round(UUID.randomUUID(), ROOM_CODE, ENDED_AT, 1);
		GameRoundPlayerEntity requester = player(
			round, UUID.randomUUID(), 1, "Requester", 0, 1, 0, 0, 0, 0
		);
		DataRetrievalFailureException infrastructure =
			new DataRetrievalFailureException("catch query credentials");
		when(roundRepository.findByRoundInstanceIdAndStatus(
			round.getRoundInstanceId(),
			RoomGameStatus.ENDED
		)).thenReturn(Optional.of(round));
		when(playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				round.getGameRoundId()
			)).thenReturn(List.of(requester));
		when(catchRepository
			.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
				requester.getGameRoundPlayerId()
			)).thenThrow(infrastructure);

		RoundLifecycleException failure = assertUnavailable(() ->
			service.findExactResult(
				ROOM_CODE,
				requester.getUserId(),
				round.getRoundInstanceId()
			)
		);

		assertSame(infrastructure, failure.getCause());
	}

	@Test
	void hydrationStyleJpaFailureIsSanitized() {
		JpaSystemException infrastructure = new JpaSystemException(
			new PersistenceException("invalid enum from select secret")
		);
		when(roundRepository
			.findFirstByRoomCodeAndStatusOrderByEndedAtDescRoundInstanceIdDesc(
				ROOM_CODE,
				RoomGameStatus.ENDED
			)).thenThrow(infrastructure);

		RoundLifecycleException failure = assertUnavailable(() ->
			service.findLatestResult(ROOM_CODE, UUID.randomUUID())
		);

		assertSame(infrastructure, failure.getCause());
		verifyNoInteractions(playerRepository, catchRepository);
	}

	private void stubExact(
		GameRoundEntity round,
		List<GameRoundPlayerEntity> players,
		GameRoundPlayerEntity requester,
		List<GameRoundPlayerCatchEntity> catches
	) {
		when(roundRepository.findByRoundInstanceIdAndStatus(
			round.getRoundInstanceId(),
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
	}

	private GameRoundEntity round(
		UUID roundInstanceId,
		String roomCode,
		Instant endedAt,
		int participantCount
	) {
		return new GameRoundEntity(
			UUID.randomUUID(),
			roundInstanceId,
			roomCode,
			1L,
			RoomGameStatus.ENDED,
			RoundEndReason.HOST_ENDED,
			endedAt.minusSeconds(60),
			endedAt,
			60,
			participantCount,
			endedAt
		);
	}

	private GameRoundPlayerEntity player(
		GameRoundEntity round,
		UUID userId,
		int position,
		String displayName,
		int score,
		int rank,
		int caughtTotal,
		int common,
		int rare,
		int legendary
	) {
		return new GameRoundPlayerEntity(
			UUID.randomUUID(),
			round.getGameRoundId(),
			userId,
			position,
			displayName,
			score,
			rank,
			caughtTotal,
			common,
			rare,
			legendary,
			null,
			round.getCreatedAt()
		);
	}

	private GameRoundPlayerCatchEntity caught(
		GameRoundPlayerEntity player,
		UUID instanceId,
		String creatureId,
		String name,
		String rarity,
		int score,
		Instant caughtAt
	) {
		return new GameRoundPlayerCatchEntity(
			UUID.randomUUID(),
			player.getGameRoundPlayerId(),
			instanceId,
			creatureId,
			name,
			rarity,
			score,
			caughtAt,
			caughtAt
		);
	}

	private RoundLifecycleException assertUnavailable(
		org.junit.jupiter.api.function.Executable action
	) {
		RoundLifecycleException failure = assertThrows(
			RoundLifecycleException.class,
			action
		);
		assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, failure.getStatus());
		assertEquals("ROUND_RESULT_UNAVAILABLE", failure.getErrorCode());
		assertEquals("Completed round result is unavailable", failure.getMessage());
		return failure;
	}
}
