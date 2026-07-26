package com.routecatch.api.multiplayer.room.movement.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

class OsrmMovementRouteClientTests {

	private static final MovementCoordinate SOURCE = new MovementCoordinate(
		28.6139,
		77.209
	);
	private static final MovementCoordinate DESTINATION = new MovementCoordinate(
		28.614,
		77.21
	);

	@Test
	void requestsFullPolyline6RouteAndReturnsMovementRoute() throws Exception {
		AtomicReference<URI> requestedUri = new AtomicReference<>();
		HttpServer server = routeServer((exchange) -> {
			requestedUri.set(exchange.getRequestURI());
			respond(exchange, 200, """
				{"code":"Ok","routes":[{"geometry":"womqu@oymgrCgEo}@","distance":123.4,"duration":12.5}]}
				""");
		});

		try {
			MovementRoute route = client(server).fetchRoute(SOURCE, DESTINATION);

			assertEquals("womqu@oymgrCgEo}@", route.encodedPolyline6());
			assertEquals(123.4, route.distanceMeters());
			assertEquals(12.5, route.durationSeconds());
			assertEquals(
				"/route/v1/driving/77.209,28.6139;77.21,28.614",
				requestedUri.get().getPath()
			);
			assertEquals(
				"overview=full&geometries=polyline6&steps=false",
				requestedUri.get().getRawQuery()
			);
		} finally {
			server.stop(0);
		}
	}

	@Test
	void noRouteResponsePreservesOsrmError() throws Exception {
		HttpServer server = routeServer((exchange) -> respond(exchange, 400, """
			{"code":"NoRoute","message":"Impossible route between points"}
			"""));

		try {
			RoutingEngineException exception = assertThrows(
				RoutingEngineException.class,
				() -> client(server).fetchRoute(SOURCE, DESTINATION)
			);

			assertEquals("NoRoute", exception.getErrorCode());
			assertEquals("Impossible route between points", exception.getMessage());
			assertEquals(HttpStatus.BAD_REQUEST, exception.getStatus());
		} finally {
			server.stop(0);
		}
	}

	@Test
	void malformedGeometryIsRejectedAsInvalidRoutingResponse() throws Exception {
		HttpServer server = routeServer((exchange) -> respond(exchange, 200, """
			{"code":"Ok","routes":[{"geometry":"_izlhA","distance":10.0,"duration":1.0}]}
			"""));

		try {
			RoutingEngineException exception = assertThrows(
				RoutingEngineException.class,
				() -> client(server).fetchRoute(SOURCE, DESTINATION)
			);

			assertEquals(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				exception.getErrorCode()
			);
			assertEquals(HttpStatus.BAD_GATEWAY, exception.getStatus());
		} finally {
			server.stop(0);
		}
	}

	@Test
	void missingRouteMetricsAreRejectedAsInvalidRoutingResponse()
		throws Exception {
		HttpServer server = routeServer((exchange) -> respond(exchange, 200, """
			{"code":"Ok","routes":[{"geometry":"womqu@oymgrCgEo}@"}]}
			"""));

		try {
			RoutingEngineException exception = assertThrows(
				RoutingEngineException.class,
				() -> client(server).fetchRoute(SOURCE, DESTINATION)
			);

			assertEquals(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				exception.getErrorCode()
			);
		} finally {
			server.stop(0);
		}
	}

	@Test
	void missingOsrmStatusIsRejectedAsInvalidRoutingResponse() throws Exception {
		HttpServer server = routeServer((exchange) -> respond(exchange, 200, """
			{"routes":[{"geometry":"womqu@oymgrCgEo}@","distance":10.0,"duration":1.0}]}
			"""));

		try {
			RoutingEngineException exception = assertThrows(
				RoutingEngineException.class,
				() -> client(server).fetchRoute(SOURCE, DESTINATION)
			);

			assertEquals(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				exception.getErrorCode()
			);
		} finally {
			server.stop(0);
		}
	}

	@Test
	void configuredReadTimeoutBoundsSlowOsrmResponse() throws Exception {
		HttpServer server = routeServer((exchange) -> {
			try {
				Thread.sleep(250L);
			} catch (InterruptedException exception) {
				Thread.currentThread().interrupt();
				throw new IOException("Interrupted while delaying response", exception);
			}

			respond(exchange, 200, """
				{"code":"Ok","routes":[{"geometry":"womqu@oymgrCgEo}@","distance":123.4,"duration":12.5}]}
				""");
		});

		try {
			OsrmMovementRouteClient client = new OsrmMovementRouteClient(
				baseUrl(server),
				Duration.ofSeconds(1),
				Duration.ofMillis(50)
			);
			RoutingEngineException exception = assertThrows(
				RoutingEngineException.class,
				() -> client.fetchRoute(SOURCE, DESTINATION)
			);

			assertEquals("ROUTING_ENGINE_UNAVAILABLE", exception.getErrorCode());
			assertEquals(HttpStatus.BAD_GATEWAY, exception.getStatus());
		} finally {
			server.stop(0);
		}
	}

	@Test
	void unboundedOrUnsupportedTimeoutConfigurationIsRejected() {
		for (Duration timeout : new Duration[] {
			null,
			Duration.ofMillis(-1),
			Duration.ZERO,
			Duration.ofNanos(1),
			Duration.ofMillis(Integer.MAX_VALUE).plusMillis(1)
		}) {
			assertThrows(
				IllegalArgumentException.class,
				() -> new OsrmMovementRouteClient(
					"http://localhost:5000",
					timeout,
					Duration.ofSeconds(1)
				)
			);
			assertThrows(
				IllegalArgumentException.class,
				() -> new OsrmMovementRouteClient(
					"http://localhost:5000",
					Duration.ofSeconds(1),
					timeout
				)
			);
		}
	}

	private OsrmMovementRouteClient client(HttpServer server) {
		return new OsrmMovementRouteClient(baseUrl(server));
	}

	private String baseUrl(HttpServer server) {
		return "http://127.0.0.1:" + server.getAddress().getPort();
	}

	private HttpServer routeServer(RouteHandler handler) throws IOException {
		HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
		server.createContext("/route/v1/driving/", (exchange) -> {
			try {
				handler.handle(exchange);
			} finally {
				exchange.close();
			}
		});
		server.start();
		return server;
	}

	private static void respond(
		HttpExchange exchange,
		int status,
		String responseBody
	) throws IOException {
		byte[] responseBytes = responseBody.getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(status, responseBytes.length);
		exchange.getResponseBody().write(responseBytes);
	}

	@FunctionalInterface
	private interface RouteHandler {
		void handle(HttpExchange exchange) throws IOException;
	}
}
