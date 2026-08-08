package com.routecatch.api.multiplayer.room.movement.controller;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerCatchRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundRepository;

@SpringBootTest
@AutoConfigureMockMvc
class RoomMovementSnapshotAccessTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameRoundPlayerCatchRepository roundCatchRepository;

	@Autowired
	private GameRoundPlayerRepository roundPlayerRepository;

	@Autowired
	private GameRoundRepository roundRepository;

	@BeforeEach
	void clearData() {
		roundCatchRepository.deleteAll();
		roundPlayerRepository.deleteAll();
		roundRepository.deleteAll();
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void movementSnapshotRequiresAuthenticationAndRoomMembership()
		throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture member = registerUser(
			"member",
			"member@example.com",
			"Member"
		);
		AuthFixture outsider = registerUser(
			"outsider",
			"outsider@example.com",
			"Outsider"
		);
		String roomCode = createRoom(host.token());
		joinRoom(member.token(), roomCode);

		mockMvc.perform(get(
			"/api/multiplayer/rooms/{roomCode}/movements",
			roomCode
		))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));

		mockMvc.perform(get(
			"/api/multiplayer/rooms/{roomCode}/movements",
			roomCode
		)
				.header("Authorization", "Bearer " + member.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.roomCode").value(roomCode))
			.andExpect(jsonPath("$.roomSequence").value(0))
			.andExpect(jsonPath("$.serverTimestamp").isNotEmpty())
			.andExpect(jsonPath("$.movements", hasSize(0)));

		mockMvc.perform(get(
			"/api/multiplayer/rooms/{roomCode}/movements",
			roomCode
		)
				.header("Authorization", "Bearer " + outsider.token()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	private AuthFixture registerUser(
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

		return new AuthFixture(JsonPath.read(response, "$.token"));
	}

	private String createRoom(String token) throws Exception {
		String response = mockMvc.perform(post("/api/multiplayer/rooms")
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"roomName": "Delhi Room"
					}
					"""))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		return JsonPath.read(response, "$.roomCode");
	}

	private void joinRoom(String token, String roomCode) throws Exception {
		mockMvc.perform(post(
			"/api/multiplayer/rooms/{roomCode}/join",
			roomCode
		)
				.header("Authorization", "Bearer " + token))
			.andExpect(status().isOk());
	}

	private record AuthFixture(String token) {
	}
}
