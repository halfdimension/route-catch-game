package com.routecatch.api.multiplayer.room.creature;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class WebSocketRoomCreatureEventPublisher
	implements RoomCreatureEventPublisher {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		WebSocketRoomCreatureEventPublisher.class
	);

	private final SimpMessagingTemplate messagingTemplate;

	public WebSocketRoomCreatureEventPublisher(
		SimpMessagingTemplate messagingTemplate
	) {
		this.messagingTemplate = messagingTemplate;
	}

	@Override
	public void publish(String roomCode, RoomCreatureEvent event) {
		LOGGER.info(
			"creature broadcast roomCode={} creatureId={} playerId={} eventType={} topic={}",
			roomCode,
			event.creature().instanceId(),
			event.playerId(),
			event.eventType(),
			topic(roomCode)
		);
		messagingTemplate.convertAndSend(topic(roomCode), event);
	}

	private String topic(String roomCode) {
		return "/topic/rooms/" + roomCode + "/creatures";
	}
}
