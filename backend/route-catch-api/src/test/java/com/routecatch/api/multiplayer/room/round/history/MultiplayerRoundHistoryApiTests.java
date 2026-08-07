package com.routecatch.api.multiplayer.room.round.history;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.auth.service.JwtTokenService;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundEntity;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerCatchRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerEntity;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundRepository;

@SpringBootTest
@AutoConfigureMockMvc
class MultiplayerRoundHistoryApiTests {

	private static final String PATH = "/api/multiplayer/me/rounds";
	private static final Instant BASE_TIME = Instant.parse(
		"2026-08-02T10:21:54.425096Z"
	);

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JwtTokenService tokenService;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameRoundRepository roundRepository;

	@Autowired
	private GameRoundPlayerRepository playerRepository;

	@Autowired
	private GameRoundPlayerCatchRepository catchRepository;

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
	void authenticationAndEmptyDefaultPageUseRealSecurityChain()
		throws Exception {
		mockMvc.perform(get(PATH))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));

		AuthFixture user = saveUser("history_empty", "Empty History");
		mockMvc.perform(authenticatedGet(user))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content", hasSize(0)))
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(20))
			.andExpect(jsonPath("$.totalElements").value(0))
			.andExpect(jsonPath("$.totalPages").value(0));
	}

	@Test
	void returnsOnlyRequesterEndedRoundsWithBoundedSummaryAndStablePages()
		throws Exception {
		AuthFixture userA = saveUser("history_api_a", "Current Shared Name");
		AuthFixture userB = saveUser("history_api_b", "Current Shared Name");
		UUID olderId = uuid(10);
		UUID lowerTieId = uuid(11);
		UUID higherTieId = uuid(12);

		GameRoundEntity older = saveRound(
			olderId, "ROOMA1", BASE_TIME.minusSeconds(30), RoomGameStatus.ENDED, 2
		);
		savePlayer(older, userA, "Old A", 90, 2, 3, 2);
		savePlayer(older, userB, "Old B", 280, 1, 6, 1);

		GameRoundEntity lowerTie = saveRound(
			lowerTieId, "ROOMB2", BASE_TIME, RoomGameStatus.ENDED, 1
		);
		savePlayer(lowerTie, userA, "Historical A", 280, 1, 6, 1);

		GameRoundEntity higherTie = saveRound(
			higherTieId, "ROOMC3", BASE_TIME, RoomGameStatus.ENDED, 1
		);
		savePlayer(higherTie, userA, "Earlier Display Name", 120, 1, 2, 1);

		GameRoundEntity onlyB = saveRound(
			uuid(13), "ONLYB1", BASE_TIME.plusSeconds(30), RoomGameStatus.ENDED, 1
		);
		savePlayer(onlyB, userB, "Current Shared Name", 999, 1, 9, 1);

		GameRoundEntity running = saveRound(
			uuid(14), "ACTIVE", BASE_TIME.plusSeconds(60), RoomGameStatus.RUNNING, 1
		);
		savePlayer(running, userA, "Current Shared Name", 999, 1, 9, 1);

		mockMvc.perform(authenticatedGet(userA))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content", hasSize(3)))
			.andExpect(jsonPath("$.content[0].roundId")
				.value(higherTieId.toString()))
			.andExpect(jsonPath("$.content[1].roundId")
				.value(lowerTieId.toString()))
			.andExpect(jsonPath("$.content[1].roomCode").value("ROOMB2"))
			.andExpect(jsonPath("$.content[1].startedAt")
				.value(BASE_TIME.minusSeconds(60).toString()))
			.andExpect(jsonPath("$.content[1].endedAt")
				.value(BASE_TIME.toString()))
			.andExpect(jsonPath("$.content[1].endReason")
				.value("TIME_EXPIRED"))
			.andExpect(jsonPath("$.content[1].durationSeconds").value(60))
			.andExpect(jsonPath("$.content[1].participantCount").value(1))
			.andExpect(jsonPath("$.content[1].rank").value(1))
			.andExpect(jsonPath("$.content[1].score").value(280))
			.andExpect(jsonPath("$.content[1].creaturesCaught").value(6))
			.andExpect(jsonPath("$.content[1].leaderboard").doesNotExist())
			.andExpect(jsonPath("$.content[1].caughtCreatures").doesNotExist())
			.andExpect(jsonPath("$.content[1].displayName").doesNotExist())
			.andExpect(jsonPath("$.totalElements").value(3));

		mockMvc.perform(authenticatedGet(userA)
				.param("page", "0")
				.param("size", "2")
				.param("userId", userB.user().getUserId().toString()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content", hasSize(2)))
			.andExpect(jsonPath("$.content[0].roundId")
				.value(higherTieId.toString()))
			.andExpect(jsonPath("$.content[1].roundId")
				.value(lowerTieId.toString()))
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(2))
			.andExpect(jsonPath("$.totalElements").value(3))
			.andExpect(jsonPath("$.totalPages").value(2));

		mockMvc.perform(authenticatedGet(userA)
				.param("page", "1")
				.param("size", "2"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content", hasSize(1)))
			.andExpect(jsonPath("$.content[0].roundId").value(olderId.toString()))
			.andExpect(jsonPath("$.totalElements").value(3))
			.andExpect(jsonPath("$.totalPages").value(2));

		mockMvc.perform(authenticatedGet(userA)
				.param("page", "8")
				.param("size", "2"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content", hasSize(0)))
			.andExpect(jsonPath("$.page").value(8))
			.andExpect(jsonPath("$.size").value(2))
			.andExpect(jsonPath("$.totalElements").value(3))
			.andExpect(jsonPath("$.totalPages").value(2));

		mockMvc.perform(authenticatedGet(userB))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content", hasSize(2)))
			.andExpect(jsonPath("$.content[0].roundId").value(uuid(13).toString()))
			.andExpect(jsonPath("$.content[1].roundId").value(olderId.toString()))
			.andExpect(jsonPath("$.content[1].score").value(280));
	}

	@Test
	void validatesPageSizeAndMalformedNumbersWithExistingErrorContract()
		throws Exception {
		AuthFixture user = saveUser("history_validation", "Validation User");

		assertValidation(user, "page", "-1", "VALIDATION_ERROR");
		assertValidation(user, "size", "0", "VALIDATION_ERROR");
		assertValidation(user, "size", "101", "VALIDATION_ERROR");
		assertValidation(user, "page", "not-a-number", "INVALID_PATH_PARAMETER");

		mockMvc.perform(authenticatedGet(user).param("size", "1"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.size").value(1));
		mockMvc.perform(authenticatedGet(user).param("size", "100"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.size").value(100));
	}

	private void assertValidation(
		AuthFixture user,
		String parameter,
		String value,
		String errorCode
	) throws Exception {
		mockMvc.perform(authenticatedGet(user).param(parameter, value))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value(errorCode))
			.andExpect(jsonPath("$.path").value(PATH));
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
		authenticatedGet(AuthFixture user) {
		return get(PATH).header("Authorization", "Bearer " + user.token());
	}

	private AuthFixture saveUser(String username, String displayName) {
		UserEntity user = userRepository.saveAndFlush(new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			displayName,
			"hashed-password"
		));
		return new AuthFixture(tokenService.generateToken(user), user);
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
		AuthFixture user,
		String historicalDisplayName,
		int score,
		int rank,
		int caughtTotal,
		int position
	) {
		playerRepository.saveAndFlush(new GameRoundPlayerEntity(
			UUID.randomUUID(),
			round.getGameRoundId(),
			user.user().getUserId(),
			position,
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

	private record AuthFixture(String token, UserEntity user) {
	}
}
