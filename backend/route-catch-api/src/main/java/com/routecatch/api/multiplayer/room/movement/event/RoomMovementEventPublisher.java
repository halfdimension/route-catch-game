package com.routecatch.api.multiplayer.room.movement.event;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.movement.dto.RoomMovementPlanResponse;

public interface RoomMovementEventPublisher {

	void publish(RoomEventEnvelope<RoomMovementPlanResponse> event);
}
