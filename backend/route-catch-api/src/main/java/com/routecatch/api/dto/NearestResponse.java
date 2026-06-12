package com.routecatch.api.dto;

public record NearestResponse(
	CoordinateDto snappedPoint,
	double distanceMeters,
	String name
) {
}
