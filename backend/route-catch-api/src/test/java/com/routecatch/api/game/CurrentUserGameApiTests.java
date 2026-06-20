package com.routecatch.api.game;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.game.service.GameSessionService;

@SpringBootTest
@AutoConfigureMockMvc
class CurrentUserGameApiTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private GameSessionService gameSessionService;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private UserRepository userRepository;

	@BeforeEach
	void clearData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void currentUserStatsOnlyUseAuthenticatedUserSessions() throws Exception {
		String harshToken = registerUserAndReturnToken(
			"harsh",
			"harsh@example.com",
			"Harsh"
		);
		String otherToken = registerUserAndReturnToken(
			"other",
			"other@example.com",
			"Other"
		);

		UUID completedSessionId = createAuthenticatedSession(harshToken, "Fake");
		completeSessionWithCatch(completedSessionId, "voltfox");
		createAuthenticatedSession(harshToken, "Still Harsh");

		UUID otherSessionId = createAuthenticatedSession(otherToken, "Other");
		completeSessionWithCatch(otherSessionId, "thunderwyrm");

		UUID guestSessionId = createGuestSession("Harsh");
		completeSessionWithCatch(guestSessionId, "chronodrake");

		mockMvc.perform(get("/api/game/me/stats")
				.header("Authorization", "Bearer " + harshToken))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.playerName").value("Harsh"))
			.andExpect(jsonPath("$.totalSessions").value(2))
			.andExpect(jsonPath("$.completedSessions").value(1))
			.andExpect(jsonPath("$.totalScore").value(30))
			.andExpect(jsonPath("$.totalCatches").value(1))
			.andExpect(jsonPath("$.bestScore").value(30))
			.andExpect(jsonPath("$.bestCaughtCount").value(1))
			.andExpect(jsonPath("$.latestSessionAt").isNotEmpty());
	}

	@Test
	void currentUserStatsWithoutTokenReturnsUnauthorizedJson() throws Exception {
		mockMvc.perform(get("/api/game/me/stats"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"))
			.andExpect(jsonPath("$.path").value("/api/game/me/stats"));
	}

	@Test
	void currentUserSessionsOnlyReturnAuthenticatedUserSessions()
		throws Exception {
		String harshToken = registerUserAndReturnToken(
			"harsh",
			"harsh@example.com",
			"Harsh"
		);
		String otherToken = registerUserAndReturnToken(
			"other",
			"other@example.com",
			"Other"
		);

		UUID olderSessionId = createAuthenticatedSession(harshToken, "Fake");
		Thread.sleep(2);
		UUID newerSessionId = createAuthenticatedSession(harshToken, "Fake");
		createAuthenticatedSession(otherToken, "Other");
		createGuestSession("Harsh");

		mockMvc.perform(get("/api/game/me/sessions")
				.header("Authorization", "Bearer " + harshToken))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(2))
			.andExpect(jsonPath("$[0].sessionId").value(newerSessionId.toString()))
			.andExpect(jsonPath("$[0].playerName").value("Harsh"))
			.andExpect(jsonPath("$[0].userId").isNotEmpty())
			.andExpect(jsonPath("$[1].sessionId").value(olderSessionId.toString()))
			.andExpect(jsonPath("$[1].playerName").value("Harsh"));
	}

	@Test
	void currentUserSessionsLimitValidationReturnsBadRequest()
		throws Exception {
		String token = registerUserAndReturnToken(
			"harsh",
			"harsh@example.com",
			"Harsh"
		);

		mockMvc.perform(get("/api/game/me/sessions")
				.header("Authorization", "Bearer " + token)
				.param("limit", "0"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value(
				"limit must be between 1 and 100"
			));
	}

	@Test
	void currentUserSessionCatchesOnlyWorkForOwnedSession() throws Exception {
		String harshToken = registerUserAndReturnToken(
			"harsh",
			"harsh@example.com",
			"Harsh"
		);
		String otherToken = registerUserAndReturnToken(
			"other",
			"other@example.com",
			"Other"
		);
		UUID harshSessionId = createAuthenticatedSession(harshToken, "Fake");
		UUID otherSessionId = createAuthenticatedSession(otherToken, "Other");
		completeSessionWithCatch(harshSessionId, "sparkbit");

		mockMvc.perform(get(
				"/api/game/me/sessions/{sessionId}/catches",
				harshSessionId
			)
				.header("Authorization", "Bearer " + harshToken))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(1))
			.andExpect(jsonPath("$[0].creatureId").value("sparkbit"));

		mockMvc.perform(get(
				"/api/game/me/sessions/{sessionId}/catches",
				otherSessionId
			)
				.header("Authorization", "Bearer " + harshToken))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("GAME_SESSION_NOT_FOUND"));
	}

	@Test
	void publicStatsAndLeaderboardRemainPublic() throws Exception {
		mockMvc.perform(get("/api/game/players/Harsh/stats"))
			.andExpect(status().isOk());

		mockMvc.perform(get("/api/game/leaderboard"))
			.andExpect(status().isOk());
	}

	private String registerUserAndReturnToken(
		String username,
		String email,
		String displayName
	) throws Exception {
		String response = mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "%s",
						"email": "%s",
						"displayName": "%s",
						"password": "password123"
					}
					""".formatted(username, email, displayName)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		return com.jayway.jsonpath.JsonPath.read(response, "$.token");
	}

	private UUID createAuthenticatedSession(String token, String playerName)
		throws Exception {
		String response = mockMvc.perform(post("/api/game/sessions")
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "%s"
					}
					""".formatted(playerName)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		String sessionId = com.jayway.jsonpath.JsonPath.read(response, "$.sessionId");
		return UUID.fromString(sessionId);
	}

	private UUID createGuestSession(String playerName) throws Exception {
		String response = mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "%s"
					}
					""".formatted(playerName)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		String sessionId = com.jayway.jsonpath.JsonPath.read(response, "$.sessionId");
		return UUID.fromString(sessionId);
	}

	private void completeSessionWithCatch(UUID sessionId, String creatureId) {
		gameSessionService.startSession(sessionId);
		gameSessionService.submitCatch(
			sessionId,
			new SubmitCatchRequest(creatureId, null, null, null)
		);
		gameSessionService.endSession(sessionId);
	}
}
