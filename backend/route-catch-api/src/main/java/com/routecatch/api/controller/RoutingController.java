package com.routecatch.api.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.dto.RouteRequest;
import com.routecatch.api.dto.RouteResponse;
import com.routecatch.api.service.OsrmRoutingService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/routes")
public class RoutingController {

	private final OsrmRoutingService routingService;

	public RoutingController(OsrmRoutingService routingService) {
		this.routingService = routingService;
	}

	@PostMapping
	public RouteResponse createRoute(@Valid @RequestBody RouteRequest request) {
		return routingService.fetchRoute(request);
	}
}
