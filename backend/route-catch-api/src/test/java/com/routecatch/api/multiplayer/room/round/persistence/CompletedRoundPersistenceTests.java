package com.routecatch.api.multiplayer.room.round.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.CaughtCreatureResult;
import com.routecatch.api.multiplayer.room.round.FinalizedRoomRound;
import com.routecatch.api.multiplayer.room.round.PersonalRoundResult;
import com.routecatch.api.multiplayer.room.round.PublicRoundResult;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.RoundLeaderboardEntry;

@SpringBootTest
class CompletedRoundPersistenceTests {

	private static final Instant STARTED_AT = Instant.parse(
		"2026-08-02T08:00:00Z"
	);
	private static final Instant ENDED_AT = STARTED_AT.plusSeconds(60);
	private static final String ROOM_CODE = "AB12CD";

	@Autowired
	private CompletedRoundPersistenceService persistenceService;

	@Autowired
	private GameRoundRepository roundRepository;

	@Autowired
	private GameRoundPlayerRepository playerRepository;

	@Autowired
	private GameRoundPlayerCatchRepository catchRepository;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@BeforeEach
	void clearDataBeforeTest() {
		clearData();
	}

	@AfterEach
	void clearDataAfterTest() {
		clearData();
	}

	@Test
	void flywayCreatesAllRoundTablesAndHibernateValidatesThem() {
		Integer tableCount = jdbcTemplate.queryForObject(
			"""
			select count(*)
			from information_schema.tables
			where table_schema = 'public'
				and table_name in (
					'game_rounds',
					'game_round_players',
					'game_round_player_catches'
				)
			""",
			Integer.class
		);

		assertEquals(3, tableCount);
	}

	@Test
	void persistsRoundPlayersZeroCatchParticipantAndAuthoritativeMetadata() {
		UserEntity catcher = saveUser("catcher", "Round Catcher");
		UserEntity zero = saveUser("zero", "Zero Catch Player");
		UUID catchInstanceId = UUID.randomUUID();
		CaughtCreatureResult caught = catchResult(
			catchInstanceId,
			"sparkbit",
			"Sparkbit",
			"common",
			10,
			STARTED_AT.plusSeconds(12)
		);
		UUID roundInstanceId = UUID.randomUUID();
		CompletedRoundPersistenceCommand command = command(
			roundInstanceId,
			7L,
			90,
			RoundEndReason.TIME_EXPIRED,
			ENDED_AT,
			List.of(
				player(catcher, 10, 1, List.of(caught)),
				player(zero, 0, 2, List.of())
			)
		);

		CompletedRoundPersistenceOutcome outcome =
			persistenceService.persistIfAbsent(command);

		assertTrue(outcome.created());
		assertEquals(roundInstanceId, outcome.roundInstanceId());
		GameRoundEntity round = roundRepository
			.findByRoundInstanceId(roundInstanceId)
			.orElseThrow();
		assertEquals(outcome.gameRoundId(), round.getGameRoundId());
		assertEquals(ROOM_CODE, round.getRoomCode());
		assertEquals(7L, round.getRoundGeneration());
		assertEquals(RoomGameStatus.ENDED, round.getStatus());
		assertEquals(RoundEndReason.TIME_EXPIRED, round.getEndReason());
		assertEquals(STARTED_AT, round.getStartedAt());
		assertEquals(ENDED_AT, round.getEndedAt());
		assertEquals(90, round.getDurationSeconds());
		assertEquals(2, round.getParticipantCount());
		assertNotNull(round.getCreatedAt());
		assertEquals(2, playerRepository.countByGameRoundId(round.getGameRoundId()));

		GameRoundPlayerEntity zeroPlayer = playerRepository
			.findByGameRoundIdAndUserId(round.getGameRoundId(), zero.getUserId())
			.orElseThrow();
		assertEquals("Zero Catch Player", zeroPlayer.getDisplayName());
		assertEquals(0, zeroPlayer.getFinalScore());
		assertEquals(0, zeroPlayer.getCaughtTotal());
		assertEquals(0, catchRepository.countByGameRoundPlayerId(
			zeroPlayer.getGameRoundPlayerId()
		));
		assertNull(zeroPlayer.getJoinedAt());
	}

	@Test
	void preservesCompetitionRanksWithoutRecalculation() {
		UserEntity alpha = saveUser("alpha", "Alpha");
		UserEntity beta = saveUser("beta", "Beta");
		UserEntity gamma = saveUser("gamma", "Gamma");
		UserEntity delta = saveUser("delta", "Delta");
		CompletedRoundPersistenceCommand command = command(
			UUID.randomUUID(),
			3L,
			60,
			RoundEndReason.HOST_ENDED,
			ENDED_AT,
			List.of(
				player(alpha, 180, 1, oneCatch("legendary", 180, 1)),
				player(beta, 150, 2, oneCatch("rare", 150, 2)),
				player(gamma, 150, 2, oneCatch("common", 150, 3)),
				player(delta, 90, 4, oneCatch("common", 90, 4))
			)
		);

		CompletedRoundPersistenceOutcome outcome =
			persistenceService.persistIfAbsent(command);
		List<GameRoundPlayerEntity> players = playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(
				outcome.gameRoundId()
			);

		assertEquals(List.of(180, 150, 150, 90), players.stream()
			.map(GameRoundPlayerEntity::getFinalScore)
			.toList());
		assertEquals(List.of(1, 2, 2, 4), players.stream()
			.map(GameRoundPlayerEntity::getFinalRank)
			.toList());
		assertEquals(List.of("Alpha", "Beta", "Gamma", "Delta"), players
			.stream()
			.map(GameRoundPlayerEntity::getDisplayName)
			.toList());
	}

	@Test
	void persistsEveryCatchSnapshotAndAggregateExactly() {
		UserEntity user = saveUser("details", "Catch Details");
		UUID commonInstance = UUID.randomUUID();
		UUID rareInstance = UUID.randomUUID();
		UUID legendaryInstance = UUID.randomUUID();
		Instant commonAt = STARTED_AT.plusSeconds(30);
		Instant rareAt = STARTED_AT.plusSeconds(10);
		Instant legendaryAt = STARTED_AT.plusSeconds(20);
		List<CaughtCreatureResult> catches = List.of(
			catchResult(commonInstance, "sparkbit", "Sparkbit", "common", 10, commonAt),
			catchResult(rareInstance, "voltfox", "Voltfox", "rare", 30, rareAt),
			catchResult(
				legendaryInstance,
				"thunderwyrm",
				"Thunderwyrm",
				"legendary",
				100,
				legendaryAt
			)
		);
		CompletedRoundPersistenceOutcome outcome = persistenceService
			.persistIfAbsent(command(
				UUID.randomUUID(),
				1L,
				60,
				RoundEndReason.HOST_ENDED,
				ENDED_AT,
				List.of(player(user, 140, 1, catches))
			));
		GameRoundPlayerEntity persistedPlayer = playerRepository
			.findByGameRoundIdAndUserId(
				outcome.gameRoundId(),
				user.getUserId()
			)
			.orElseThrow();

		assertEquals(3, persistedPlayer.getCaughtTotal());
		assertEquals(1, persistedPlayer.getCommonCatches());
		assertEquals(1, persistedPlayer.getRareCatches());
		assertEquals(1, persistedPlayer.getLegendaryCatches());
		List<GameRoundPlayerCatchEntity> persistedCatches = catchRepository
			.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
				persistedPlayer.getGameRoundPlayerId()
			);
		assertEquals(List.of(rareAt, legendaryAt, commonAt), persistedCatches
			.stream()
			.map(GameRoundPlayerCatchEntity::getCaughtAt)
			.toList());

		GameRoundPlayerCatchEntity legendary = persistedCatches.get(1);
		assertEquals(persistedPlayer.getGameRoundPlayerId(), legendary
			.getGameRoundPlayerId());
		assertEquals(legendaryInstance, legendary.getCreatureInstanceId());
		assertEquals("thunderwyrm", legendary.getCreatureId());
		assertEquals("Thunderwyrm", legendary.getCreatureName());
		assertEquals("legendary", legendary.getRarity());
		assertEquals(100, legendary.getScoreAwarded());
		assertEquals(legendaryAt, legendary.getCaughtAt());
		assertNotNull(legendary.getCreatedAt());
	}

	@Test
	void ordinaryDuplicateCallReturnsExistingWithoutDuplicateChildren() {
		UserEntity user = saveUser("duplicate", "Duplicate Player");
		UUID roundInstanceId = UUID.randomUUID();
		CompletedRoundPersistenceCommand command = command(
			roundInstanceId,
			1L,
			60,
			RoundEndReason.HOST_ENDED,
			ENDED_AT,
			List.of(player(user, 10, 1, oneCatch("common", 10, 1)))
		);

		CompletedRoundPersistenceOutcome first =
			persistenceService.persistIfAbsent(command);
		CompletedRoundPersistenceOutcome second =
			persistenceService.persistIfAbsent(command);

		assertTrue(first.created());
		assertFalse(second.created());
		assertEquals(first.gameRoundId(), second.gameRoundId());
		assertEquals(1, roundRepository.count());
		assertEquals(1, playerRepository.count());
		assertEquals(1, catchRepository.count());
	}

	@Test
	void duplicateCatchConstraintRollsBackParentAndAllChildren() {
		UserEntity user = saveUser("rollback", "Rollback Player");
		UUID duplicateInstanceId = UUID.randomUUID();
		List<CaughtCreatureResult> duplicateCatches = List.of(
			catchResult(
				duplicateInstanceId,
				"sparkbit",
				"Sparkbit",
				"common",
				10,
				STARTED_AT.plusSeconds(1)
			),
			catchResult(
				duplicateInstanceId,
				"roadling",
				"Roadling",
				"common",
				10,
				STARTED_AT.plusSeconds(2)
			)
		);
		CompletedRoundPersistenceCommand command = command(
			UUID.randomUUID(),
			1L,
			60,
			RoundEndReason.HOST_ENDED,
			ENDED_AT,
			List.of(player(user, 20, 1, duplicateCatches))
		);

		assertThrows(
			DataIntegrityViolationException.class,
			() -> persistenceService.persistIfAbsent(command)
		);

		assertEquals(0, catchRepository.count());
		assertEquals(0, playerRepository.count());
		assertEquals(0, roundRepository.count());
	}

	@Test
	void persistedDisplayNameRemainsHistoricalAfterUserChanges() {
		UserEntity user = saveUser("historical", "Original Name");
		CompletedRoundPersistenceOutcome outcome = persistenceService
			.persistIfAbsent(command(
				UUID.randomUUID(),
				1L,
				60,
				RoundEndReason.HOST_ENDED,
				ENDED_AT,
				List.of(player(user, 0, 1, List.of()))
			));

		jdbcTemplate.update(
			"update users set display_name = ? where user_id = ?",
			"Current Name",
			user.getUserId()
		);

		GameRoundPlayerEntity persistedPlayer = playerRepository
			.findByGameRoundIdAndUserId(
				outcome.gameRoundId(),
				user.getUserId()
			)
			.orElseThrow();
		assertEquals("Original Name", persistedPlayer.getDisplayName());
		assertEquals(
			"Current Name",
			jdbcTemplate.queryForObject(
				"select display_name from users where user_id = ?",
				String.class,
				user.getUserId()
			)
		);
	}

	@Test
	void catchRepositoryUsesInstanceIdAsDeterministicTimestampTieBreaker() {
		UserEntity user = saveUser("ordering", "Ordering Player");
		Instant caughtAt = STARTED_AT.plusSeconds(10);
		UUID lowerInstance = UUID.fromString("00000000-0000-0000-0000-000000000001");
		UUID higherInstance = UUID.fromString("00000000-0000-0000-0000-000000000002");
		List<CaughtCreatureResult> catches = List.of(
			catchResult(higherInstance, "roadling", "Roadling", "common", 10, caughtAt),
			catchResult(lowerInstance, "sparkbit", "Sparkbit", "common", 10, caughtAt)
		);
		CompletedRoundPersistenceOutcome outcome = persistenceService
			.persistIfAbsent(command(
				UUID.randomUUID(),
				1L,
				60,
				RoundEndReason.HOST_ENDED,
				ENDED_AT,
				List.of(player(user, 20, 1, catches))
			));
		GameRoundPlayerEntity persistedPlayer = playerRepository
			.findByGameRoundIdAndUserId(
				outcome.gameRoundId(),
				user.getUserId()
			)
			.orElseThrow();

		assertEquals(
			List.of(lowerInstance, higherInstance),
			catchRepository
				.findAllByGameRoundPlayerIdOrderByCaughtAtAscCreatureInstanceIdAsc(
					persistedPlayer.getGameRoundPlayerId()
				)
				.stream()
				.map(GameRoundPlayerCatchEntity::getCreatureInstanceId)
				.toList()
		);
	}

	@Test
	void mapperRejectsDuplicateLeaderboardPlayerIdentity() {
		UserEntity user = saveUser("identity", "Identity Player");
		PlayerResult player = player(user, 0, 1, List.of());
		UUID roundInstanceId = UUID.randomUUID();
		PublicRoundResult publicResult = new PublicRoundResult(
			roundInstanceId,
			ROOM_CODE,
			STARTED_AT,
			ENDED_AT,
			RoundEndReason.HOST_ENDED,
			2,
			List.of(player.leaderboard(), player.leaderboard())
		);
		FinalizedRoomRound finalized = new FinalizedRoomRound(
			1L,
			publicResult,
			Map.of(user.getUserId(), personal(
				publicResult,
				player
			))
		);

		assertThrows(
			IllegalArgumentException.class,
			() -> persistenceService.persistIfAbsent(
				new CompletedRoundPersistenceCommand(finalized, 60)
			)
		);
		assertEquals(0, roundRepository.count());
	}

	private void clearData() {
		catchRepository.deleteAll();
		playerRepository.deleteAll();
		roundRepository.deleteAll();
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	private UserEntity saveUser(String username, String displayName) {
		return userRepository.saveAndFlush(new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			displayName,
			"hashed-password"
		));
	}

	private CompletedRoundPersistenceCommand command(
		UUID roundInstanceId,
		long generation,
		int durationSeconds,
		RoundEndReason endReason,
		Instant endedAt,
		List<PlayerResult> players
	) {
		List<RoundLeaderboardEntry> leaderboard = players.stream()
			.map(PlayerResult::leaderboard)
			.toList();
		PublicRoundResult publicResult = new PublicRoundResult(
			roundInstanceId,
			ROOM_CODE,
			STARTED_AT,
			endedAt,
			endReason,
			players.size(),
			leaderboard
		);
		Map<UUID, PersonalRoundResult> personalResults = new LinkedHashMap<>();
		players.forEach(player -> personalResults.put(
			player.user().getUserId(),
			personal(publicResult, player)
		));
		return new CompletedRoundPersistenceCommand(
			new FinalizedRoomRound(generation, publicResult, personalResults),
			durationSeconds
		);
	}

	private PersonalRoundResult personal(
		PublicRoundResult publicResult,
		PlayerResult player
	) {
		return new PersonalRoundResult(
			publicResult.roundId(),
			publicResult.roomCode(),
			player.user().getUserId(),
			player.user().getDisplayName(),
			player.score(),
			player.rank(),
			publicResult.playerCount(),
			player.catches().size(),
			rarityCounts(player.catches()),
			player.catches(),
			publicResult.startedAt(),
			publicResult.endedAt(),
			publicResult.endReason()
		);
	}

	private PlayerResult player(
		UserEntity user,
		int score,
		int rank,
		List<CaughtCreatureResult> catches
	) {
		return new PlayerResult(
			user,
			score,
			rank,
			List.copyOf(catches),
			new RoundLeaderboardEntry(
				user.getUserId(),
				user.getDisplayName(),
				score,
				rank,
				catches.size()
			)
		);
	}

	private List<CaughtCreatureResult> oneCatch(
		String rarity,
		int score,
		int secondsAfterStart
	) {
		return List.of(catchResult(
			UUID.randomUUID(),
			"creature-" + rarity,
			"Creature " + rarity,
			rarity,
			score,
			STARTED_AT.plusSeconds(secondsAfterStart)
		));
	}

	private CaughtCreatureResult catchResult(
		UUID instanceId,
		String creatureId,
		String name,
		String rarity,
		int score,
		Instant caughtAt
	) {
		return new CaughtCreatureResult(
			instanceId,
			creatureId,
			name,
			rarity,
			score,
			caughtAt
		);
	}

	private Map<String, Integer> rarityCounts(
		List<CaughtCreatureResult> catches
	) {
		Map<String, Integer> counts = new LinkedHashMap<>();
		catches.forEach(caught -> counts.merge(
			caught.rarity(),
			1,
			Integer::sum
		));
		return counts;
	}

	private record PlayerResult(
		UserEntity user,
		int score,
		int rank,
		List<CaughtCreatureResult> catches,
		RoundLeaderboardEntry leaderboard
	) {
	}
}
