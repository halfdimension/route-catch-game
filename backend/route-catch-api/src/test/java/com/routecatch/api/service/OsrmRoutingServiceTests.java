package com.routecatch.api.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.routecatch.api.dto.RouteRequest;
import com.routecatch.api.exception.RoutingEngineException;
import com.sun.net.httpserver.HttpServer;

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

	@Test
	void noRouteOsrmResponsePreservesRouteUnavailableDetails()
		throws Exception {
		HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
		server.createContext("/route/v1/driving", exchange -> {
			byte[] responseBody = """
				{"message":"Impossible route between points","code":"NoRoute"}
				""".getBytes(StandardCharsets.UTF_8);

			exchange.getResponseHeaders().add("Content-Type", "application/json");
			exchange.sendResponseHeaders(400, responseBody.length);
			exchange.getResponseBody().write(responseBody);
			exchange.close();
		});
		server.start();

		try {
			OsrmRoutingService service = new OsrmRoutingService(
				"http://127.0.0.1:" + server.getAddress().getPort()
			);
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

			assertEquals("NoRoute", exception.getErrorCode());
			assertEquals(
				"Impossible route between points",
				exception.getMessage()
			);
			assertEquals(HttpStatus.BAD_REQUEST, exception.getStatus());
		} finally {
			server.stop(0);
		}
	}
}
