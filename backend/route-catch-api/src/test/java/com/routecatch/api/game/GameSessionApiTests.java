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

@SpringBootTest
@AutoConfigureMockMvc
class GameSessionApiTests {

	@Autowired
	private MockMvc mockMvc;

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
	void invalidCatchScoreReturnsValidationError() throws Exception {
		UUID sessionId = UUID.randomUUID();

		mockMvc.perform(post(
				"/api/game/sessions/{sessionId}/catches",
				sessionId
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"creatureId": "sparkbit",
						"creatureName": "Sparkbit",
						"rarity": "common",
						"scoreValue": 0
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value("scoreValue must be at least 1"))
			.andExpect(jsonPath("$.path").value(
				"/api/game/sessions/" + sessionId + "/catches"
			));
	}
}
