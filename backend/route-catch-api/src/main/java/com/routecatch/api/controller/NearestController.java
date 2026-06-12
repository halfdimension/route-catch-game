package com.routecatch.api.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.dto.NearestRequest;
import com.routecatch.api.dto.NearestResponse;
import com.routecatch.api.service.OsrmRoutingService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/nearest")
public class NearestController {

	private final OsrmRoutingService routingService;

	public NearestController(OsrmRoutingService routingService) {
		this.routingService = routingService;
	}

	@PostMapping
	public NearestResponse findNearest(@Valid @RequestBody NearestRequest request) {
		return routingService.fetchNearest(request);
	}
}
