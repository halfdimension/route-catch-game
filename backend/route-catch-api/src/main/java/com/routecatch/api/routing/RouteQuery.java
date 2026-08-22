package com.routecatch.api.routing;

import java.util.Objects;

public record RouteQuery(
	TravelMode travelMode,
	RoutingCoordinate source,
	RoutingCoordinate destination
) {

	public RouteQuery {
		Objects.requireNonNull(travelMode, "travelMode is required");
		Objects.requireNonNull(source, "source is required");
		Objects.requireNonNull(destination, "destination is required");
	}
}
