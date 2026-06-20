package com.routecatch.api.auth;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;

@SpringBootTest
@AutoConfigureMockMvc
class AuthApiTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@BeforeEach
	void clearData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void registerSucceedsAndPersistsNormalizedUser() throws Exception {
		mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "  Harsh_1  ",
						"email": "  HARSH@example.COM  ",
						"displayName": "  Harsh  ",
						"password": "password123"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.token").isNotEmpty())
			.andExpect(jsonPath("$.tokenType").value("Bearer"))
			.andExpect(jsonPath("$.user.userId").isNotEmpty())
			.andExpect(jsonPath("$.user.username").value("harsh_1"))
			.andExpect(jsonPath("$.user.email").value("harsh@example.com"))
			.andExpect(jsonPath("$.user.displayName").value("Harsh"))
			.andExpect(jsonPath("$.user.createdAt").isNotEmpty());

		UserEntity user = userRepository.findByUsername("harsh_1").orElseThrow();

		assertNotEquals("password123", user.getPasswordHash());
		assertTrue(passwordEncoder.matches("password123", user.getPasswordHash()));
	}

	@Test
	void registerAllowsMissingEmail() throws Exception {
		mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "harsh",
						"displayName": "Harsh",
						"password": "password123"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.token").isNotEmpty())
			.andExpect(jsonPath("$.tokenType").value("Bearer"))
			.andExpect(jsonPath("$.user.username").value("harsh"))
			.andExpect(jsonPath("$.user.email").isEmpty());
	}

	@Test
	void duplicateUsernameReturnsConflict() throws Exception {
		registerUser("harsh", "harsh@example.com");

		mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "HARSH",
						"email": "other@example.com",
						"displayName": "Other",
						"password": "password123"
					}
					"""))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("USER_ALREADY_EXISTS"))
			.andExpect(jsonPath("$.message").value("Username is already registered"))
			.andExpect(jsonPath("$.path").value("/api/auth/register"));
	}

	@Test
	void duplicateEmailReturnsConflict() throws Exception {
		registerUser("harsh", "harsh@example.com");

		mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "other",
						"email": "HARSH@example.com",
						"displayName": "Other",
						"password": "password123"
					}
					"""))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.errorCode").value("USER_ALREADY_EXISTS"))
			.andExpect(jsonPath("$.message").value("Email is already registered"));
	}

	@Test
	void loginSucceedsByUsername() throws Exception {
		registerUser("harsh", "harsh@example.com");

		mockMvc.perform(post("/api/auth/login")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"usernameOrEmail": " HARSH ",
						"password": "password123"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.token").isNotEmpty())
			.andExpect(jsonPath("$.tokenType").value("Bearer"))
			.andExpect(jsonPath("$.user.username").value("harsh"))
			.andExpect(jsonPath("$.user.email").value("harsh@example.com"));
	}

	@Test
	void loginSucceedsByEmail() throws Exception {
		registerUser("harsh", "harsh@example.com");

		mockMvc.perform(post("/api/auth/login")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"usernameOrEmail": " HARSH@example.COM ",
						"password": "password123"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.token").isNotEmpty())
			.andExpect(jsonPath("$.tokenType").value("Bearer"))
			.andExpect(jsonPath("$.user.username").value("harsh"));
	}

	@Test
	void wrongPasswordReturnsUnauthorized() throws Exception {
		registerUser("harsh", "harsh@example.com");

		mockMvc.perform(post("/api/auth/login")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"usernameOrEmail": "harsh",
						"password": "wrong-password"
					}
					"""))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("INVALID_CREDENTIALS"))
			.andExpect(jsonPath("$.path").value("/api/auth/login"));
	}

	@Test
	void unknownUserReturnsUnauthorized() throws Exception {
		mockMvc.perform(post("/api/auth/login")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"usernameOrEmail": "missing",
						"password": "password123"
					}
					"""))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("INVALID_CREDENTIALS"));
	}

	@Test
	void invalidRegisterRequestReturnsValidationError() throws Exception {
		mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "bad-name",
						"email": "not-an-email",
						"displayName": "Harsh",
						"password": "short"
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.path").value("/api/auth/register"));
	}

	@Test
	void meWithValidTokenReturnsCurrentUser() throws Exception {
		String token = registerUserAndReturnToken("harsh", "harsh@example.com");

		mockMvc.perform(get("/api/auth/me")
				.header("Authorization", "Bearer " + token))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.username").value("harsh"))
			.andExpect(jsonPath("$.email").value("harsh@example.com"))
			.andExpect(jsonPath("$.displayName").value("Harsh"))
			.andExpect(jsonPath("$.createdAt").isNotEmpty());
	}

	@Test
	void meWithoutTokenReturnsUnauthorizedJson() throws Exception {
		mockMvc.perform(get("/api/auth/me"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"))
			.andExpect(jsonPath("$.message").value("Authentication is required"))
			.andExpect(jsonPath("$.path").value("/api/auth/me"));
	}

	@Test
	void meWithInvalidTokenReturnsUnauthorizedJson() throws Exception {
		mockMvc.perform(get("/api/auth/me")
				.header("Authorization", "Bearer not-a-valid-token"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"))
			.andExpect(jsonPath("$.path").value("/api/auth/me"));
	}

	@Test
	void gameSessionCreationStillWorksWithoutAuth() throws Exception {
		mockMvc.perform(post("/api/game/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"durationSeconds": 60,
						"playerName": "Guest Player"
					}
					"""))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("CREATED"))
			.andExpect(jsonPath("$.playerName").value("Guest Player"));
	}

	private void registerUser(String username, String email) throws Exception {
		registerUserAndReturnToken(username, email);
	}

	private String registerUserAndReturnToken(String username, String email)
		throws Exception {
		String response = mockMvc.perform(post("/api/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"username": "%s",
						"email": "%s",
						"displayName": "Harsh",
						"password": "password123"
					}
					""".formatted(username, email)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		return com.jayway.jsonpath.JsonPath.read(response, "$.token");
	}
}
