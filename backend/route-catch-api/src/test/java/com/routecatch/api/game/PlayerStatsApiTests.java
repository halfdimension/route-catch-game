package com.routecatch.api.game;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.game.service.GameSessionService;

@SpringBootTest
@AutoConfigureMockMvc
class PlayerStatsApiTests {

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
	void statsForPlayerWithCompletedSessions() throws Exception {
		createEndedSessionForPlayer("Harsh", "sparkbit");
		createEndedSessionForPlayer("Harsh", "voltfox");
		createEndedSessionForPlayer("Guest", "chronodrake");

		mockMvc.perform(get("/api/game/players/{playerName}/stats", "Harsh"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.playerName").value("Harsh"))
			.andExpect(jsonPath("$.totalSessions").value(2))
			.andExpect(jsonPath("$.completedSessions").value(2))
			.andExpect(jsonPath("$.totalScore").value(40))
			.andExpect(jsonPath("$.totalCatches").value(2))
			.andExpect(jsonPath("$.bestScore").value(30))
			.andExpect(jsonPath("$.bestCaughtCount").value(1))
			.andExpect(jsonPath("$.averageScore").value(20.0))
			.andExpect(jsonPath("$.latestSessionAt").isNotEmpty());
	}

	@Test
	void statsExcludeCreatedAndRunningSessionsFromScoreTotals()
		throws Exception {
		createEndedSessionForPlayer("Harsh", "sparkbit");
		gameSessionService.createSession(60, "Harsh");
		GameSession running = gameSessionService.createSession(60, "Harsh");
		gameSessionService.startSession(running.sessionId());
		gameSessionService.submitCatch(
			running.sessionId(),
			catchRequest("voltfox")
		);

		mockMvc.perform(get("/api/game/players/{playerName}/stats", "Harsh"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.totalSessions").value(3))
			.andExpect(jsonPath("$.completedSessions").value(1))
			.andExpect(jsonPath("$.totalScore").value(10))
			.andExpect(jsonPath("$.totalCatches").value(1))
			.andExpect(jsonPath("$.bestScore").value(10))
			.andExpect(jsonPath("$.bestCaughtCount").value(1))
			.andExpect(jsonPath("$.averageScore").value(10.0));
	}

	@Test
	void missingPlayerReturnsZeroStats() throws Exception {
		mockMvc.perform(get("/api/game/players/{playerName}/stats", "Nobody"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.playerName").value("Nobody"))
			.andExpect(jsonPath("$.totalSessions").value(0))
			.andExpect(jsonPath("$.completedSessions").value(0))
			.andExpect(jsonPath("$.totalScore").value(0))
			.andExpect(jsonPath("$.totalCatches").value(0))
			.andExpect(jsonPath("$.bestScore").value(0))
			.andExpect(jsonPath("$.bestCaughtCount").value(0))
			.andExpect(jsonPath("$.averageScore").value(0.0))
			.andExpect(jsonPath("$.latestSessionAt").isEmpty());
	}

	@Test
	void blankPlayerNameResolvesToGuest() throws Exception {
		mockMvc.perform(get("/api/game/players/{playerName}/stats", "   "))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.playerName").value("Guest"))
			.andExpect(jsonPath("$.totalSessions").value(0));
	}

	@Test
	void tooLongPlayerNameReturnsValidationError() throws Exception {
		String playerName = "a".repeat(81);

		mockMvc.perform(get("/api/game/players/{playerName}/stats", playerName))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value(
				"playerName must be at most 80 characters"
			));
	}

	private GameSession createEndedSessionForPlayer(
		String playerName,
		String... creatureIds
	) {
		GameSession session = gameSessionService.createSession(60, playerName);
		gameSessionService.startSession(session.sessionId());

		for (String creatureId : creatureIds) {
			gameSessionService.submitCatch(
				session.sessionId(),
				catchRequest(creatureId)
			);
		}

		return gameSessionService.endSession(session.sessionId());
	}

	private SubmitCatchRequest catchRequest(String creatureId) {
		return new SubmitCatchRequest(creatureId, null, null, null);
	}
}
