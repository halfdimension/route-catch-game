package com.routecatch.api.multiplayer.room.round.history;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.auth.service.JwtTokenService;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;

@SpringBootTest
@AutoConfigureMockMvc
class MultiplayerRoundHistoryFailureApiTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private JwtTokenService tokenService;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@MockitoBean
	private GameRoundPlayerRepository playerRepository;

	@AfterEach
	void clearData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void persistenceFailureReturnsSanitizedHistorySpecificResponse()
		throws Exception {
		UserEntity user = userRepository.saveAndFlush(new UserEntity(
			UUID.randomUUID(),
			"history_failure",
			"history-failure@example.com",
			"History Failure",
			"hashed-password"
		));
		String secret = "select credentials from game_round_players";
		when(playerRepository.findCompletedHistoryByUserId(
			eq(user.getUserId()),
			eq(RoomGameStatus.ENDED),
			any(Pageable.class)
		)).thenThrow(new DataRetrievalFailureException(secret));

		mockMvc.perform(get("/api/multiplayer/me/rounds")
				.header(
					"Authorization",
					"Bearer " + tokenService.generateToken(user)
				))
			.andExpect(status().isInternalServerError())
			.andExpect(jsonPath("$.errorCode")
				.value("ROUND_HISTORY_UNAVAILABLE"))
			.andExpect(jsonPath("$.message")
				.value("Multiplayer round history is unavailable"))
			.andExpect(content().string(not(containsString(secret))))
			.andExpect(content().string(not(containsString("game_round_players"))))
			.andExpect(content().string(not(containsString("credentials"))));
	}
}
