package com.routecatch.api.multiplayer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.listener.PresenceDisconnectListener;
import com.routecatch.api.multiplayer.service.PresenceService;

class PresenceConnectionLifecycleTests {

	@Test
	void connectionEventsActivateAndDeactivatePresenceSession() {
		PresenceService presenceService = new PresenceService();
		PresenceDisconnectListener listener = new PresenceDisconnectListener(
			presenceService,
			new SimpMessagingTemplate(new NoopMessageChannel())
		);
		Message<byte[]> sessionMessage = MessageBuilder
			.withPayload(new byte[0])
			.setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, "socket-1")
			.build();
		UserEntity user = new UserEntity(
			UUID.randomUUID(),
			"harsh",
			"harsh@example.com",
			"Harsh",
			"hashed-password"
		);

		listener.handleConnect(new SessionConnectedEvent(this, sessionMessage));
		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.6, 77.2, "MOVING"),
			"socket-1"
		);
		assertEquals(1, presenceService.listRoomPresence("demo-room").size());

		listener.handleDisconnect(new SessionDisconnectEvent(
			this,
			sessionMessage,
			"socket-1",
			CloseStatus.NORMAL
		));
		assertTrue(presenceService.listRoomPresence("demo-room").isEmpty());

		presenceService.updatePresence(
			"demo-room",
			user,
			new PresenceUpdateRequest(28.7, 77.3, "MOVING"),
			"socket-1"
		);
		assertTrue(presenceService.listRoomPresence("demo-room").isEmpty());
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
