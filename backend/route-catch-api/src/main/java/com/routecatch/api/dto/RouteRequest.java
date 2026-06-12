package com.routecatch.api.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

public record RouteRequest(
	@NotNull
	@DecimalMin(value = "-90.0", message = "must be between -90 and 90")
	@DecimalMax(value = "90.0", message = "must be between -90 and 90")
	Double sourceLat,

	@NotNull
	@DecimalMin(value = "-180.0", message = "must be between -180 and 180")
	@DecimalMax(value = "180.0", message = "must be between -180 and 180")
	Double sourceLon,

	@NotNull
	@DecimalMin(value = "-90.0", message = "must be between -90 and 90")
	@DecimalMax(value = "90.0", message = "must be between -90 and 90")
	Double destinationLat,

	@NotNull
	@DecimalMin(value = "-180.0", message = "must be between -180 and 180")
	@DecimalMax(value = "180.0", message = "must be between -180 and 180")
	Double destinationLon
) {
}
