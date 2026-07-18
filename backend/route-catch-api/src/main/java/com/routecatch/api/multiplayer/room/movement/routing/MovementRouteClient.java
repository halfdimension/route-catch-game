package com.routecatch.api.multiplayer.room.movement.routing;

import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;

public interface MovementRouteClient {

	MovementRoute fetchRoute(
		MovementCoordinate source,
		MovementCoordinate destination
	);
}
