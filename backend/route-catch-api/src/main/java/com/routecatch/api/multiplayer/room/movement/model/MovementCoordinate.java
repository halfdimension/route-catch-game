package com.routecatch.api.multiplayer.room.movement.model;

public record MovementCoordinate(
	double latitude,
	double longitude
) {

	public MovementCoordinate {
		if (!Double.isFinite(latitude) || latitude < -90.0 || latitude > 90.0) {
			throw new IllegalArgumentException(
				"Movement latitude must be finite and between -90 and 90"
			);
		}

		if (
			!Double.isFinite(longitude) ||
			longitude < -180.0 ||
			longitude > 180.0
		) {
			throw new IllegalArgumentException(
				"Movement longitude must be finite and between -180 and 180"
			);
		}
	}
}
