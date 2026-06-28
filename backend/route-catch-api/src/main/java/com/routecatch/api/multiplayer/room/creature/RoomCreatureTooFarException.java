package com.routecatch.api.multiplayer.room.creature;

import java.util.UUID;

public class RoomCreatureTooFarException extends RuntimeException {

	public RoomCreatureTooFarException(
		UUID instanceId,
		double distanceMeters,
		double catchRadiusMeters
	) {
		super(
			"Room creature %s is %.1f meters away; catch radius is %.1f meters"
				.formatted(instanceId, distanceMeters, catchRadiusMeters)
		);
	}
}
