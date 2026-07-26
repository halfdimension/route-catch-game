package com.routecatch.api.multiplayer.room.round;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;

public interface RoomRoundEventPublisher {

	void publish(RoomEventEnvelope<PublicRoundResult> event);
}
