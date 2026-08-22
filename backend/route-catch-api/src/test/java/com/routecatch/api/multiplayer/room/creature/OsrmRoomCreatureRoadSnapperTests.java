package com.routecatch.api.multiplayer.room.creature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.routecatch.api.service.OsrmRoutingService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

class OsrmRoomCreatureRoadSnapperTests {

	@Test
	void multiplayerCreatureSnapperUsesOsrmDrivingDirectly() throws Exception {
		AtomicReference<URI> requestedUri = new AtomicReference<>();
		HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
		server.createContext("/nearest/v1/driving/", exchange -> {
			requestedUri.set(exchange.getRequestURI());
			respond(exchange, """
				{"code":"Ok","waypoints":[{"location":[77.21,28.614],"distance":8.5,"name":"Test Road"}]}
				""");
		});
		server.start();

		try {
			OsrmRoomCreatureRoadSnapper snapper =
				new OsrmRoomCreatureRoadSnapper(new OsrmRoutingService(
					"http://127.0.0.1:" + server.getAddress().getPort()
				));

			Optional<GeoPoint> result = snapper.snap(
				new GeoPoint(28.6139, 77.2090)
			);

			assertTrue(result.isPresent());
			assertEquals(new GeoPoint(28.614, 77.21), result.orElseThrow());
			assertEquals(
				"/nearest/v1/driving/77.209,28.6139",
				requestedUri.get().getPath()
			);
			assertEquals("number=1", requestedUri.get().getRawQuery());
		} finally {
			server.stop(0);
		}
	}

	private static void respond(HttpExchange exchange, String body)
		throws IOException {
		byte[] response = body.getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().add("Content-Type", "application/json");
		exchange.sendResponseHeaders(200, response.length);
		exchange.getResponseBody().write(response);
		exchange.close();
	}
}
