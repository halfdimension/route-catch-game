package com.routecatch.api.multiplayer.room;

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

@SpringBootTest
@AutoConfigureMockMvc
class MultiplayerRoomApiTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private UserRepository userRepository;

	@BeforeEach
	void clearData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void createRoomRequiresAuthentication() throws Exception {
		mockMvc.perform(post("/api/multiplayer/rooms")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"roomName": "Delhi Room"
					}
					"""))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
	}

	@Test
	void createRoomSucceeds() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");

		mockMvc.perform(post("/api/multiplayer/rooms")
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"roomName": "Delhi Room"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.roomCode").isNotEmpty())
			.andExpect(jsonPath("$.roomName").value("Delhi Room"))
			.andExpect(jsonPath("$.hostDisplayName").value("Host"))
			.andExpect(jsonPath("$.status").value("OPEN"))
			.andExpect(jsonPath("$.members", hasSize(1)))
			.andExpect(jsonPath("$.members[0].username").value("host"))
			.andExpect(jsonPath("$.members[0].host").value(true));
	}

	@Test
	void blankRoomNameReturnsValidationError() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");

		mockMvc.perform(post("/api/multiplayer/rooms")
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"roomName": " "
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
	}

	@Test
	void joinRoomSucceeds() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/join", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.members", hasSize(2)))
			.andExpect(jsonPath("$.members[0].username").value("host"))
			.andExpect(jsonPath("$.members[1].username").value("other"));
	}

	@Test
	void joiningSameRoomTwiceIsIdempotent() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");

		joinRoom(other.token(), roomCode);

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/join", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.members", hasSize(2)));
	}

	@Test
	void leaveRoomSucceeds() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/leave", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.members", hasSize(1)))
			.andExpect(jsonPath("$.members[0].username").value("host"));
	}

	@Test
	void hostLeavingTransfersHostToEarliestMember() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/leave", roomCode)
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.members", hasSize(1)))
			.andExpect(jsonPath("$.hostDisplayName").value("Other"))
			.andExpect(jsonPath("$.members[0].username").value("other"))
			.andExpect(jsonPath("$.members[0].host").value(true));
	}

	@Test
	void hostCloseSucceeds() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/close", roomCode)
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("CLOSED"));
	}

	@Test
	void nonHostCloseReturnsForbidden() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/close", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void joiningClosedRoomReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		closeRoom(host.token(), roomCode);

		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/join", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("ROOM_CLOSED"));
	}

	@Test
	void unknownRoomReturnsNotFound() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");

		mockMvc.perform(get("/api/multiplayer/rooms/{roomCode}", "000000")
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("ROOM_NOT_FOUND"));
	}

	@Test
	void listMyRoomsReturnsOnlyRoomsWhereUserIsMember() throws Exception {
		AuthFixture harsh = registerUser("harsh", "harsh@example.com", "Harsh");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String harshRoomCode = createRoom(harsh.token(), "Harsh Room");
		Thread.sleep(2);
		String otherRoomCode = createRoom(other.token(), "Other Room");
		joinRoom(harsh.token(), otherRoomCode);

		mockMvc.perform(get("/api/multiplayer/rooms/me")
				.header("Authorization", "Bearer " + harsh.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$", hasSize(2)))
			.andExpect(jsonPath("$[0].roomCode").value(otherRoomCode))
			.andExpect(jsonPath("$[1].roomCode").value(harshRoomCode));
	}

	@Test
	void startRoomGameRequiresAuthentication() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60
					}
					"""))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
	}

	@Test
	void hostCanStartRoomGame() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.roomCode").value(roomCode))
			.andExpect(jsonPath("$.roomStatus").value("IN_PROGRESS"))
			.andExpect(jsonPath("$.gameStatus").value("RUNNING"))
			.andExpect(jsonPath("$.durationSeconds").value(60))
			.andExpect(jsonPath("$.startedAt").isNotEmpty())
			.andExpect(jsonPath("$.endsAt").isNotEmpty())
			.andExpect(jsonPath("$.remainingSeconds").isNumber())
			.andExpect(jsonPath("$.startedByDisplayName").value("Host"));
	}

	@Test
	void nonHostCannotStartRoomGame() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + other.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60
					}
					"""))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void memberCanGetRoomGameState() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(get("/api/multiplayer/rooms/{roomCode}/game", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.roomCode").value(roomCode))
			.andExpect(jsonPath("$.roomStatus").value("IN_PROGRESS"))
			.andExpect(jsonPath("$.gameStatus").value("RUNNING"));
	}

	@Test
	void nonMemberCannotGetRoomGameState() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(get("/api/multiplayer/rooms/{roomCode}/game", roomCode)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void getRoomGameBeforeStartReturnsWaiting() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(get("/api/multiplayer/rooms/{roomCode}/game", roomCode)
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.roomStatus").value("OPEN"))
			.andExpect(jsonPath("$.gameStatus").value("WAITING"))
			.andExpect(jsonPath("$.durationSeconds").value(0))
			.andExpect(jsonPath("$.remainingSeconds").value(0))
			.andExpect(jsonPath("$.startedAt").doesNotExist());
	}

	@Test
	void startingRoomGameChangesRoomStatusToInProgress() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(get("/api/multiplayer/rooms/{roomCode}", roomCode)
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("IN_PROGRESS"));
	}

	@Test
	void startingAlreadyRunningRoomGameReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60
					}
					"""))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("ROOM_GAME_ALREADY_RUNNING"));
	}

	@Test
	void hostCanEndRoomGame() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/end",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.roomStatus").value("CLOSED"))
			.andExpect(jsonPath("$.gameStatus").value("ENDED"))
			.andExpect(jsonPath("$.remainingSeconds").value(0))
			.andExpect(jsonPath("$.endedAt").isNotEmpty());
	}

	@Test
	void nonHostCannotEndRoomGame() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/end",
				roomCode
			)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void invalidRoomGameDurationBelowMinimumReturnsBadRequest()
		throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 29
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
	}

	@Test
	void invalidRoomGameDurationAboveMaximumReturnsBadRequest()
		throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 601
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
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

		return new AuthFixture(
			JsonPath.read(response, "$.token"),
			JsonPath.read(response, "$.user.userId")
		);
	}

	private String createRoom(String token, String roomName) throws Exception {
		String response = mockMvc.perform(post("/api/multiplayer/rooms")
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"roomName": "%s"
					}
					""".formatted(roomName)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		return JsonPath.read(response, "$.roomCode");
	}

	private void joinRoom(String token, String roomCode) throws Exception {
		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/join", roomCode)
				.header("Authorization", "Bearer " + token))
			.andExpect(status().isOk());
	}

	private void closeRoom(String token, String roomCode) throws Exception {
		mockMvc.perform(post("/api/multiplayer/rooms/{roomCode}/close", roomCode)
				.header("Authorization", "Bearer " + token))
			.andExpect(status().isOk());
	}

	private void startRoomGame(
		String token,
		String roomCode,
		int durationSeconds
	) throws Exception {
		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": %d
					}
					""".formatted(durationSeconds)))
			.andExpect(status().isOk());
	}

	private record AuthFixture(String token, String userId) {
	}
}
