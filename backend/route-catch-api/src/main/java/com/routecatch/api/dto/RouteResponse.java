package com.routecatch.api.dto;

import java.util.List;

public record RouteResponse(
	List<CoordinateDto> coordinates,
	double distanceMeters,
	double durationSeconds,
	CoordinateDto source,
	CoordinateDto destination
) {
}
