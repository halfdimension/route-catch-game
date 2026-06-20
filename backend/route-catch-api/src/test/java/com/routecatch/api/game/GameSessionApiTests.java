package com.routecatch.api.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.model.GameSessionStatus;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.game.service.GameSessionService;

@SpringBootTest
@AutoConfigureMockMvc
class GameSessionApiTests {

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
	void clearSessionHistory() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void createSessionReturnsCreatedStatus() throws Exception {
		String response = mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"durationSeconds": 60}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.sessionId").isNotEmpty())
			.andExpect(jsonPath("$.status").value("CREATED"))
			.andExpect(jsonPath("$.durationSeconds").value(60))
			.andExpect(jsonPath("$.score").value(0))
			.andExpect(jsonPath("$.caughtCount").value(0))
			.andExpect(jsonPath("$.playerName").value("Guest"))
			.andExpect(jsonPath("$.userId").doesNotExist())
			.andReturn()
			.getResponse()
			.getContentAsString();

		String sessionId = com.jayway.jsonpath.JsonPath.read(response, "$.sessionId");
		GameSessionEntity persistedSession = gameSessionRepository
			.findById(UUID.fromString(sessionId))
			.orElseThrow();

		assertNull(persistedSession.getUserId());
	}

	@Test
	void createSessionTrimsAndReturnsPlayerName() throws Exception {
		mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "  Harsh  "
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.playerName").value("Harsh"));
	}

	@Test
	void createSessionWithValidTokenLinksAuthenticatedUser() throws Exception {
		String token = registerUserAndReturnToken(
			"route_user",
			"route@example.com",
			"Route Runner"
		);
		UserEntity user = userRepository.findByUsername("route_user").orElseThrow();

		String response = mockMvc.perform(post("/api/game/sessions")
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "Fake Name"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("CREATED"))
			.andExpect(jsonPath("$.playerName").value("Route Runner"))
			.andExpect(jsonPath("$.userId").value(user.getUserId().toString()))
			.andReturn()
			.getResponse()
			.getContentAsString();

		String sessionId = com.jayway.jsonpath.JsonPath.read(response, "$.sessionId");
		GameSessionEntity persistedSession = gameSessionRepository
			.findById(UUID.fromString(sessionId))
			.orElseThrow();

		assertEquals(user.getUserId(), persistedSession.getUserId());
		assertEquals("Route Runner", persistedSession.getPlayerName());
	}

	@Test
	void blankPlayerNameFallsBackToGuest() throws Exception {
		mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "   "
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.playerName").value("Guest"));
	}

	@Test
	void tooLongPlayerNameReturnsValidationError() throws Exception {
		String playerName = "a".repeat(81);

		mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "%s"
					}
					""".formatted(playerName)))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value(
				"playerName must be at most 80 characters"
			));
	}

	@Test
	void invalidDurationReturnsValidationError() throws Exception {
		mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"durationSeconds": 20}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value("durationSeconds must be at least 30"))
			.andExpect(jsonPath("$.path").value("/api/game/sessions"));
	}

	@Test
	void unknownSessionReturnsNotFound() throws Exception {
		UUID sessionId = UUID.randomUUID();

		mockMvc.perform(get("/api/game/sessions/{sessionId}", sessionId))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("GAME_SESSION_NOT_FOUND"))
			.andExpect(jsonPath("$.path").value("/api/game/sessions/" + sessionId));
	}

	@Test
	void malformedSessionIdReturnsBadRequest() throws Exception {
		mockMvc.perform(get("/api/game/sessions/not-a-uuid"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("INVALID_PATH_PARAMETER"))
			.andExpect(jsonPath("$.message").value("Invalid value for sessionId"))
			.andExpect(jsonPath("$.path").value(
				"/api/game/sessions/not-a-uuid"
			));
	}

	@Test
	void missingCreatureIdReturnsValidationError() throws Exception {
		UUID sessionId = UUID.randomUUID();

		mockMvc.perform(post(
				"/api/game/sessions/{sessionId}/catches",
				sessionId
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"creatureName": "Sparkbit",
						"rarity": "common",
						"scoreValue": 0
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value("creatureId must not be blank"))
			.andExpect(jsonPath("$.path").value(
				"/api/game/sessions/" + sessionId + "/catches"
			));
	}

	@Test
	void creatureCatalogEndpointReturnsBackendCatalog() throws Exception {
		mockMvc.perform(get("/api/game/creatures"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(9))
			.andExpect(jsonPath("$[0].creatureId").value("sparkbit"))
			.andExpect(jsonPath("$[0].scoreValue").value(10))
			.andExpect(jsonPath("$[8].creatureId").value("chronodrake"))
			.andExpect(jsonPath("$[8].scoreValue").value(100));
	}

	@Test
	void unknownCreatureReturnsNotFound() throws Exception {
		GameSession session = gameSessionService.createSession(60);
		gameSessionService.startSession(session.sessionId());

		mockMvc.perform(post(
				"/api/game/sessions/{sessionId}/catches",
				session.sessionId()
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"creatureId": "unknown-creature"}
					"""))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("CREATURE_NOT_FOUND"))
			.andExpect(jsonPath("$.message").value(
				"Creature not found: unknown-creature"
			));
	}

	@Test
	void endedSessionCatchReturnsConflict() throws Exception {
		GameSession session = gameSessionService.createSession(60);
		gameSessionService.startSession(session.sessionId());
		gameSessionService.endSession(session.sessionId());

		mockMvc.perform(post(
				"/api/game/sessions/{sessionId}/catches",
				session.sessionId()
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"creatureId": "sparkbit"}
					"""))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value(
				"INVALID_GAME_SESSION_STATE"
			))
			.andExpect(jsonPath("$.path").value(
				"/api/game/sessions/" + session.sessionId() + "/catches"
			));
	}

	@Test
	void listSessionsReturnsMostRecentFirst() throws Exception {
		GameSession older = gameSessionService.createSession(60);
		Thread.sleep(2);
		GameSession newer = gameSessionService.createSession(120, "Harsh");

		mockMvc.perform(get("/api/game/sessions"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(2))
			.andExpect(jsonPath("$[0].sessionId").value(
				newer.sessionId().toString()
			))
			.andExpect(jsonPath("$[0].durationSeconds").value(120))
			.andExpect(jsonPath("$[0].playerName").value("Harsh"))
			.andExpect(jsonPath("$[1].sessionId").value(
				older.sessionId().toString()
			))
			.andExpect(jsonPath("$[1].playerName").value("Guest"));
	}

	@Test
	void listSessionsHonorsLimit() throws Exception {
		gameSessionService.createSession(60);
		gameSessionService.createSession(120);

		mockMvc.perform(get("/api/game/sessions").param("limit", "1"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(1));
	}

	@Test
	void listSessionsRejectsInvalidLimit() throws Exception {
		mockMvc.perform(get("/api/game/sessions").param("limit", "0"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value(
				"limit must be between 1 and 100"
			))
			.andExpect(jsonPath("$.path").value("/api/game/sessions"));
	}

	@Test
	void listSessionCatchesReturnsOldestFirst() throws Exception {
		GameSession session = gameSessionService.createSession(60);
		gameSessionService.startSession(session.sessionId());
		gameSessionService.submitCatch(
			session.sessionId(),
			new SubmitCatchRequest(
				"sparkbit",
				null,
				null,
				null
			)
		);
		Thread.sleep(2);
		gameSessionService.submitCatch(
			session.sessionId(),
			new SubmitCatchRequest(
				"voltfox",
				null,
				null,
				null
			)
		);

		mockMvc.perform(get(
				"/api/game/sessions/{sessionId}/catches",
				session.sessionId()
			))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.length()").value(2))
			.andExpect(jsonPath("$[0].sessionId").value(
				session.sessionId().toString()
			))
			.andExpect(jsonPath("$[0].creatureId").value("sparkbit"))
			.andExpect(jsonPath("$[0].scoreValue").value(10))
			.andExpect(jsonPath("$[0].catchId").isNotEmpty())
			.andExpect(jsonPath("$[0].caughtAt").isNotEmpty())
			.andExpect(jsonPath("$[1].creatureId").value("voltfox"))
			.andExpect(jsonPath("$[1].scoreValue").value(30));
	}

	@Test
	void listCatchesForUnknownSessionReturnsNotFound() throws Exception {
		UUID sessionId = UUID.randomUUID();

		mockMvc.perform(get(
				"/api/game/sessions/{sessionId}/catches",
				sessionId
			))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value(
				"GAME_SESSION_NOT_FOUND"
			))
			.andExpect(jsonPath("$.path").value(
				"/api/game/sessions/" + sessionId + "/catches"
			));
	}

	@Test
	void catchOnStaleRunningSessionReturnsConflictAndAutoEnds() throws Exception {
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

		mockMvc.perform(post(
				"/api/game/sessions/{sessionId}/catches",
				session.sessionId()
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"creatureId": "sparkbit"}
					"""))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value(
				"INVALID_GAME_SESSION_STATE"
			));

		GameSessionEntity expiredSession = gameSessionRepository
			.findById(session.sessionId())
			.orElseThrow();

		assertEquals(GameSessionStatus.ENDED, expiredSession.getStatus());
		assertEquals(
			persistedStartedAt.plusSeconds(60),
			expiredSession.getEndedAt()
		);
		assertEquals(0, expiredSession.getScore());
		assertEquals(0, expiredSession.getCaughtCount());
		assertTrue(
			caughtCreatureRepository
				.findBySessionIdOrderByCaughtAtAsc(session.sessionId())
			.isEmpty()
		);
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
}
