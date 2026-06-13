package com.routecatch.api.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.game.service.GameSessionService;

@SpringBootTest
@AutoConfigureMockMvc
class GameLeaderboardApiTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private GameSessionService gameSessionService;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@BeforeEach
	void clearGameData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
	}

	@Test
	void leaderboardReturnsOnlyEndedSessions() throws Exception {
		GameSession created = gameSessionService.createSession(60);
		GameSession running = gameSessionService.createSession(60);
		gameSessionService.startSession(running.sessionId());
		GameSession ended = createEndedSession("sparkbit");

		mockMvc.perform(get("/api/game/leaderboard"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(1))
			.andExpect(jsonPath("$[0].rank").value(1))
			.andExpect(jsonPath("$[0].sessionId").value(
				ended.sessionId().toString()
			))
			.andExpect(jsonPath("$[0].score").value(10))
			.andExpect(jsonPath("$[0].caughtCount").value(1))
			.andExpect(jsonPath("$[0].durationSeconds").value(60))
			.andExpect(jsonPath("$[0].startedAt").isNotEmpty())
			.andExpect(jsonPath("$[0].endedAt").isNotEmpty());

		assertEquals(
			GameSessionStatus.CREATED,
			gameSessionRepository
				.findById(created.sessionId())
				.orElseThrow()
				.getStatus()
		);
		assertEquals(
			GameSessionStatus.RUNNING,
			gameSessionRepository
				.findById(running.sessionId())
				.orElseThrow()
				.getStatus()
		);
	}

	@Test
	void leaderboardSortsByScoreDescending() throws Exception {
		GameSession lowerScore = createEndedSession("sparkbit");
		GameSession higherScore = createEndedSession("voltfox");

		mockMvc.perform(get("/api/game/leaderboard"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$[0].sessionId").value(
				higherScore.sessionId().toString()
			))
			.andExpect(jsonPath("$[0].score").value(30))
			.andExpect(jsonPath("$[1].sessionId").value(
				lowerScore.sessionId().toString()
			))
			.andExpect(jsonPath("$[1].score").value(10));
	}

	@Test
	void leaderboardBreaksScoreTieByCaughtCountDescending() throws Exception {
		GameSession fewerCatches = createEndedSession("voltfox");
		GameSession moreCatches = createEndedSession(
			"sparkbit",
			"roadling",
			"dustpup"
		);

		mockMvc.perform(get("/api/game/leaderboard"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$[0].sessionId").value(
				moreCatches.sessionId().toString()
			))
			.andExpect(jsonPath("$[0].score").value(30))
			.andExpect(jsonPath("$[0].caughtCount").value(3))
			.andExpect(jsonPath("$[1].sessionId").value(
				fewerCatches.sessionId().toString()
			))
			.andExpect(jsonPath("$[1].caughtCount").value(1));
	}

	@Test
	void leaderboardHonorsLimit() throws Exception {
		createEndedSession("sparkbit");
		createEndedSession("voltfox");

		mockMvc.perform(get("/api/game/leaderboard").param("limit", "1"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(1))
			.andExpect(jsonPath("$[0].rank").value(1));
	}

	@Test
	void leaderboardRejectsInvalidLimit() throws Exception {
		mockMvc.perform(get("/api/game/leaderboard").param("limit", "101"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value(
				"limit must be between 1 and 100"
			))
			.andExpect(jsonPath("$.path").value("/api/game/leaderboard"));
	}

	@Test
	void emptyLeaderboardReturnsEmptyArray() throws Exception {
		mockMvc.perform(get("/api/game/leaderboard"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(0));
	}

	@Test
	void staleRunningSessionIsExpiredAndIncluded() throws Exception {
		GameSession session = gameSessionService.createSession(60);
		GameSessionEntity persistedSession = gameSessionRepository
			.findById(session.sessionId())
			.orElseThrow();
		Instant startedAt = Instant.now().minusSeconds(61);
		persistedSession.start(startedAt);
		gameSessionRepository.saveAndFlush(persistedSession);
		Instant persistedStartedAt = gameSessionRepository
			.findById(session.sessionId())
			.orElseThrow()
			.getStartedAt();

		mockMvc.perform(get("/api/game/leaderboard"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(1))
			.andExpect(jsonPath("$[0].sessionId").value(
				session.sessionId().toString()
			))
			.andExpect(jsonPath("$[0].score").value(0));

		GameSessionEntity expiredSession = gameSessionRepository
			.findById(session.sessionId())
			.orElseThrow();

		assertEquals(GameSessionStatus.ENDED, expiredSession.getStatus());
		assertEquals(
			persistedStartedAt.plusSeconds(60),
			expiredSession.getEndedAt()
		);
	}

	private GameSession createEndedSession(String... creatureIds) {
		GameSession session = gameSessionService.createSession(60);
		gameSessionService.startSession(session.sessionId());

		for (String creatureId : creatureIds) {
			gameSessionService.submitCatch(
				session.sessionId(),
				new SubmitCatchRequest(creatureId, null, null, null)
			);
		}

		return gameSessionService.endSession(session.sessionId());
	}
}
