package com.routecatch.api.game;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.game.model.GameSession;
import com.routecatch.api.game.service.GameSessionService;

@SpringBootTest
@AutoConfigureMockMvc
class GameSessionApiTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private GameSessionService gameSessionService;

	@Test
	void createSessionReturnsCreatedStatus() throws Exception {
		mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"durationSeconds": 60}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.sessionId").isNotEmpty())
			.andExpect(jsonPath("$.status").value("CREATED"))
			.andExpect(jsonPath("$.durationSeconds").value(60))
			.andExpect(jsonPath("$.score").value(0))
			.andExpect(jsonPath("$.caughtCount").value(0));
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
}
