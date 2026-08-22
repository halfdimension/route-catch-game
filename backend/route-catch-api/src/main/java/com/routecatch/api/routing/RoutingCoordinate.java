package com.routecatch.api.routing;

public record RoutingCoordinate(double latitude, double longitude) {

	public RoutingCoordinate {
		if (
			!Double.isFinite(latitude) ||
			latitude < -90.0 ||
			latitude > 90.0
		) {
			throw new IllegalArgumentException(
				"Routing latitude must be between -90 and 90"
			);
		}
		if (
			!Double.isFinite(longitude) ||
			longitude < -180.0 ||
			longitude > 180.0
		) {
			throw new IllegalArgumentException(
				"Routing longitude must be between -180 and 180"
			);
		}
	}
}
