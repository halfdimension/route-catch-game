package com.routecatch.api.routing;

import java.util.Objects;

public record NearestPointQuery(
	TravelMode travelMode,
	RoutingCoordinate point
) {

	public NearestPointQuery {
		Objects.requireNonNull(travelMode, "travelMode is required");
		Objects.requireNonNull(point, "point is required");
	}
}
