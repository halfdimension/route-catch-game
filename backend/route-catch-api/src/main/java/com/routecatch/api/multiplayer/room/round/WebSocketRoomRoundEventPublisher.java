package com.routecatch.api.multiplayer.room.round;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;

@Component
public class WebSocketRoomRoundEventPublisher
	implements RoomRoundEventPublisher {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		WebSocketRoomRoundEventPublisher.class
	);
	private final SimpMessagingTemplate messagingTemplate;

	public WebSocketRoomRoundEventPublisher(
		SimpMessagingTemplate messagingTemplate
	) {
		this.messagingTemplate = messagingTemplate;
	}

	@Override
	public void publish(RoomEventEnvelope<PublicRoundResult> event) {
		messagingTemplate.convertAndSend(topic(event.roomCode()), event);
		LOGGER.info(
			"GAME_ENDED published roomCode={} roundId={} roomSequence={} topic={}",
			event.roomCode(),
			event.payload().roundId(),
			event.roomSequence(),
			topic(event.roomCode())
		);
	}

	private String topic(String roomCode) {
		return "/topic/rooms/" + roomCode + "/events";
	}
}
