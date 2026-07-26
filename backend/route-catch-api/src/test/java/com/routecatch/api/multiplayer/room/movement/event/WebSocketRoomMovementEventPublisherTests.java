package com.routecatch.api.multiplayer.room.movement.event;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomEventType;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;
import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;
import com.routecatch.api.multiplayer.room.movement.model.MovementStatus;

class WebSocketRoomMovementEventPublisherTests {

	@Test
	void publishesEnvelopeUnchangedToExactRoomMovementTopic() {
		CapturingMessageChannel messageChannel = new CapturingMessageChannel();
		WebSocketRoomMovementEventPublisher publisher =
			new WebSocketRoomMovementEventPublisher(
				new SimpMessagingTemplate(messageChannel)
			);
		RoomEventEnvelope<RoomMovementPlanResponse> envelope = envelope();

		publisher.publish(envelope);

		assertEquals(1, messageChannel.messages.size());
		Message<?> broadcast = messageChannel.messages.getFirst();
		assertEquals(
			"/topic/rooms/ROOM01/movements",
			broadcast.getHeaders().get("simpDestination")
		);
		assertSame(envelope, broadcast.getPayload());
	}

	private RoomEventEnvelope<RoomMovementPlanResponse> envelope() {
		Instant startedAt = Instant.parse("2026-07-18T07:00:00Z");
		MovementCoordinate source = new MovementCoordinate(28.6139, 77.209);
		MovementCoordinate destination = new MovementCoordinate(28.614, 77.21);
		RoomMovementPlanResponse payload = new RoomMovementPlanResponse(
			UUID.fromString("10000000-0000-0000-0000-000000000001"),
			"ROOM01",
			UUID.fromString("20000000-0000-0000-0000-000000000002"),
			3L,
			"womqu@oymgrCgEo}@",
			123.4,
			80.0,
			startedAt,
			startedAt.plusSeconds(2),
			source,
			destination,
			source,
			MovementDestinationType.MAP,
			null,
			MovementStatus.MOVING,
			startedAt,
			startedAt
		);

		return new RoomEventEnvelope<>(
			UUID.fromString("30000000-0000-0000-0000-000000000003"),
			"ROOM01",
			7L,
			RoomEventType.MOVEMENT_STARTED,
			startedAt,
			payload
		);
	}

	private static class CapturingMessageChannel implements MessageChannel {

		private final List<Message<?>> messages = new ArrayList<>();

		@Override
		public boolean send(Message<?> message) {
			messages.add(message);
			return true;
		}

		@Override
		public boolean send(Message<?> message, long timeout) {
			messages.add(message);
			return true;
		}
	}
}
