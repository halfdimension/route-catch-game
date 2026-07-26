package com.routecatch.api.multiplayer.room.movement.dto;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.routecatch.api.multiplayer.room.movement.model.MovementDestinationType;
import com.routecatch.api.multiplayer.room.movement.model.MovementStatus;
import com.routecatch.api.multiplayer.room.movement.model.RoomMovementPlan;

public record RoomMovementPlanResponse(
	UUID movementId,
	String roomCode,
	UUID playerId,
	long version,
	String encodedPolyline6,
	double totalDistanceMeters,
	double simulationSpeedMps,
	Instant startedAt,
	Instant expectedEndAt,
	MovementCoordinate source,
	MovementCoordinate destination,
	MovementCoordinate currentPosition,
	MovementDestinationType destinationType,
	UUID targetCreatureInstanceId,
	MovementStatus status,
	Instant createdAt,
	Instant updatedAt
) {

	public static RoomMovementPlanResponse from(
		RoomMovementPlan plan,
		MovementCoordinate currentPosition
	) {
		return new RoomMovementPlanResponse(
			plan.getMovementId(),
			plan.getRoomCode(),
			plan.getPlayerId(),
			plan.getVersion(),
			plan.getEncodedPolyline6(),
			plan.getTotalDistanceMeters(),
			plan.getSimulationSpeedMps(),
			plan.getStartedAt(),
			plan.getExpectedEndAt(),
			plan.getSource(),
			plan.getDestination(),
			currentPosition,
			plan.getDestinationType(),
			plan.getTargetCreatureInstanceId(),
			plan.getStatus(),
			plan.getCreatedAt(),
			plan.getUpdatedAt()
		);
	}
}
