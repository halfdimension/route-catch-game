package com.routecatch.api.routing;

import java.util.Objects;

public record NearestPointResult(
	RoutingCoordinate snappedPoint,
	double distanceMeters,
	String name
) {

	public NearestPointResult {
		Objects.requireNonNull(snappedPoint, "snappedPoint is required");
	}
}
