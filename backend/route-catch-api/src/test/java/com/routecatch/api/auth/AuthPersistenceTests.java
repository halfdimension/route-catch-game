package com.routecatch.api.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionEntity;
import com.routecatch.api.game.persistence.GameSessionRepository;

@SpringBootTest
class AuthPersistenceTests {

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@BeforeEach
	void clearGameData() {
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void userRepositoryFindsUsersByUsernameAndEmail() {
		UserEntity user = new UserEntity(
			UUID.randomUUID(),
			"harsh",
			"harsh@example.com",
			"Harsh",
			"hashed-password"
		);

		userRepository.saveAndFlush(user);

		assertTrue(userRepository.existsByUsername("harsh"));
		assertTrue(userRepository.existsByEmail("harsh@example.com"));
		assertEquals(
			user.getUserId(),
			userRepository.findByUsername("harsh").orElseThrow().getUserId()
		);
		assertEquals(
			user.getUserId(),
			userRepository.findByEmail("harsh@example.com").orElseThrow().getUserId()
		);
		assertFalse(userRepository.existsByUsername("missing"));
	}

	@Test
	void gameSessionCanLinkToUserId() {
		UserEntity user = userRepository.saveAndFlush(
			new UserEntity(
				UUID.randomUUID(),
				"harsh",
				null,
				"Harsh",
				"hashed-password"
			)
		);
		GameSessionEntity session = new GameSessionEntity(
			UUID.randomUUID(),
			60,
			"Harsh"
		);
		session.assignUser(user.getUserId());

		gameSessionRepository.saveAndFlush(session);

		GameSessionEntity persistedSession = gameSessionRepository
			.findById(session.getSessionId())
			.orElseThrow();

		assertEquals(user.getUserId(), persistedSession.getUserId());
	}

	@Test
	void gameSessionUserIdCanRemainNullForGuestSessions() {
		GameSessionEntity session = new GameSessionEntity(
			UUID.randomUUID(),
			60,
			"Guest"
		);

		gameSessionRepository.saveAndFlush(session);

		GameSessionEntity persistedSession = gameSessionRepository
			.findById(session.getSessionId())
			.orElseThrow();

		assertNull(persistedSession.getUserId());
	}
}
