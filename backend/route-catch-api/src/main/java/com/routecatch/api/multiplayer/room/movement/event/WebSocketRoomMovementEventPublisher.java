package com.routecatch.api.multiplayer.room.movement.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;

@Component
public class WebSocketRoomMovementEventPublisher
	implements RoomMovementEventPublisher {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		WebSocketRoomMovementEventPublisher.class
	);

	private final SimpMessagingTemplate messagingTemplate;

	public WebSocketRoomMovementEventPublisher(
		SimpMessagingTemplate messagingTemplate
	) {
		this.messagingTemplate = messagingTemplate;
	}

	@Override
	public void publish(RoomEventEnvelope<RoomMovementPlanResponse> event) {
		LOGGER.info(
			"movement broadcast roomCode={} playerId={} movementId={} version={} eventType={} roomSequence={} topic={}",
			event.roomCode(),
			event.payload().playerId(),
			event.payload().movementId(),
			event.payload().version(),
			event.eventType(),
			event.roomSequence(),
			topic(event.roomCode())
		);
		messagingTemplate.convertAndSend(topic(event.roomCode()), event);
	}

	private String topic(String roomCode) {
		return "/topic/rooms/" + roomCode + "/movements";
	}
}
