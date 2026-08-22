package com.routecatch.api.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.dto.CoordinateDto;
import com.routecatch.api.dto.RouteRequest;
import com.routecatch.api.dto.RouteResponse;
import com.routecatch.api.routing.RouteQuery;
import com.routecatch.api.routing.RouteResult;
import com.routecatch.api.routing.RoutingCoordinate;
import com.routecatch.api.routing.TravelMode;
import com.routecatch.api.routing.TravelRoutingService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/routes")
public class RoutingController {

	private final TravelRoutingService routingService;

	public RoutingController(TravelRoutingService routingService) {
		this.routingService = routingService;
	}

	@PostMapping
	public RouteResponse createRoute(@Valid @RequestBody RouteRequest request) {
		RouteResult result = routingService.route(new RouteQuery(
			TravelMode.fromApiValue(request.travelMode()),
			new RoutingCoordinate(request.sourceLat(), request.sourceLon()),
			new RoutingCoordinate(
				request.destinationLat(),
				request.destinationLon()
			)
		));

		return new RouteResponse(
			result.coordinates().stream()
				.map(RoutingController::toResponseCoordinate)
				.toList(),
			result.distanceMeters(),
			result.durationSeconds(),
			toResponseCoordinate(result.source()),
			toResponseCoordinate(result.destination())
		);
	}

	private static CoordinateDto toResponseCoordinate(
		RoutingCoordinate coordinate
	) {
		return new CoordinateDto(coordinate.latitude(), coordinate.longitude());
	}
}
