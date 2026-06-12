package com.routecatch.api.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

import com.routecatch.api.dto.RouteRequest;
import com.routecatch.api.exception.RoutingEngineException;

class OsrmRoutingServiceTests {

	@Test
	void unavailableOsrmThrowsCleanRoutingEngineException() {
		OsrmRoutingService service = new OsrmRoutingService("http://127.0.0.1:1");
		RouteRequest request = new RouteRequest(
			28.6139,
			77.2090,
			28.6200,
			77.2150
		);

		RoutingEngineException exception = assertThrows(
			RoutingEngineException.class,
			() -> service.fetchRoute(request)
		);

		assertEquals("ROUTING_ENGINE_UNAVAILABLE", exception.getErrorCode());
		assertEquals("Routing engine is not reachable", exception.getMessage());
	}
}
