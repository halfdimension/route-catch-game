package com.routecatch.api.multiplayer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.controller.PresenceWebSocketController;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.service.PresenceService;

class PresenceWebSocketControllerTests {

	@Test
	void updatePresenceRejectsMissingPrincipalWithoutCrashing() {
		PresenceService presenceService = new PresenceService();
		PresenceWebSocketController controller = new PresenceWebSocketController(
			presenceService,
			new SimpMessagingTemplate(new NoopMessageChannel())
		);

		assertThrows(
			AccessDeniedException.class,
			() -> controller.updatePresence(
				"delhi",
				new PresenceUpdateRequest(28.6, 77.2, "IDLE"),
				"socket-1",
				null
			)
		);
		assertEquals(0, presenceService.listRoomPresence("delhi").size());
	}

	@Test
	void updatePresenceUsesAuthenticationPrincipal() {
		PresenceService presenceService = new PresenceService();
		PresenceWebSocketController controller = new PresenceWebSocketController(
			presenceService,
			new SimpMessagingTemplate(new NoopMessageChannel())
		);
		UserEntity user = new UserEntity(
			UUID.randomUUID(),
			"harsh",
			"harsh@example.com",
			"Harsh",
			"hashed-password"
		);

		controller.updatePresence(
			"delhi",
			new PresenceUpdateRequest(28.6, 77.2, "IDLE"),
			"socket-1",
			new UsernamePasswordAuthenticationToken(user, "token")
		);

		assertEquals(1, presenceService.listRoomPresence("delhi").size());
		assertEquals(
			"harsh",
			presenceService.listRoomPresence("delhi").getFirst().username()
		);
	}

	private static class NoopMessageChannel implements MessageChannel {

		@Override
		public boolean send(Message<?> message) {
			return true;
		}

		@Override
		public boolean send(Message<?> message, long timeout) {
			return true;
		}
	}
}
