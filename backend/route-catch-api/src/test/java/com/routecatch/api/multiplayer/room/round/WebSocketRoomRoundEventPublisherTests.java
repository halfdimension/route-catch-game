package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomEventType;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

class WebSocketRoomRoundEventPublisherTests {

	@Test
	void propagatesSendFailureInsteadOfReportingSuccessfulPublication() {
		SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
		WebSocketRoomRoundEventPublisher publisher =
			new WebSocketRoomRoundEventPublisher(messagingTemplate);
		RoomEventEnvelope<PublicRoundResult> event = event();
		RuntimeException failure = new RuntimeException("send failed");
		Logger logger = (Logger) LoggerFactory.getLogger(
			WebSocketRoomRoundEventPublisher.class
		);
		ListAppender<ILoggingEvent> appender = new ListAppender<>();
		appender.start();
		logger.addAppender(appender);
		doThrow(failure).when(messagingTemplate).convertAndSend(
			"/topic/rooms/ROOM01/events",
			event
		);

		try {
			assertThrows(RuntimeException.class, () -> publisher.publish(event));
			verify(messagingTemplate).convertAndSend(
				"/topic/rooms/ROOM01/events",
				event
			);
			assertTrue(appender.list.stream().noneMatch(log ->
				log.getFormattedMessage().startsWith("GAME_ENDED published")
			));
		} finally {
			logger.detachAppender(appender);
			appender.stop();
		}
	}

	private RoomEventEnvelope<PublicRoundResult> event() {
		Instant now = Instant.parse("2026-07-26T10:00:00Z");
		PublicRoundResult result = new PublicRoundResult(
			UUID.randomUUID(),
			"ROOM01",
			now.minusSeconds(60),
			now,
			RoundEndReason.HOST_ENDED,
			0,
			List.of()
		);
		return new RoomEventEnvelope<>(
			UUID.randomUUID(),
			"ROOM01",
			1L,
			RoomEventType.GAME_ENDED,
			now,
			result
		);
	}
}
