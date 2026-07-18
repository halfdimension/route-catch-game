package com.routecatch.api.multiplayer.controller;

import java.security.Principal;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Controller;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.dto.PresenceResponse;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.service.PresenceService;

@Controller
public class PresenceWebSocketController {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		PresenceWebSocketController.class
	);

	private final PresenceService presenceService;
	private final SimpMessagingTemplate messagingTemplate;

	public PresenceWebSocketController(
		PresenceService presenceService,
		SimpMessagingTemplate messagingTemplate
	) {
		this.presenceService = presenceService;
		this.messagingTemplate = messagingTemplate;
	}

	@MessageMapping("/rooms/{roomId}/presence")
	public void updatePresence(
		@DestinationVariable String roomId,
		PresenceUpdateRequest request,
		@Header("simpSessionId") String socketSessionId,
		Principal principal
	) {
		UserEntity currentUser = authenticatedUser(principal);

		presenceService.withRoomLock(roomId, () -> {
			List<PresenceResponse> roomPresence = presenceService.updatePresence(
				roomId,
				currentUser,
				request,
				socketSessionId
			);

			try {
				messagingTemplate.convertAndSend(
					"/topic/rooms/" + roomId + "/presence",
					roomPresence
				);
			} catch (RuntimeException exception) {
				LOGGER.error(
					"Presence broadcast failed for roomCode={} playerId={}",
					roomId,
					currentUser.getUserId(),
					exception
				);
				throw exception;
			}

			return null;
		});
	}

	private UserEntity authenticatedUser(Principal principal) {
		if (!(principal instanceof Authentication authentication)) {
			throw new AccessDeniedException(
				"Authenticated WebSocket user is required"
			);
		}

		if (authentication.getPrincipal() instanceof UserEntity user) {
			return user;
		}

		throw new AccessDeniedException(
			"Authenticated WebSocket user is required"
		);
	}
}
