package com.routecatch.api.routing;

import java.util.List;
import java.util.Objects;

public record RouteResult(
	List<RoutingCoordinate> coordinates,
	double distanceMeters,
	double durationSeconds,
	RoutingCoordinate source,
	RoutingCoordinate destination
) {

	public RouteResult {
		coordinates = List.copyOf(
			Objects.requireNonNull(coordinates, "coordinates are required")
		);
		Objects.requireNonNull(source, "source is required");
		Objects.requireNonNull(destination, "destination is required");
	}
}
