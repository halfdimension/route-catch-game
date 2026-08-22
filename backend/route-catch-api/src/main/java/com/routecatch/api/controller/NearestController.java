package com.routecatch.api.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.dto.CoordinateDto;
import com.routecatch.api.dto.NearestRequest;
import com.routecatch.api.dto.NearestResponse;
import com.routecatch.api.routing.NearestPointQuery;
import com.routecatch.api.routing.NearestPointResult;
import com.routecatch.api.routing.RoutingCoordinate;
import com.routecatch.api.routing.TravelMode;
import com.routecatch.api.routing.TravelRoutingService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/nearest")
public class NearestController {

	private final TravelRoutingService routingService;

	public NearestController(TravelRoutingService routingService) {
		this.routingService = routingService;
	}

	@PostMapping
	public NearestResponse findNearest(@Valid @RequestBody NearestRequest request) {
		NearestPointResult result = routingService.findNearestPoint(
			new NearestPointQuery(
				TravelMode.fromApiValue(request.travelMode()),
				new RoutingCoordinate(request.lat(), request.lon())
			)
		);

		return new NearestResponse(
			new CoordinateDto(
				result.snappedPoint().latitude(),
				result.snappedPoint().longitude()
			),
			result.distanceMeters(),
			result.name()
		);
	}
}
