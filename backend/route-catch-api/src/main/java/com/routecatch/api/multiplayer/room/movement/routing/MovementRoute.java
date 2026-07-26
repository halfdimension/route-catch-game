package com.routecatch.api.multiplayer.room.movement.routing;

public record MovementRoute(
	String encodedPolyline6,
	double distanceMeters,
	double durationSeconds
) {
}
