package com.routecatch.api.multiplayer.listener;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import com.routecatch.api.multiplayer.service.PresenceService;

@Component
public class PresenceDisconnectListener {
	private static final Logger LOGGER = LoggerFactory.getLogger(
		PresenceDisconnectListener.class
	);

	private final PresenceService presenceService;
	private final SimpMessagingTemplate messagingTemplate;

	public PresenceDisconnectListener(
		PresenceService presenceService,
		SimpMessagingTemplate messagingTemplate
	) {
		this.presenceService = presenceService;
		this.messagingTemplate = messagingTemplate;
	}

	@EventListener
	public void handleConnect(SessionConnectedEvent event) {
		presenceService.registerSocketSession(
			SimpMessageHeaderAccessor.getSessionId(event.getMessage().getHeaders())
		);
	}

	@EventListener
	public void handleDisconnect(SessionDisconnectEvent event) {
		presenceService.removeSocketSession(
			event.getSessionId(),
			(roomId, presence) -> {
				try {
					messagingTemplate.convertAndSend(
						"/topic/rooms/" + roomId + "/presence",
						presence
					);
				} catch (RuntimeException exception) {
					LOGGER.error(
						"Presence disconnect broadcast failed for roomCode={}",
						roomId,
						exception
					);
				}
			}
		);
	}
}
