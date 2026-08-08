package com.routecatch.api.multiplayer.room.round.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundEntity;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerCatchRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerEntity;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundRepository;
import com.routecatch.api.multiplayer.room.round.persistence.MultiplayerRoundHistoryProjection;

@SpringBootTest
class MultiplayerRoundHistoryRepositoryTests {

	private static final Instant BASE_TIME = Instant.parse(
		"2026-08-02T12:00:00Z"
	);

	@Autowired
	private GameRoundPlayerRepository playerRepository;

	@Autowired
	private GameRoundRepository roundRepository;

	@Autowired
	private GameRoundPlayerCatchRepository catchRepository;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@BeforeEach
	void clearBeforeTest() {
		clearData();
	}

	@AfterEach
	void clearAfterTest() {
		clearData();
	}

	@Test
	void queryFiltersByUserAndEndedStatusWithStableDatabasePagination() {
		UserEntity userA = saveUser("history_repo_a", "Same Name");
		UserEntity userB = saveUser("history_repo_b", "Same Name");
		UUID olderId = uuid(1);
		UUID lowerTieId = uuid(2);
		UUID higherTieId = uuid(3);

		GameRoundEntity older = saveRound(
			olderId,
			"OLDER1",
			BASE_TIME.minusSeconds(30),
			RoomGameStatus.ENDED,
			2
		);
		savePlayer(older, userA, "Former A", 90, 2, 3);
		savePlayer(older, userB, "Former B", 100, 1, 4);

		GameRoundEntity lowerTie = saveRound(
			lowerTieId,
			"LOWTIE",
			BASE_TIME,
			RoomGameStatus.ENDED,
			1
		);
		savePlayer(lowerTie, userA, "Renamed A", 280, 1, 6);

		GameRoundEntity higherTie = saveRound(
			higherTieId,
			"HIGHTI",
			BASE_TIME,
			RoomGameStatus.ENDED,
			1
		);
		savePlayer(higherTie, userA, "Another Historical Name", 120, 1, 2);

		GameRoundEntity running = saveRound(
			uuid(4),
			"RUNNING",
			BASE_TIME.plusSeconds(60),
			RoomGameStatus.RUNNING,
			1
		);
		savePlayer(running, userA, "Same Name", 999, 1, 9);

		GameRoundEntity onlyB = saveRound(
			uuid(5),
			"ONLYB1",
			BASE_TIME.plusSeconds(30),
			RoomGameStatus.ENDED,
			1
		);
		savePlayer(onlyB, userB, "Same Name", 500, 1, 5);

		Page<MultiplayerRoundHistoryProjection> first = history(userA, 0, 2);
		Page<MultiplayerRoundHistoryProjection> second = history(userA, 1, 2);

		assertEquals(3, first.getTotalElements());
		assertEquals(2, first.getTotalPages());
		assertEquals(2, first.getNumberOfElements());
		assertEquals(higherTieId, first.getContent().get(0).getRoundId());
		assertEquals(lowerTieId, first.getContent().get(1).getRoundId());
		assertEquals(olderId, second.getContent().getFirst().getRoundId());
		assertEquals("LOWTIE", first.getContent().get(1).getRoomCode());
		assertEquals(BASE_TIME.minusSeconds(60),
			first.getContent().get(1).getStartedAt());
		assertEquals(RoundEndReason.TIME_EXPIRED,
			first.getContent().get(1).getEndReason());
		assertEquals(60, first.getContent().get(1).getDurationSeconds());
		assertEquals(1, first.getContent().get(1).getParticipantCount());
		assertEquals(1, first.getContent().get(1).getRank());
		assertEquals(280, first.getContent().get(1).getScore());
		assertEquals(6, first.getContent().get(1).getCreaturesCaught());

		Page<MultiplayerRoundHistoryProjection> userBHistory = history(userB, 0, 20);
		assertEquals(2, userBHistory.getTotalElements());
		assertEquals(uuid(5), userBHistory.getContent().get(0).getRoundId());
		assertEquals(olderId, userBHistory.getContent().get(1).getRoundId());
		assertTrue(history(userA, 3, 2).getContent().isEmpty());
	}

	private Page<MultiplayerRoundHistoryProjection> history(
		UserEntity user,
		int page,
		int size
	) {
		return playerRepository.findCompletedHistoryByUserId(
			user.getUserId(),
			RoomGameStatus.ENDED,
			PageRequest.of(page, size)
		);
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

	private GameRoundEntity saveRound(
		UUID roundId,
		String roomCode,
		Instant endedAt,
		RoomGameStatus status,
		int participantCount
	) {
		return roundRepository.saveAndFlush(new GameRoundEntity(
			UUID.randomUUID(),
			roundId,
			roomCode,
			1,
			status,
			RoundEndReason.TIME_EXPIRED,
			endedAt.minusSeconds(60),
			endedAt,
			60,
			participantCount,
			endedAt
		));
	}

	private void savePlayer(
		GameRoundEntity round,
		UserEntity user,
		String historicalDisplayName,
		int score,
		int rank,
		int caughtTotal
	) {
		playerRepository.saveAndFlush(new GameRoundPlayerEntity(
			UUID.randomUUID(),
			round.getGameRoundId(),
			user.getUserId(),
			rank,
			historicalDisplayName,
			score,
			rank,
			caughtTotal,
			caughtTotal,
			0,
			0,
			null,
			round.getEndedAt()
		));
	}

	private UUID uuid(long value) {
		return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(value));
	}

	private void clearData() {
		catchRepository.deleteAll();
		playerRepository.deleteAll();
		roundRepository.deleteAll();
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}
}
