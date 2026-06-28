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

	@Test
	void spawnRoomCreaturesRequiresAuthentication() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(10, 120, 500)))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
	}

	@Test
	void hostCanSpawnRoomCreaturesWhenGameIsRunning() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(10, 120, 500)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$", hasSize(10)))
			.andExpect(jsonPath("$[0].instanceId").isNotEmpty())
			.andExpect(jsonPath("$[0].creatureId").isNotEmpty())
			.andExpect(jsonPath("$[0].name").isNotEmpty())
			.andExpect(jsonPath("$[0].rarity").isNotEmpty())
			.andExpect(jsonPath("$[0].scoreValue").isNumber())
			.andExpect(jsonPath("$[0].latitude").isNumber())
			.andExpect(jsonPath("$[0].longitude").isNumber())
			.andExpect(jsonPath("$[0].spawnedAt").isNotEmpty())
			.andExpect(jsonPath("$[0].expiresAt").isNotEmpty())
			.andExpect(jsonPath("$[0].remainingSeconds").isNumber())
			.andExpect(jsonPath("$[0].caught").value(false))
			.andExpect(jsonPath("$[0].caughtByDisplayName").doesNotExist())
			.andExpect(jsonPath("$[0].caughtAt").doesNotExist());
	}

	@Test
	void nonHostCannotSpawnRoomCreatures() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + other.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(10, 120, 500)))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void spawnRoomCreaturesBeforeGameStartReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(10, 120, 500)))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("ROOM_GAME_NOT_RUNNING"));
	}

	@Test
	void spawnRoomCreaturesAfterGameEndedReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);
		endRoomGame(host.token(), roomCode);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(10, 120, 500)))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("ROOM_GAME_NOT_RUNNING"));
	}

	@Test
	void roomMemberCanListCreatures() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);
		spawnCreatures(host.token(), roomCode, 3);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/creatures",
				roomCode
			)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$", hasSize(3)))
			.andExpect(jsonPath("$[0].caught").value(false));
	}

	@Test
	void nonMemberCannotListCreatures() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/creatures",
				roomCode
			)
				.header("Authorization", "Bearer " + other.token()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void hostAndMemberSeeSameSharedRoomCreatures() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(other.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 2);

		String hostResponse = listCreatures(host.token(), roomCode);
		String memberResponse = listCreatures(other.token(), roomCode);

		String spawnedFirstId = JsonPath.read(spawnedResponse, "$[0].instanceId");
		String hostFirstId = JsonPath.read(hostResponse, "$[0].instanceId");
		String memberFirstId = JsonPath.read(memberResponse, "$[0].instanceId");

		org.junit.jupiter.api.Assertions.assertEquals(spawnedFirstId, hostFirstId);
		org.junit.jupiter.api.Assertions.assertEquals(hostFirstId, memberFirstId);
	}

	@Test
	void catchRoomCreatureRequiresAuthentication() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				creature.instanceId()
			)
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(creature.latitude(), creature.longitude())))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
	}

	@Test
	void roomMemberCanCatchActiveCreatureWhenCloseEnough() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture member = registerUser(
			"member",
			"member@example.com",
			"Member"
		);
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(member.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				creature.instanceId()
			)
				.header("Authorization", "Bearer " + member.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(creature.latitude(), creature.longitude())))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.instanceId").value(creature.instanceId()))
			.andExpect(jsonPath("$.creatureId").isNotEmpty())
			.andExpect(jsonPath("$.name").isNotEmpty())
			.andExpect(jsonPath("$.rarity").isNotEmpty())
			.andExpect(jsonPath("$.scoreValue").isNumber())
			.andExpect(jsonPath("$.caught").value(true))
			.andExpect(jsonPath("$.caughtByUserId").value(member.userId()))
			.andExpect(jsonPath("$.caughtByDisplayName").value("Member"))
			.andExpect(jsonPath("$.caughtAt").isNotEmpty())
			.andExpect(jsonPath("$.distanceMeters").isNumber());
	}

	@Test
	void catchRoomCreatureInUnknownRoomReturnsNotFound() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				"000000",
				"00000000-0000-0000-0000-000000000001"
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(28.6139, 77.2090)))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("ROOM_NOT_FOUND"));
	}

	@Test
	void nonMemberCannotCatchRoomCreature() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture other = registerUser("other", "other@example.com", "Other");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				creature.instanceId()
			)
				.header("Authorization", "Bearer " + other.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(creature.latitude(), creature.longitude())))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode").value("ROOM_FORBIDDEN"));
	}

	@Test
	void catchRoomCreatureBeforeGameStartReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				"00000000-0000-0000-0000-000000000001"
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(28.6139, 77.2090)))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("ROOM_GAME_NOT_RUNNING"));
	}

	@Test
	void catchUnknownRoomCreatureReturnsNotFound() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				"00000000-0000-0000-0000-000000000001"
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(28.6139, 77.2090)))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("ROOM_CREATURE_NOT_FOUND"));
	}

	@Test
	void catchAlreadyCaughtRoomCreatureReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		AuthFixture member = registerUser(
			"member",
			"member@example.com",
			"Member"
		);
		String roomCode = createRoom(host.token(), "Delhi Room");
		joinRoom(member.token(), roomCode);
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);
		catchCreature(
			member.token(),
			roomCode,
			creature.instanceId(),
			creature.latitude(),
			creature.longitude()
		);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				creature.instanceId()
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(creature.latitude(), creature.longitude())))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode")
				.value("ROOM_CREATURE_ALREADY_CAUGHT"));
	}

	@Test
	void catchRoomCreatureTooFarReturnsConflict() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				creature.instanceId()
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(0.0, 0.0)))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("ROOM_CREATURE_TOO_FAR"));
	}

	@Test
	void successfulCatchRemovesCreatureFromActiveList() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);

		catchCreature(
			host.token(),
			roomCode,
			creature.instanceId(),
			creature.latitude(),
			creature.longitude()
		);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/creatures",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$", hasSize(0)));
	}

	@Test
	void duplicateCatchReturnsConflictForSecondAttempt() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);
		String spawnedResponse = spawnCreatures(host.token(), roomCode, 1);
		CreatureFixture creature = firstCreature(spawnedResponse);

		catchCreature(
			host.token(),
			roomCode,
			creature.instanceId(),
			creature.latitude(),
			creature.longitude()
		);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				creature.instanceId()
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(creature.latitude(), creature.longitude())))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode")
				.value("ROOM_CREATURE_ALREADY_CAUGHT"));
	}

	@Test
	void invalidCatchRoomCreatureRequestReturnsBadRequest() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				"00000000-0000-0000-0000-000000000001"
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"playerLat": 91.0,
						"playerLon": 77.2090
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
	}

	@Test
	void invalidRoomCreatureCountBelowMinimumReturnsBadRequest()
		throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(0, 120, 500)))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
	}

	@Test
	void invalidRoomCreatureCountAboveMaximumReturnsBadRequest()
		throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(21, 120, 500)))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
	}

	@Test
	void invalidRoomCreatureRadiusReturnsBadRequest() throws Exception {
		AuthFixture host = registerUser("host", "host@example.com", "Host");
		String roomCode = createRoom(host.token(), "Delhi Room");
		startRoomGame(host.token(), roomCode, 60);

		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + host.token())
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(10, 120, 19)))
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

	private void endRoomGame(String token, String roomCode) throws Exception {
		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/end",
				roomCode
			)
				.header("Authorization", "Bearer " + token))
			.andExpect(status().isOk());
	}

	private String spawnCreatures(
		String token,
		String roomCode,
		int count
	) throws Exception {
		return mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/spawn",
				roomCode
			)
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content(spawnRequest(count, 120, 500)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
	}

	private String listCreatures(String token, String roomCode) throws Exception {
		return mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/creatures",
				roomCode
			)
				.header("Authorization", "Bearer " + token))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
	}

	private String catchCreature(
		String token,
		String roomCode,
		String instanceId,
		double playerLat,
		double playerLon
	) throws Exception {
		return mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch",
				roomCode,
				instanceId
			)
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content(catchRequest(playerLat, playerLon)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
	}

	private CreatureFixture firstCreature(String response) {
		return new CreatureFixture(
			JsonPath.read(response, "$[0].instanceId"),
			number(response, "$[0].latitude"),
			number(response, "$[0].longitude")
		);
	}

	private double number(String response, String path) {
		Number number = JsonPath.read(response, path);
		return number.doubleValue();
	}

	private String spawnRequest(
		int count,
		int ttlSeconds,
		double radiusMeters
	) {
		return """
			{
				"centerLat": 28.6139,
				"centerLon": 77.2090,
				"count": %d,
				"ttlSeconds": %d,
				"radiusMeters": %.1f
			}
			""".formatted(count, ttlSeconds, radiusMeters);
	}

	private String catchRequest(double playerLat, double playerLon) {
		return """
			{
				"playerLat": %.12f,
				"playerLon": %.12f
			}
			""".formatted(playerLat, playerLon);
	}

	private record AuthFixture(String token, String userId) {
	}

	private record CreatureFixture(
		String instanceId,
		double latitude,
		double longitude
	) {
	}
}
