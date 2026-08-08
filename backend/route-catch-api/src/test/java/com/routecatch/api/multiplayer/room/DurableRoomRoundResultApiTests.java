package com.routecatch.api.multiplayer.room;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.round.CaughtCreatureResult;
import com.routecatch.api.multiplayer.room.round.FinalizedRoomRound;
import com.routecatch.api.multiplayer.room.round.PersonalRoundResult;
import com.routecatch.api.multiplayer.room.round.PublicRoundResult;
import com.routecatch.api.multiplayer.room.round.RoundEndReason;
import com.routecatch.api.multiplayer.room.round.RoundLeaderboardEntry;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceCommand;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceService;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerCatchRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundRepository;

@SpringBootTest
@AutoConfigureMockMvc
class DurableRoomRoundResultApiTests {

	private static final Instant BASE_TIME = Instant.parse(
		"2026-08-02T12:00:00Z"
	);

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private CompletedRoundPersistenceService persistenceService;

	@Autowired
	private GameRoundRepository roundRepository;

	@Autowired
	private GameRoundPlayerRepository playerRepository;

	@Autowired
	private GameRoundPlayerCatchRepository roundCatchRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@BeforeEach
	void clearDataBeforeTest() {
		clearData();
	}

	@AfterEach
	void clearDataAfterTest() {
		clearData();
	}

	@Test
	void participantReadsExactAndLatestPersistedResultWithoutInMemoryRoom()
		throws Exception {
		AuthFixture participant = registerUser(
			"durable_participant",
			"durable-participant@example.com",
			"Current Participant"
		);
		AuthFixture other = registerUser(
			"durable_other",
			"durable-other@example.com",
			"Current Other"
		);
		UUID participantCatchId = UUID.randomUUID();
		UUID otherCatchId = UUID.randomUUID();
		UUID roundId = UUID.randomUUID();
		String roomCode = "DBRESULT00000001";
		persist(
			roundId,
			roomCode,
			BASE_TIME,
			List.of(
				player(
					participant,
					"Historical Participant",
					30,
					1,
					List.of(caught(
						participantCatchId,
						"voltfox",
						"Historical Voltfox",
						"rare",
						30,
						BASE_TIME.minusSeconds(20)
					))
				),
				player(
					other,
					"Historical Other",
					10,
					2,
					List.of(caught(
						otherCatchId,
						"sparkbit",
						"Other Secret Catch",
						"common",
						10,
						BASE_TIME.minusSeconds(10)
					))
				)
			)
		);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result",
				roomCode.toLowerCase(),
				roundId
			)
				.header("Authorization", "Bearer " + participant.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.publicResult.roundId").value(roundId.toString()))
			.andExpect(jsonPath("$.publicResult.roomCode").value(roomCode))
			.andExpect(jsonPath("$.publicResult.leaderboard", hasSize(2)))
			.andExpect(jsonPath("$.publicResult.leaderboard[0].displayName")
				.value("Historical Participant"))
			.andExpect(jsonPath("$.personalResult.displayName")
				.value("Historical Participant"))
			.andExpect(jsonPath("$.personalResult.rarityCounts.rare").value(1))
			.andExpect(jsonPath("$.personalResult.caughtCreatures", hasSize(1)))
			.andExpect(jsonPath("$.personalResult.caughtCreatures[0].instanceId")
				.value(participantCatchId.toString()))
			.andExpect(jsonPath("$.personalResult.caughtCreatures[0].name")
				.value("Historical Voltfox"));

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/latest/result",
				roomCode
			)
				.header("Authorization", "Bearer " + participant.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.publicResult.roundId").value(roundId.toString()))
			.andExpect(jsonPath("$.personalResult.caughtCreatures", hasSize(1)))
			.andExpect(jsonPath(
				"$.personalResult.caughtCreatures[?(@.instanceId == '%s')]"
					.formatted(otherCatchId)
			).isEmpty());
	}

	@Test
	void durableExactResultPreservesAuthenticationAuthorizationAndRoomBoundary()
		throws Exception {
		AuthFixture participant = registerUser(
			"boundary_participant",
			"boundary-participant@example.com",
			"Participant"
		);
		AuthFixture outsider = registerUser(
			"boundary_outsider",
			"boundary-outsider@example.com",
			"Outsider"
		);
		UUID roundId = UUID.randomUUID();
		String roomCode = "DBRESULT00000002";
		persist(
			roundId,
			roomCode,
			BASE_TIME,
			List.of(player(participant, "Participant", 0, 1, List.of()))
		);

		mockMvc.perform(get(
			"/api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result",
			roomCode,
			roundId
		))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result",
				roomCode,
				roundId
			)
				.header("Authorization", "Bearer " + outsider.token()))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode")
				.value("ROUND_RESULT_FORBIDDEN"));

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result",
				"DBRESULT00009999",
				roundId
			)
				.header("Authorization", "Bearer " + participant.token()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.errorCode").value("ROUND_NOT_FOUND"));
	}

	@Test
	void latestResultUsesEndedAtThenRoundIdDescending() throws Exception {
		AuthFixture participant = registerUser(
			"latest_participant",
			"latest-participant@example.com",
			"Latest Participant"
		);
		String roomCode = "DBRESULT00000003";
		UUID olderId = UUID.fromString("00000000-0000-0000-0000-000000000003");
		UUID lowerTieId = UUID.fromString("00000000-0000-0000-0000-000000000004");
		UUID higherTieId = UUID.fromString("00000000-0000-0000-0000-000000000005");
		persist(
			olderId,
			roomCode,
			BASE_TIME.minusSeconds(30),
			List.of(player(participant, "Older", 0, 1, List.of()))
		);
		persist(
			lowerTieId,
			roomCode,
			BASE_TIME,
			List.of(player(participant, "Lower Tie", 0, 1, List.of()))
		);
		persist(
			higherTieId,
			roomCode,
			BASE_TIME,
			List.of(player(participant, "Higher Tie", 0, 1, List.of()))
		);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/latest/result",
				roomCode
			)
				.header("Authorization", "Bearer " + participant.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.publicResult.roundId")
				.value(higherTieId.toString()))
			.andExpect(jsonPath("$.personalResult.displayName")
				.value("Higher Tie"));
	}

	@Test
	void latestRoundIsNotFilteredToRequester() throws Exception {
		AuthFixture earlierParticipant = registerUser(
			"earlier_participant",
			"earlier-participant@example.com",
			"Earlier Participant"
		);
		AuthFixture latestParticipant = registerUser(
			"latest_only_participant",
			"latest-only-participant@example.com",
			"Latest Only"
		);
		String roomCode = "DBRESULT00000004";
		persist(
			UUID.randomUUID(),
			roomCode,
			BASE_TIME.minusSeconds(60),
			List.of(player(
				earlierParticipant,
				"Earlier Participant",
				0,
				1,
				List.of()
			))
		);
		persist(
			UUID.randomUUID(),
			roomCode,
			BASE_TIME,
			List.of(player(
				latestParticipant,
				"Latest Only",
				0,
				1,
				List.of()
			))
		);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/latest/result",
				roomCode
			)
				.header(
					"Authorization",
					"Bearer " + earlierParticipant.token()
				))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.errorCode")
				.value("ROUND_RESULT_FORBIDDEN"));
	}

	@Test
	void persistedPreviousResultRemainsLatestWhileNewRoundIsRunning()
		throws Exception {
		AuthFixture participant = registerUser(
			"running_participant",
			"running-participant@example.com",
			"Running Participant"
		);
		String roomCode = createRoom(participant.token(), "Running Room");
		UUID previousRoundId = UUID.randomUUID();
		persist(
			previousRoundId,
			roomCode,
			Instant.now().minusSeconds(120),
			List.of(player(
				participant,
				"Historical Running Participant",
				0,
				1,
				List.of()
			))
		);
		startRoomGame(participant.token(), roomCode);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/latest/result",
				roomCode
			)
				.header("Authorization", "Bearer " + participant.token()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.publicResult.roundId")
				.value(previousRoundId.toString()));
		endRoomGame(participant.token(), roomCode);
	}

	@Test
	void malformedDurableResultFailsClosedWithSanitizedError() throws Exception {
		AuthFixture participant = registerUser(
			"malformed_participant",
			"malformed-participant@example.com",
			"Malformed Participant"
		);
		UUID roundId = UUID.randomUUID();
		String roomCode = "DBRESULT00000005";
		persist(
			roundId,
			roomCode,
			BASE_TIME,
			List.of(player(
				participant,
				"Malformed Participant",
				0,
				1,
				List.of()
			))
		);
		jdbcTemplate.update(
			"update game_rounds set participant_count = 2 where round_instance_id = ?",
			roundId
		);

		mockMvc.perform(get(
				"/api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result",
				roomCode,
				roundId
			)
				.header("Authorization", "Bearer " + participant.token()))
			.andExpect(status().isInternalServerError())
			.andExpect(jsonPath("$.errorCode")
				.value("ROUND_RESULT_UNAVAILABLE"))
			.andExpect(jsonPath("$.message")
				.value("Completed round result is unavailable"));
	}

	@Test
	void hydrationFailureIsSanitizedWithoutExposingPersistenceDetails()
		throws Exception {
		AuthFixture participant = registerUser(
			"hydration_participant",
			"hydration-participant@example.com",
			"Hydration Participant"
		);
		UUID roundId = UUID.randomUUID();
		String roomCode = "DBRESULT00000006";
		String invalidEnum = "INVALID_ENUM_SQL_SECRET";
		persist(
			roundId,
			roomCode,
			BASE_TIME,
			List.of(player(
				participant,
				"Hydration Participant",
				0,
				1,
				List.of()
			))
		);
		jdbcTemplate.update(
			"update game_rounds set end_reason = ? where round_instance_id = ?",
			invalidEnum,
			roundId
		);

		try {
			mockMvc.perform(get(
					"/api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result",
					roomCode,
					roundId
				)
					.header("Authorization", "Bearer " + participant.token()))
				.andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.errorCode")
					.value("ROUND_RESULT_UNAVAILABLE"))
				.andExpect(jsonPath("$.message")
					.value("Completed round result is unavailable"))
				.andExpect(content().string(not(containsString(invalidEnum))))
				.andExpect(content().string(not(containsString("game_rounds"))))
				.andExpect(content().string(not(containsString("select"))));
		} finally {
			jdbcTemplate.update(
				"update game_rounds set end_reason = 'HOST_ENDED' where round_instance_id = ?",
				roundId
			);
		}
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
		UUID userId = UUID.fromString(JsonPath.read(response, "$.user.userId"));
		return new AuthFixture(
			JsonPath.read(response, "$.token"),
			userRepository.findById(userId).orElseThrow()
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

	private void startRoomGame(String token, String roomCode) throws Exception {
		mockMvc.perform(post(
				"/api/multiplayer/rooms/{roomCode}/game/start",
				roomCode
			)
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60
					}
					"""))
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

	private void persist(
		UUID roundId,
		String roomCode,
		Instant endedAt,
		List<PlayerFixture> players
	) {
		Instant startedAt = endedAt.minusSeconds(60);
		List<RoundLeaderboardEntry> leaderboard = players.stream()
			.map(player -> new RoundLeaderboardEntry(
				player.auth().user().getUserId(),
				player.displayName(),
				player.score(),
				player.rank(),
				player.catches().size()
			))
			.toList();
		PublicRoundResult publicResult = new PublicRoundResult(
			roundId,
			roomCode,
			startedAt,
			endedAt,
			RoundEndReason.HOST_ENDED,
			players.size(),
			leaderboard
		);
		Map<UUID, PersonalRoundResult> personalResults = new LinkedHashMap<>();
		players.forEach(player -> personalResults.put(
			player.auth().user().getUserId(),
			new PersonalRoundResult(
				roundId,
				roomCode,
				player.auth().user().getUserId(),
				player.displayName(),
				player.score(),
				player.rank(),
				players.size(),
				player.catches().size(),
				rarityCounts(player.catches()),
				player.catches(),
				startedAt,
				endedAt,
				RoundEndReason.HOST_ENDED
			)
		));
		persistenceService.persistIfAbsent(new CompletedRoundPersistenceCommand(
			new FinalizedRoomRound(1L, publicResult, personalResults),
			60
		));
	}

	private PlayerFixture player(
		AuthFixture auth,
		String displayName,
		int score,
		int rank,
		List<CaughtCreatureResult> catches
	) {
		return new PlayerFixture(auth, displayName, score, rank, catches);
	}

	private CaughtCreatureResult caught(
		UUID instanceId,
		String creatureId,
		String name,
		String rarity,
		int score,
		Instant caughtAt
	) {
		return new CaughtCreatureResult(
			instanceId,
			creatureId,
			name,
			rarity,
			score,
			caughtAt
		);
	}

	private Map<String, Integer> rarityCounts(
		List<CaughtCreatureResult> catches
	) {
		Map<String, Integer> counts = new LinkedHashMap<>();
		catches.forEach(caught -> counts.merge(
			caught.rarity(),
			1,
			Integer::sum
		));
		return counts;
	}

	private void clearData() {
		roundCatchRepository.deleteAll();
		playerRepository.deleteAll();
		roundRepository.deleteAll();
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	private record AuthFixture(String token, UserEntity user) {
	}

	private record PlayerFixture(
		AuthFixture auth,
		String displayName,
		int score,
		int rank,
		List<CaughtCreatureResult> catches
	) {
	}
}
