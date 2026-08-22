package com.routecatch.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

@SpringBootTest
@AutoConfigureMockMvc
class RoutingTravelModeApiTests {

	private static final AtomicInteger ROUTE_REQUESTS = new AtomicInteger();
	private static final AtomicInteger NEAREST_REQUESTS = new AtomicInteger();
	private static final AtomicReference<URI> LAST_ROUTE_URI =
		new AtomicReference<>();
	private static final AtomicReference<URI> LAST_NEAREST_URI =
		new AtomicReference<>();
	private static final AtomicInteger VALHALLA_ROUTE_REQUESTS =
		new AtomicInteger();
	private static final AtomicInteger VALHALLA_LOCATE_REQUESTS =
		new AtomicInteger();
	private static final AtomicReference<String> LAST_VALHALLA_ROUTE_BODY =
		new AtomicReference<>();
	private static final AtomicReference<String> LAST_VALHALLA_LOCATE_BODY =
		new AtomicReference<>();
	private static final HttpServer OSRM_SERVER = startOsrmServer();
	private static final HttpServer VALHALLA_SERVER = startValhallaServer();

	@Autowired
	private MockMvc mockMvc;

	@DynamicPropertySource
	static void configureRoutingProviders(DynamicPropertyRegistry registry) {
		registry.add(
			"osrm.base-url",
			() -> "http://127.0.0.1:" + OSRM_SERVER.getAddress().getPort()
		);
		registry.add(
			"valhalla.base-url",
			() -> "http://127.0.0.1:" +
				VALHALLA_SERVER.getAddress().getPort()
		);
	}

	@BeforeEach
	void resetRequests() {
		ROUTE_REQUESTS.set(0);
		NEAREST_REQUESTS.set(0);
		LAST_ROUTE_URI.set(null);
		LAST_NEAREST_URI.set(null);
		VALHALLA_ROUTE_REQUESTS.set(0);
		VALHALLA_LOCATE_REQUESTS.set(0);
		LAST_VALHALLA_ROUTE_BODY.set(null);
		LAST_VALHALLA_LOCATE_BODY.set(null);
	}

	@AfterAll
	static void stopRoutingProviderServers() {
		OSRM_SERVER.stop(0);
		VALHALLA_SERVER.stop(0);
	}

	@Test
	void legacyRouteWithoutTravelModeUsesOsrmDriving() throws Exception {
		assertSuccessfulRoute(routeRequest(""), 123.4);
		assertEquals(1, ROUTE_REQUESTS.get());
		assertOsrmDrivingRouteRequested();
	}

	@Test
	void explicitCarRouteUsesTheSameOsrmBehavior() throws Exception {
		assertSuccessfulRoute(
			routeRequest(", \"travelMode\": \"CAR\""),
			123.4
		);
		assertEquals(1, ROUTE_REQUESTS.get());
		assertOsrmDrivingRouteRequested();
	}

	@Test
	void nullTravelModeUsesLegacyCarBehavior() throws Exception {
		assertSuccessfulRoute(routeRequest(", \"travelMode\": null"), 123.4);
		assertEquals(1, ROUTE_REQUESTS.get());
		assertOsrmDrivingRouteRequested();
	}

	@Test
	void invalidRouteTravelModeReturnsSemanticBadRequest() throws Exception {
		mockMvc.perform(post("/api/routes")
				.contentType(MediaType.APPLICATION_JSON)
				.content(routeRequest(", \"travelMode\": \"walking\"")))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value(
				"UNSUPPORTED_TRAVEL_MODE"
			))
			.andExpect(jsonPath("$.path").value("/api/routes"));

		assertEquals(0, ROUTE_REQUESTS.get());
		assertEquals(0, VALHALLA_ROUTE_REQUESTS.get());
	}

	@Test
	void motorcycleRouteUsesValhallaMotorcycleWithoutOsrmFallback()
		throws Exception {
		assertSuccessfulValhallaRoute("MOTORCYCLE", "motorcycle");
	}

	@Test
	void walkingRouteUsesValhallaPedestrianWithoutOsrmFallback()
		throws Exception {
		assertSuccessfulValhallaRoute("WALKING", "pedestrian");
	}

	@Test
	void legacyNearestWithoutTravelModeUsesOsrmDriving() throws Exception {
		assertSuccessfulNearest(nearestRequest(""));
		assertEquals(1, NEAREST_REQUESTS.get());
		assertOsrmDrivingNearestRequested();
	}

	@Test
	void explicitCarNearestUsesOsrmDriving() throws Exception {
		assertSuccessfulNearest(nearestRequest(", \"travelMode\": \"CAR\""));
		assertEquals(1, NEAREST_REQUESTS.get());
		assertOsrmDrivingNearestRequested();
	}

	@Test
	void nullNearestTravelModeUsesLegacyCarBehavior() throws Exception {
		assertSuccessfulNearest(nearestRequest(", \"travelMode\": null"));
		assertEquals(1, NEAREST_REQUESTS.get());
		assertOsrmDrivingNearestRequested();
	}

	@Test
	void invalidNearestTravelModeReturnsSemanticBadRequest() throws Exception {
		mockMvc.perform(post("/api/nearest")
				.contentType(MediaType.APPLICATION_JSON)
				.content(nearestRequest(", \"travelMode\": \"bike\"")))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value(
				"UNSUPPORTED_TRAVEL_MODE"
			))
			.andExpect(jsonPath("$.path").value("/api/nearest"));

		assertEquals(0, NEAREST_REQUESTS.get());
		assertEquals(0, VALHALLA_LOCATE_REQUESTS.get());
	}

	@Test
	void nonCarNearestUsesValhallaWithoutOsrmFallback() throws Exception {
		for (String[] modeAndCosting : new String[][] {
			{"MOTORCYCLE", "motorcycle"},
			{"WALKING", "pedestrian"}
		}) {
			resetRequests();
			assertSuccessfulNearest(nearestRequest(
				", \"travelMode\": \"" + modeAndCosting[0] + "\""
			));

			assertEquals(0, NEAREST_REQUESTS.get());
			assertEquals(1, VALHALLA_LOCATE_REQUESTS.get());
			assertValhallaCosting(
				LAST_VALHALLA_LOCATE_BODY.get(),
				modeAndCosting[1]
			);
		}
	}

	private void assertSuccessfulRoute(
		String content,
		double expectedDistanceMeters
	) throws Exception {
		mockMvc.perform(post("/api/routes")
				.contentType(MediaType.APPLICATION_JSON)
				.content(content))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.coordinates.length()").value(2))
			.andExpect(jsonPath("$.distanceMeters").value(
				expectedDistanceMeters
			))
			.andExpect(jsonPath("$.durationSeconds").value(12.5))
			.andExpect(jsonPath("$.source.lat").value(28.6139))
			.andExpect(jsonPath("$.destination.lon").value(77.2150))
			.andExpect(jsonPath("$.travelMode").doesNotExist());
	}

	private void assertSuccessfulValhallaRoute(
		String travelMode,
		String expectedCosting
	) throws Exception {
		assertSuccessfulRoute(
			routeRequest(", \"travelMode\": \"" + travelMode + "\""),
			125.0
		);
		assertEquals(0, ROUTE_REQUESTS.get());
		assertEquals(1, VALHALLA_ROUTE_REQUESTS.get());
		assertValhallaCosting(
			LAST_VALHALLA_ROUTE_BODY.get(),
			expectedCosting
		);
	}

	private void assertValhallaCosting(String body, String expectedCosting) {
		assertNotNull(body);
		assertTrue(body.contains(
			"\"costing\":\"" + expectedCosting + "\""
		));
	}

	private void assertSuccessfulNearest(String content) throws Exception {
		mockMvc.perform(post("/api/nearest")
				.contentType(MediaType.APPLICATION_JSON)
				.content(content))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.snappedPoint.lat").value(28.6140))
			.andExpect(jsonPath("$.snappedPoint.lon").value(77.2100))
			.andExpect(jsonPath("$.distanceMeters").value(8.5))
			.andExpect(jsonPath("$.name").value("Test Road"));
	}

	private void assertOsrmDrivingRouteRequested() {
		URI uri = LAST_ROUTE_URI.get();
		assertNotNull(uri);
		assertEquals(
			"/route/v1/driving/77.209,28.6139;77.215,28.62",
			uri.getPath()
		);
		assertEquals(
			"overview=full&geometries=geojson&steps=false",
			uri.getRawQuery()
		);
	}

	private void assertOsrmDrivingNearestRequested() {
		URI uri = LAST_NEAREST_URI.get();
		assertNotNull(uri);
		assertEquals(
			"/nearest/v1/driving/77.209,28.6139",
			uri.getPath()
		);
		assertEquals("number=1", uri.getRawQuery());
	}

	private static String routeRequest(String optionalTravelMode) {
		return """
			{
				"sourceLat": 28.6139,
				"sourceLon": 77.2090,
				"destinationLat": 28.6200,
				"destinationLon": 77.2150%s
			}
			""".formatted(optionalTravelMode);
	}

	private static String nearestRequest(String optionalTravelMode) {
		return """
			{
				"lat": 28.6139,
				"lon": 77.2090%s
			}
			""".formatted(optionalTravelMode);
	}

	private static HttpServer startOsrmServer() {
		try {
			HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
			server.createContext("/route/v1/driving/", exchange -> {
				ROUTE_REQUESTS.incrementAndGet();
				LAST_ROUTE_URI.set(exchange.getRequestURI());
				respond(exchange, """
					{"code":"Ok","routes":[{"geometry":{"coordinates":[[77.209,28.6139],[77.215,28.62]]},"distance":123.4,"duration":12.5}]}
					""");
			});
			server.createContext("/nearest/v1/driving/", exchange -> {
				NEAREST_REQUESTS.incrementAndGet();
				LAST_NEAREST_URI.set(exchange.getRequestURI());
				respond(exchange, """
					{"code":"Ok","waypoints":[{"location":[77.21,28.614],"distance":8.5,"name":"Test Road"}]}
					""");
			});
			server.start();
			return server;
		} catch (IOException exception) {
			throw new ExceptionInInitializerError(exception);
		}
	}

	private static HttpServer startValhallaServer() {
		try {
			HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
			server.createContext("/route", exchange -> {
				VALHALLA_ROUTE_REQUESTS.incrementAndGet();
				LAST_VALHALLA_ROUTE_BODY.set(readRequestBody(exchange));
				respond(exchange, """
					{"trip":{"status":0,"units":"kilometers","summary":{"length":0.125,"time":12.5},"legs":[{"shape":"???o}@"}]}}
					""");
			});
			server.createContext("/locate", exchange -> {
				VALHALLA_LOCATE_REQUESTS.incrementAndGet();
				LAST_VALHALLA_LOCATE_BODY.set(readRequestBody(exchange));
				respond(exchange, """
					[{"edges":[{"correlated_lat":28.614,"correlated_lon":77.21,"distance":8.5,"edge_info":{"names":["Test Road"]}}]}]
					""");
			});
			server.start();
			return server;
		} catch (IOException exception) {
			throw new ExceptionInInitializerError(exception);
		}
	}

	private static String readRequestBody(HttpExchange exchange)
		throws IOException {
		return new String(
			exchange.getRequestBody().readAllBytes(),
			StandardCharsets.UTF_8
		);
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
