package com.routecatch.api.multiplayer.listener;

import java.util.List;
import java.util.Map;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import com.routecatch.api.multiplayer.dto.PresenceResponse;
import com.routecatch.api.multiplayer.service.PresenceService;

@Component
public class PresenceDisconnectListener {

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
	public void handleDisconnect(SessionDisconnectEvent event) {
		Map<String, List<PresenceResponse>> updatedRooms =
			presenceService.removeSocketSession(event.getSessionId());

		updatedRooms.forEach((roomId, presence) ->
			messagingTemplate.convertAndSend(
				"/topic/rooms/" + roomId + "/presence",
				presence
			)
		);
	}
}
