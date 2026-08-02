package com.routecatch.api.multiplayer.room.round.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
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
import com.routecatch.api.multiplayer.room.round.RoundEndReason;

@SpringBootTest
class CompletedRoundDatabaseConstraintTests {

	private static final Instant STARTED_AT = Instant.parse(
		"2026-08-02T08:00:00Z"
	);
	private static final Instant ENDED_AT = STARTED_AT.plusSeconds(60);
	private static final Instant CREATED_AT = ENDED_AT.plusSeconds(1);

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
	void deletingRoundCascadesPlayersAndCatches() {
		UserEntity firstUser = saveUser("round-cascade-1", "Round Cascade One");
		UserEntity secondUser = saveUser("round-cascade-2", "Round Cascade Two");
		RoundRow round = validRound(2);
		PlayerRow firstPlayer = catchingPlayer(round, firstUser, 1);
		PlayerRow secondPlayer = catchingPlayer(round, secondUser, 2);
		insertRound(round);
		insertPlayer(firstPlayer);
		insertPlayer(secondPlayer);
		insertCatch(validCatch(firstPlayer));
		insertCatch(validCatch(secondPlayer));

		assertEquals(1, roundRepository.count());
		assertEquals(2, playerRepository.count());
		assertEquals(2, catchRepository.count());

		jdbcTemplate.update(
			"delete from game_rounds where game_round_id = ?",
			round.gameRoundId()
		);

		assertTrue(roundRepository.findById(round.gameRoundId()).isEmpty());
		assertEquals(0, playerRepository.countByGameRoundId(round.gameRoundId()));
		assertEquals(0, catchRepository.count());
	}

	@Test
	void deletingPlayerCascadesCatchesAndPreservesRoundAndOtherPlayers() {
		UserEntity deletedUser = saveUser("player-cascade-1", "Deleted Player");
		UserEntity retainedUser = saveUser("player-cascade-2", "Retained Player");
		RoundRow round = validRound(2);
		PlayerRow deletedPlayer = catchingPlayer(round, deletedUser, 1);
		PlayerRow retainedPlayer = catchingPlayer(round, retainedUser, 2);
		insertRound(round);
		insertPlayer(deletedPlayer);
		insertPlayer(retainedPlayer);
		insertCatch(validCatch(deletedPlayer));
		insertCatch(validCatch(retainedPlayer));

		jdbcTemplate.update(
			"delete from game_round_players where game_round_player_id = ?",
			deletedPlayer.gameRoundPlayerId()
		);

		assertTrue(playerRepository
			.findById(deletedPlayer.gameRoundPlayerId())
			.isEmpty());
		assertEquals(0, catchRepository.countByGameRoundPlayerId(
			deletedPlayer.gameRoundPlayerId()
		));
		assertTrue(roundRepository.existsById(round.gameRoundId()));
		assertTrue(playerRepository.existsById(retainedPlayer.gameRoundPlayerId()));
		assertEquals(1, playerRepository.countByGameRoundId(round.gameRoundId()));
		assertEquals(1, catchRepository.countByGameRoundPlayerId(
			retainedPlayer.gameRoundPlayerId()
		));
	}

	@Test
	void deletingReferencedUserIsRestrictedAndHistoryRemains() {
		UserEntity user = saveUser("restricted-user", "Restricted User");
		RoundRow round = validRound(1);
		PlayerRow player = catchingPlayer(round, user, 1);
		CatchRow caught = validCatch(player);
		insertRound(round);
		insertPlayer(player);
		insertCatch(caught);

		assertConstraintViolation(
			"referenced user deletion",
			() -> jdbcTemplate.update(
				"delete from users where user_id = ?",
				user.getUserId()
			)
		);

		assertTrue(userRepository.existsById(user.getUserId()));
		assertTrue(roundRepository.existsById(round.gameRoundId()));
		assertTrue(playerRepository.existsById(player.gameRoundPlayerId()));
		assertTrue(catchRepository.existsById(caught.gameRoundPlayerCatchId()));
	}

	@Test
	void duplicateRoundInstanceIdIsRejected() {
		UUID roundInstanceId = UUID.randomUUID();
		RoundRow first = validRound(0).withRoundInstanceId(roundInstanceId);
		RoundRow duplicate = validRound(0).withRoundInstanceId(roundInstanceId);
		insertRound(first);

		assertConstraintViolation(
			"duplicate round_instance_id",
			() -> insertRound(duplicate)
		);

		assertEquals(1, roundRepository.count());
		assertEquals(
			first.gameRoundId(),
			roundRepository.findByRoundInstanceId(roundInstanceId)
				.orElseThrow()
				.getGameRoundId()
		);
	}

	@Test
	void duplicateRoundAndUserIsRejected() {
		UserEntity user = saveUser("duplicate-round-user", "Duplicate User");
		RoundRow round = validRound(1);
		PlayerRow first = validPlayer(round, user, 1);
		PlayerRow duplicate = validPlayer(round, user, 2);
		insertRound(round);
		insertPlayer(first);

		assertConstraintViolation(
			"duplicate game_round_id and user_id",
			() -> insertPlayer(duplicate)
		);

		assertEquals(1, playerRepository.countByGameRoundId(round.gameRoundId()));
		assertTrue(playerRepository.existsById(first.gameRoundPlayerId()));
	}

	@Test
	void duplicateLeaderboardPositionIsRejectedButTiedRanksRemainValid() {
		UserEntity firstUser = saveUser("position-1", "Position One");
		UserEntity secondUser = saveUser("position-2", "Position Two");
		UserEntity duplicateUser = saveUser("position-3", "Position Three");
		RoundRow round = validRound(2);
		PlayerRow first = validPlayer(round, firstUser, 1).withFinalRank(2);
		PlayerRow second = validPlayer(round, secondUser, 2).withFinalRank(2);
		PlayerRow duplicate = validPlayer(round, duplicateUser, 2)
			.withFinalRank(3);
		insertRound(round);
		insertPlayer(first);
		insertPlayer(second);

		List<GameRoundPlayerEntity> tiedPlayers = playerRepository
			.findAllByGameRoundIdOrderByLeaderboardPositionAsc(round.gameRoundId());
		assertEquals(List.of(1, 2), tiedPlayers.stream()
			.map(GameRoundPlayerEntity::getLeaderboardPosition)
			.toList());
		assertEquals(List.of(2, 2), tiedPlayers.stream()
			.map(GameRoundPlayerEntity::getFinalRank)
			.toList());

		assertConstraintViolation(
			"duplicate game_round_id and leaderboard_position",
			() -> insertPlayer(duplicate)
		);

		assertEquals(2, playerRepository.countByGameRoundId(round.gameRoundId()));
	}

	@Test
	void duplicatePlayerAndCreatureInstanceIsRejected() {
		UserEntity user = saveUser("duplicate-catch", "Duplicate Catch");
		RoundRow round = validRound(1);
		PlayerRow player = catchingPlayer(round, user, 1);
		UUID creatureInstanceId = UUID.randomUUID();
		CatchRow first = validCatch(player)
			.withCreatureInstanceId(creatureInstanceId);
		CatchRow duplicate = validCatch(player)
			.withCreatureInstanceId(creatureInstanceId);
		insertRound(round);
		insertPlayer(player);
		insertCatch(first);

		assertConstraintViolation(
			"duplicate game_round_player_id and creature_instance_id",
			() -> insertCatch(duplicate)
		);

		assertEquals(1, catchRepository.countByGameRoundPlayerId(
			player.gameRoundPlayerId()
		));
		assertTrue(catchRepository.existsById(first.gameRoundPlayerCatchId()));
	}

	@Test
	void roundRejectsNonPositiveDuration() {
		RoundRow invalid = validRound(0).withDurationSeconds(0);

		assertConstraintViolation(
			"non-positive duration_seconds",
			() -> insertRound(invalid)
		);
		assertEquals(0, roundRepository.count());
	}

	@Test
	void roundRejectsNegativeParticipantCount() {
		RoundRow invalid = validRound(0).withParticipantCount(-1);

		assertConstraintViolation(
			"negative participant_count",
			() -> insertRound(invalid)
		);
		assertEquals(0, roundRepository.count());
	}

	@Test
	void roundRejectsBlankRoomCode() {
		RoundRow invalid = validRound(0).withRoomCode("   ");

		assertConstraintViolation(
			"blank room_code",
			() -> insertRound(invalid)
		);
		assertEquals(0, roundRepository.count());
	}

	@Test
	void playerRejectsNonPositiveLeaderboardPosition() {
		PlayerConstraintFixture fixture = playerConstraintFixture();
		PlayerRow invalid = fixture.player().withLeaderboardPosition(0);

		assertConstraintViolation(
			"non-positive leaderboard_position",
			() -> insertPlayer(invalid)
		);
		assertNoPlayers(fixture.round());
	}

	@Test
	void playerRejectsNonPositiveFinalRank() {
		PlayerConstraintFixture fixture = playerConstraintFixture();
		PlayerRow invalid = fixture.player().withFinalRank(0);

		assertConstraintViolation(
			"non-positive final_rank",
			() -> insertPlayer(invalid)
		);
		assertNoPlayers(fixture.round());
	}

	@Test
	void playerRejectsNegativeFinalScore() {
		PlayerConstraintFixture fixture = playerConstraintFixture();
		PlayerRow invalid = fixture.player().withFinalScore(-1);

		assertConstraintViolation(
			"negative final_score",
			() -> insertPlayer(invalid)
		);
		assertNoPlayers(fixture.round());
	}

	@Test
	void playerRejectsNegativeCatchCount() {
		PlayerConstraintFixture fixture = playerConstraintFixture();
		PlayerRow invalid = fixture.player().withCatchCounts(0, -1, 1, 0);

		assertConstraintViolation(
			"negative common_catches",
			() -> insertPlayer(invalid)
		);
		assertNoPlayers(fixture.round());
	}

	@Test
	void playerRejectsMismatchedCatchTotals() {
		PlayerConstraintFixture fixture = playerConstraintFixture();
		PlayerRow invalid = fixture.player().withCatchCounts(1, 0, 0, 0);

		assertConstraintViolation(
			"caught_total does not match rarity totals",
			() -> insertPlayer(invalid)
		);
		assertNoPlayers(fixture.round());
	}

	@Test
	void playerRejectsBlankDisplayName() {
		PlayerConstraintFixture fixture = playerConstraintFixture();
		PlayerRow invalid = fixture.player().withDisplayName("   ");

		assertConstraintViolation(
			"blank display_name",
			() -> insertPlayer(invalid)
		);
		assertNoPlayers(fixture.round());
	}

	@Test
	void catchRejectsNegativeScoreAwarded() {
		CatchConstraintFixture fixture = catchConstraintFixture();
		CatchRow invalid = fixture.caught().withScoreAwarded(-1);

		assertConstraintViolation(
			"negative score_awarded",
			() -> insertCatch(invalid)
		);
		assertNoCatches(fixture.player());
	}

	@Test
	void catchRejectsBlankCreatureId() {
		CatchConstraintFixture fixture = catchConstraintFixture();
		CatchRow invalid = fixture.caught().withCreatureId("   ");

		assertConstraintViolation(
			"blank creature_id",
			() -> insertCatch(invalid)
		);
		assertNoCatches(fixture.player());
	}

	@Test
	void catchRejectsBlankCreatureName() {
		CatchConstraintFixture fixture = catchConstraintFixture();
		CatchRow invalid = fixture.caught().withCreatureName("   ");

		assertConstraintViolation(
			"blank creature_name",
			() -> insertCatch(invalid)
		);
		assertNoCatches(fixture.player());
	}

	@Test
	void catchRejectsBlankRarity() {
		CatchConstraintFixture fixture = catchConstraintFixture();
		CatchRow invalid = fixture.caught().withRarity("   ");

		assertConstraintViolation(
			"blank rarity",
			() -> insertCatch(invalid)
		);
		assertNoCatches(fixture.player());
	}

	private PlayerConstraintFixture playerConstraintFixture() {
		UserEntity user = saveUser(
			"player-check-" + shortId(),
			"Player Check"
		);
		RoundRow round = validRound(1);
		insertRound(round);
		return new PlayerConstraintFixture(round, validPlayer(round, user, 1));
	}

	private CatchConstraintFixture catchConstraintFixture() {
		UserEntity user = saveUser(
			"catch-check-" + shortId(),
			"Catch Check"
		);
		RoundRow round = validRound(1);
		PlayerRow player = validPlayer(round, user, 1);
		insertRound(round);
		insertPlayer(player);
		return new CatchConstraintFixture(player, validCatch(player));
	}

	private RoundRow validRound(int participantCount) {
		return new RoundRow(
			UUID.randomUUID(),
			UUID.randomUUID(),
			"AB12CD",
			60,
			participantCount
		);
	}

	private PlayerRow validPlayer(
		RoundRow round,
		UserEntity user,
		int leaderboardPosition
	) {
		return new PlayerRow(
			UUID.randomUUID(),
			round.gameRoundId(),
			user.getUserId(),
			leaderboardPosition,
			user.getDisplayName(),
			0,
			1,
			0,
			0,
			0,
			0
		);
	}

	private PlayerRow catchingPlayer(
		RoundRow round,
		UserEntity user,
		int leaderboardPosition
	) {
		return validPlayer(round, user, leaderboardPosition)
			.withFinalScore(10)
			.withCatchCounts(1, 1, 0, 0);
	}

	private CatchRow validCatch(PlayerRow player) {
		return new CatchRow(
			UUID.randomUUID(),
			player.gameRoundPlayerId(),
			UUID.randomUUID(),
			"sparkbit",
			"Sparkbit",
			"common",
			10
		);
	}

	private void insertRound(RoundRow round) {
		jdbcTemplate.update(
			"""
			insert into game_rounds (
				game_round_id,
				round_instance_id,
				room_code,
				round_generation,
				status,
				end_reason,
				started_at,
				ended_at,
				duration_seconds,
				participant_count,
				created_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			round.gameRoundId(),
			round.roundInstanceId(),
			round.roomCode(),
			1L,
			RoomGameStatus.ENDED.name(),
			RoundEndReason.HOST_ENDED.name(),
			STARTED_AT,
			ENDED_AT,
			round.durationSeconds(),
			round.participantCount(),
			CREATED_AT
		);
	}

	private void insertPlayer(PlayerRow player) {
		jdbcTemplate.update(
			"""
			insert into game_round_players (
				game_round_player_id,
				game_round_id,
				user_id,
				leaderboard_position,
				display_name,
				final_score,
				final_rank,
				caught_total,
				common_catches,
				rare_catches,
				legendary_catches,
				joined_at,
				created_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			player.gameRoundPlayerId(),
			player.gameRoundId(),
			player.userId(),
			player.leaderboardPosition(),
			player.displayName(),
			player.finalScore(),
			player.finalRank(),
			player.caughtTotal(),
			player.commonCatches(),
			player.rareCatches(),
			player.legendaryCatches(),
			null,
			CREATED_AT
		);
	}

	private void insertCatch(CatchRow caught) {
		jdbcTemplate.update(
			"""
			insert into game_round_player_catches (
				game_round_player_catch_id,
				game_round_player_id,
				creature_instance_id,
				creature_id,
				creature_name,
				rarity,
				score_awarded,
				caught_at,
				created_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
			""",
			caught.gameRoundPlayerCatchId(),
			caught.gameRoundPlayerId(),
			caught.creatureInstanceId(),
			caught.creatureId(),
			caught.creatureName(),
			caught.rarity(),
			caught.scoreAwarded(),
			STARTED_AT.plusSeconds(10),
			CREATED_AT
		);
	}

	private void assertConstraintViolation(String description, Runnable operation) {
		assertThrows(
			DataIntegrityViolationException.class,
			operation::run,
			description
		);
	}

	private void assertNoPlayers(RoundRow round) {
		assertEquals(0, playerRepository.countByGameRoundId(round.gameRoundId()));
		assertTrue(roundRepository.existsById(round.gameRoundId()));
	}

	private void assertNoCatches(PlayerRow player) {
		assertEquals(0, catchRepository.countByGameRoundPlayerId(
			player.gameRoundPlayerId()
		));
		assertTrue(playerRepository.existsById(player.gameRoundPlayerId()));
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

	private String shortId() {
		return UUID.randomUUID().toString().substring(0, 8);
	}

	private void clearData() {
		catchRepository.deleteAll();
		playerRepository.deleteAll();
		roundRepository.deleteAll();
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	private record PlayerConstraintFixture(RoundRow round, PlayerRow player) {
	}

	private record CatchConstraintFixture(PlayerRow player, CatchRow caught) {
	}

	private record RoundRow(
		UUID gameRoundId,
		UUID roundInstanceId,
		String roomCode,
		int durationSeconds,
		int participantCount
	) {

		private RoundRow withRoundInstanceId(UUID value) {
			return new RoundRow(
				gameRoundId,
				value,
				roomCode,
				durationSeconds,
				participantCount
			);
		}

		private RoundRow withRoomCode(String value) {
			return new RoundRow(
				gameRoundId,
				roundInstanceId,
				value,
				durationSeconds,
				participantCount
			);
		}

		private RoundRow withDurationSeconds(int value) {
			return new RoundRow(
				gameRoundId,
				roundInstanceId,
				roomCode,
				value,
				participantCount
			);
		}

		private RoundRow withParticipantCount(int value) {
			return new RoundRow(
				gameRoundId,
				roundInstanceId,
				roomCode,
				durationSeconds,
				value
			);
		}
	}

	private record PlayerRow(
		UUID gameRoundPlayerId,
		UUID gameRoundId,
		UUID userId,
		int leaderboardPosition,
		String displayName,
		int finalScore,
		int finalRank,
		int caughtTotal,
		int commonCatches,
		int rareCatches,
		int legendaryCatches
	) {

		private PlayerRow withLeaderboardPosition(int value) {
			return copy(value, displayName, finalScore, finalRank, caughtTotal,
				commonCatches, rareCatches, legendaryCatches);
		}

		private PlayerRow withDisplayName(String value) {
			return copy(leaderboardPosition, value, finalScore, finalRank, caughtTotal,
				commonCatches, rareCatches, legendaryCatches);
		}

		private PlayerRow withFinalScore(int value) {
			return copy(leaderboardPosition, displayName, value, finalRank, caughtTotal,
				commonCatches, rareCatches, legendaryCatches);
		}

		private PlayerRow withFinalRank(int value) {
			return copy(leaderboardPosition, displayName, finalScore, value, caughtTotal,
				commonCatches, rareCatches, legendaryCatches);
		}

		private PlayerRow withCatchCounts(
			int total,
			int common,
			int rare,
			int legendary
		) {
			return copy(
				leaderboardPosition,
				displayName,
				finalScore,
				finalRank,
				total,
				common,
				rare,
				legendary
			);
		}

		private PlayerRow copy(
			int position,
			String name,
			int score,
			int rank,
			int total,
			int common,
			int rare,
			int legendary
		) {
			return new PlayerRow(
				gameRoundPlayerId,
				gameRoundId,
				userId,
				position,
				name,
				score,
				rank,
				total,
				common,
				rare,
				legendary
			);
		}
	}

	private record CatchRow(
		UUID gameRoundPlayerCatchId,
		UUID gameRoundPlayerId,
		UUID creatureInstanceId,
		String creatureId,
		String creatureName,
		String rarity,
		int scoreAwarded
	) {

		private CatchRow withCreatureInstanceId(UUID value) {
			return copy(value, creatureId, creatureName, rarity, scoreAwarded);
		}

		private CatchRow withCreatureId(String value) {
			return copy(creatureInstanceId, value, creatureName, rarity, scoreAwarded);
		}

		private CatchRow withCreatureName(String value) {
			return copy(creatureInstanceId, creatureId, value, rarity, scoreAwarded);
		}

		private CatchRow withRarity(String value) {
			return copy(creatureInstanceId, creatureId, creatureName, value, scoreAwarded);
		}

		private CatchRow withScoreAwarded(int value) {
			return copy(creatureInstanceId, creatureId, creatureName, rarity, value);
		}

		private CatchRow copy(
			UUID instanceId,
			String id,
			String name,
			String catchRarity,
			int score
		) {
			return new CatchRow(
				gameRoundPlayerCatchId,
				gameRoundPlayerId,
				instanceId,
				id,
				name,
				catchRarity,
				score
			);
		}
	}
}
