package com.routecatch.api.multiplayer.room.movement.model;

import java.time.Instant;
import java.util.UUID;

public class RoomMovementPlan {

	private final UUID movementId;
	private final String roomCode;
	private final UUID playerId;
	private final long version;
	private final String encodedPolyline6;
	private final double totalDistanceMeters;
	private final double simulationSpeedMps;
	private final Instant startedAt;
	private final Instant expectedEndAt;
	private final MovementCoordinate source;
	private final MovementCoordinate destination;
	private final MovementDestinationType destinationType;
	private final UUID targetCreatureInstanceId;
	private final Instant createdAt;
	private MovementStatus status;
	private MovementCoordinate settledPosition;
	private Instant updatedAt;

	public RoomMovementPlan(
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
		MovementDestinationType destinationType,
		UUID targetCreatureInstanceId,
		Instant createdAt
	) {
		this.movementId = movementId;
		this.roomCode = roomCode;
		this.playerId = playerId;
		this.version = version;
		this.encodedPolyline6 = encodedPolyline6;
		this.totalDistanceMeters = totalDistanceMeters;
		this.simulationSpeedMps = simulationSpeedMps;
		this.startedAt = startedAt;
		this.expectedEndAt = expectedEndAt;
		this.source = source;
		this.destination = destination;
		this.destinationType = destinationType;
		this.targetCreatureInstanceId = targetCreatureInstanceId;
		this.createdAt = createdAt;
		this.status = MovementStatus.MOVING;
		this.updatedAt = createdAt;
	}

	public void cancel(MovementCoordinate position, Instant cancelledAt) {
		if (status != MovementStatus.MOVING) {
			return;
		}

		status = MovementStatus.CANCELLED;
		settledPosition = position;
		updatedAt = cancelledAt;
	}

	public void complete(
		MovementCoordinate finalRoutePosition,
		Instant completedAt
	) {
		if (status != MovementStatus.MOVING) {
			return;
		}

		status = MovementStatus.COMPLETED;
		settledPosition = finalRoutePosition;
		updatedAt = completedAt;
	}

	public UUID getMovementId() {
		return movementId;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public UUID getPlayerId() {
		return playerId;
	}

	public long getVersion() {
		return version;
	}

	public String getEncodedPolyline6() {
		return encodedPolyline6;
	}

	public double getTotalDistanceMeters() {
		return totalDistanceMeters;
	}

	public double getSimulationSpeedMps() {
		return simulationSpeedMps;
	}

	public Instant getStartedAt() {
		return startedAt;
	}

	public Instant getExpectedEndAt() {
		return expectedEndAt;
	}

	public MovementCoordinate getSource() {
		return source;
	}

	public MovementCoordinate getDestination() {
		return destination;
	}

	public MovementDestinationType getDestinationType() {
		return destinationType;
	}

	public UUID getTargetCreatureInstanceId() {
		return targetCreatureInstanceId;
	}

	public MovementStatus getStatus() {
		return status;
	}

	public MovementCoordinate getSettledPosition() {
		return settledPosition;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
