package com.routecatch.api.routing.valhalla;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.exception.TravelModeUnavailableException;
import com.routecatch.api.routing.NearestPointQuery;
import com.routecatch.api.routing.NearestPointResult;
import com.routecatch.api.routing.RouteQuery;
import com.routecatch.api.routing.RouteResult;
import com.routecatch.api.routing.RoutingCoordinate;
import com.routecatch.api.routing.TravelMode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

class ValhallaRoutingServiceTests {

	private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
	private static final RoutingCoordinate SOURCE = new RoutingCoordinate(
		28.6139,
		77.2090
	);
	private static final RoutingCoordinate DESTINATION = new RoutingCoordinate(
		28.6200,
		77.2150
	);
	private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(2);

	@Test
	void routePostsNativeValhallaContractForBothSupportedModes()
		throws Exception {
		for (TravelMode travelMode : List.of(
			TravelMode.MOTORCYCLE,
			TravelMode.WALKING
		)) {
			try (FixtureServer server = FixtureServer.responding(
				"/route",
				200,
				successfulRouteResponse(
					1.25,
					65.5,
					encodePoints(new double[][] {
						{0.0, 0.0},
						{0.0, 0.001}
					})
				)
			)) {
				ValhallaRoutingService service = service(server);

				service.route(routeQuery(travelMode));

				assertEquals("POST", server.requestMethod());
				assertEquals("/route", server.requestPath());
				JsonNode request = OBJECT_MAPPER.readTree(server.requestBody());
				assertEquals(2, request.path("locations").size());
				assertLocation(request.path("locations").get(0), SOURCE);
				assertLocation(request.path("locations").get(1), DESTINATION);
				assertEquals(
					costingFor(travelMode),
					request.path("costing").textValue()
				);
				assertEquals(
					"kilometers",
					request.path("units").textValue()
				);
				assertEquals(
					"none",
					request.path("directions_type").textValue()
				);
				assertEquals(4, request.size());
			}
		}
	}

	@Test
	void routeNormalizesMetricsGeometryAndRequestedEndpoints()
		throws Exception {
		String shape = encodePoints(new double[][] {
			{0.0, 0.0},
			{0.001, 0.001}
		});

		try (FixtureServer server = FixtureServer.responding(
			"/route",
			200,
			successfulRouteResponse(1.234, 54.75, shape)
		)) {
			RouteQuery query = routeQuery(TravelMode.MOTORCYCLE);

			RouteResult result = service(server).route(query);

			assertEquals(1234.0, result.distanceMeters(), 0.0);
			assertEquals(54.75, result.durationSeconds(), 0.0);
			assertSame(query.source(), result.source());
			assertSame(query.destination(), result.destination());
			assertEquals(
				List.of(
					new RoutingCoordinate(0.0, 0.0),
					new RoutingCoordinate(0.001, 0.001)
				),
				result.coordinates()
			);
		}
	}

	@Test
	void routeConcatenatesEveryLegAndRemovesOnlyExactBoundaryDuplicate()
		throws Exception {
		String firstLeg = encodePoints(new double[][] {
			{0.0, 0.0},
			{0.0, 0.001}
		});
		String duplicateBoundaryLeg = encodePoints(new double[][] {
			{0.0, 0.001},
			{0.0, 0.002}
		});
		String nonduplicateBoundaryLeg = encodePoints(new double[][] {
			{0.0, 0.002001},
			{0.0, 0.003}
		});

		try (FixtureServer server = FixtureServer.responding(
			"/route",
			200,
			successfulRouteResponse(
				0.3,
				30.0,
				firstLeg,
				duplicateBoundaryLeg,
				nonduplicateBoundaryLeg
			)
		)) {
			RouteResult result = service(server).route(
				routeQuery(TravelMode.WALKING)
			);

			assertEquals(
				List.of(
					new RoutingCoordinate(0.0, 0.0),
					new RoutingCoordinate(0.0, 0.001),
					new RoutingCoordinate(0.0, 0.002),
					new RoutingCoordinate(0.0, 0.002001),
					new RoutingCoordinate(0.0, 0.003)
				),
				result.coordinates()
			);
		}
	}

	@Test
	void routeRejectsMalformedMissingAndSemanticallyInvalidResponses()
		throws Exception {
		String validShape = encodePoints(new double[][] {
			{0.0, 0.0},
			{0.0, 0.001}
		});
		String invalidCoordinateShape = encodePoints(new double[][] {
			{91.0, 0.0}
		});
		List<String> invalidBodies = List.of(
			"{}",
			"{\"trip\":null}",
			"{\"trip\":{\"status\":1,\"units\":\"kilometers\",\"summary\":{\"length\":1,\"time\":1},\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"miles\",\"summary\":{\"length\":1,\"time\":1},\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":-1,\"time\":1},\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":1,\"time\":-1},\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":1e308,\"time\":1},\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":NaN,\"time\":1},\"legs\":[{\"shape\":\"" + validShape + "\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":1,\"time\":1},\"legs\":[]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":1,\"time\":1},\"legs\":[{\"shape\":\" \"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":1,\"time\":1},\"legs\":[{\"shape\":\"_izlhA\"}]}}",
			"{\"trip\":{\"status\":0,\"units\":\"kilometers\",\"summary\":{\"length\":1,\"time\":1},\"legs\":[{\"shape\":\"" + invalidCoordinateShape + "\"}]}}"
		);

		for (String invalidBody : invalidBodies) {
			assertRouteFailure(
				200,
				invalidBody,
				"ROUTING_ENGINE_INVALID_RESPONSE",
				HttpStatus.BAD_GATEWAY
			);
		}
	}

	@Test
	void routeMapsKnownNoPathErrorsButNotArbitraryBadRequests()
		throws Exception {
		for (int errorCode : List.of(170, 171, 441, 442)) {
			assertRouteFailure(
				400,
				valhallaError(errorCode, "internal provider detail"),
				"ROUTE_NOT_FOUND",
				HttpStatus.BAD_REQUEST
			);
		}

		RoutingEngineException unexpected = assertRouteFailure(
			400,
			valhallaError(100, "must not leak"),
			"ROUTING_ENGINE_ERROR",
			HttpStatus.BAD_GATEWAY
		);
		assertFalse(unexpected.getMessage().contains("must not leak"));
	}

	@Test
	void locatePostsNativeContractForBothSupportedModes() throws Exception {
		for (TravelMode travelMode : List.of(
			TravelMode.MOTORCYCLE,
			TravelMode.WALKING
		)) {
			try (FixtureServer server = FixtureServer.responding(
				"/locate",
				200,
				locateResponse("""
					{
						"correlated_lat": 28.614,
						"correlated_lon": 77.2091,
						"distance": 12.5
					}
					""")
			)) {
				service(server).findNearestPoint(
					new NearestPointQuery(travelMode, SOURCE)
				);

				assertEquals("POST", server.requestMethod());
				assertEquals("/locate", server.requestPath());
				JsonNode request = OBJECT_MAPPER.readTree(server.requestBody());
				assertEquals(1, request.path("locations").size());
				assertLocation(request.path("locations").get(0), SOURCE);
				assertEquals(
					costingFor(travelMode),
					request.path("costing").textValue()
				);
				assertTrue(request.path("verbose").booleanValue());
				assertEquals(3, request.size());
			}
		}
	}

	@Test
	void locateSelectsNearestUsableCandidateAndPreservesMeterDistance()
		throws Exception {
		try (FixtureServer server = FixtureServer.responding(
			"/locate",
			200,
			locateResponse(
				"""
				{
					"correlated_lat": 28.614,
					"correlated_lon": 77.2091,
					"distance": 18.75,
					"edge_info": {"names": ["Far Road"]}
				}
				""",
				"""
				{
					"correlated_lat": 28.61395,
					"correlated_lon": 77.20905,
					"distance": 7.25,
					"edge_info": {"names": ["", "  Nearest Road  "]}
				}
				"""
			)
		)) {
			NearestPointResult result = service(server).findNearestPoint(
				new NearestPointQuery(TravelMode.MOTORCYCLE, SOURCE)
			);

			assertEquals(
				new RoutingCoordinate(28.61395, 77.20905),
				result.snappedPoint()
			);
			assertEquals(7.25, result.distanceMeters(), 0.0);
			assertEquals("Nearest Road", result.name());
		}
	}

	@Test
	void locateDistanceTiesPreserveOriginalResponseOrder() throws Exception {
		try (FixtureServer server = FixtureServer.responding(
			"/locate",
			200,
			locateResponse(
				"""
				{
					"correlated_lat": 28.614,
					"correlated_lon": 77.2091,
					"distance": 5.0,
					"edge_info": {"names": ["First"]}
				}
				""",
				"""
				{
					"correlated_lat": 28.615,
					"correlated_lon": 77.2101,
					"distance": 5.0,
					"edge_info": {"names": ["Second"]}
				}
				"""
			)
		)) {
			NearestPointResult result = service(server).findNearestPoint(
				new NearestPointQuery(TravelMode.WALKING, SOURCE)
			);

			assertEquals("First", result.name());
			assertEquals(
				new RoutingCoordinate(28.614, 77.2091),
				result.snappedPoint()
			);
		}
	}

	@Test
	void locateSkipsInvalidCandidates() throws Exception {
		try (FixtureServer server = FixtureServer.responding(
			"/locate",
			200,
			locateResponse(
				"{\"correlated_lon\":77.2,\"distance\":1}",
				"{\"correlated_lat\":91,\"correlated_lon\":77.2,\"distance\":1}",
				"{\"correlated_lat\":28.6,\"correlated_lon\":77.2,\"distance\":-1}",
				"{\"correlated_lat\":28.6,\"correlated_lon\":77.2,\"distance\":\"NaN\"}",
				"{\"correlated_lat\":28.61,\"correlated_lon\":77.21,\"distance\":9,\"edge_info\":{\"names\":[\"Valid\"]}}"
			)
		)) {
			NearestPointResult result = service(server).findNearestPoint(
				new NearestPointQuery(TravelMode.MOTORCYCLE, SOURCE)
			);

			assertEquals("Valid", result.name());
			assertEquals(9.0, result.distanceMeters(), 0.0);
		}
	}

	@Test
	void locateWithNoUsableOrdinaryEdgeReturnsNearestPointNotFound()
		throws Exception {
		for (String response : List.of(
			locateResponse(
				"{\"correlated_lat\":91,\"correlated_lon\":77.2,\"distance\":1}",
				"{\"correlated_lat\":28.6,\"correlated_lon\":77.2,\"distance\":-1}"
			),
			"[{\"edges\":[]}]",
			"[{\"edges\":null}]"
		)) {
			assertLocateFailure(
				200,
				response,
				"NEAREST_POINT_NOT_FOUND",
				HttpStatus.BAD_GATEWAY
			);
		}
	}

	@Test
	void locateIgnoresFilteredEdgesEvenWhenTheyAreBetterOrSoleCandidates()
		throws Exception {
		String filteredEdge = """
			{
				"correlated_lat": 28.61391,
				"correlated_lon": 77.20901,
				"distance": 1,
				"edge_info": {"names": ["Filtered"]}
			}
			""";
		String ordinaryEdge = """
			{
				"correlated_lat": 28.614,
				"correlated_lon": 77.2091,
				"distance": 10,
				"edge_info": {"names": ["Ordinary"]}
			}
			""";

		try (FixtureServer server = FixtureServer.responding(
			"/locate",
			200,
			"[{\"edges\":[" + ordinaryEdge + "],\"filtered_edges\":[" +
				filteredEdge + "]}]"
		)) {
			NearestPointResult result = service(server).findNearestPoint(
				new NearestPointQuery(TravelMode.WALKING, SOURCE)
			);

			assertEquals("Ordinary", result.name());
			assertEquals(10.0, result.distanceMeters(), 0.0);
		}

		assertLocateFailure(
			200,
			"[{\"edges\":[],\"filtered_edges\":[" + filteredEdge + "]}]",
			"NEAREST_POINT_NOT_FOUND",
			HttpStatus.BAD_GATEWAY
		);
	}

	@Test
	void locateReturnsNullNameWhenNoNonblankRoadNameExists()
		throws Exception {
		for (String edgeInfo : List.of(
			"",
			",\"edge_info\":{}",
			",\"edge_info\":{\"names\":[null,\" \"]}"
		)) {
			String edge = "{\"correlated_lat\":28.614," +
				"\"correlated_lon\":77.2091," +
				"\"distance\":3" + edgeInfo + "}";

			try (FixtureServer server = FixtureServer.responding(
				"/locate",
				200,
				locateResponse(edge)
			)) {
				NearestPointResult result = service(server).findNearestPoint(
					new NearestPointQuery(TravelMode.MOTORCYCLE, SOURCE)
				);

				assertNull(result.name());
			}
		}
	}

	@Test
	void locateMapsProviderNoEdgeAndMalformedResponses() throws Exception {
		assertLocateFailure(
			400,
			valhallaError(171, "No suitable edges near location"),
			"NEAREST_POINT_NOT_FOUND",
			HttpStatus.BAD_GATEWAY
		);

		for (String malformedResponse : List.of(
			"{}",
			"[]",
			"[null]",
			"not-json"
		)) {
			assertLocateFailure(
				200,
				malformedResponse,
				"ROUTING_ENGINE_INVALID_RESPONSE",
				HttpStatus.BAD_GATEWAY
			);
		}
	}

	@Test
	void connectionRefusalIsNormalizedAsUnavailable() {
		ValhallaRoutingService service = new ValhallaRoutingService(
			"http://127.0.0.1:1",
			Duration.ofMillis(100),
			Duration.ofMillis(100)
		);

		RoutingEngineException failure = assertThrows(
			RoutingEngineException.class,
			() -> service.route(routeQuery(TravelMode.MOTORCYCLE))
		);

		assertFailure(
			failure,
			"ROUTING_ENGINE_UNAVAILABLE",
			HttpStatus.BAD_GATEWAY
		);
	}

	@Test
	void delayedResponsePastConfiguredReadTimeoutReturnsGatewayTimeout()
		throws Exception {
		try (FixtureServer server = FixtureServer.delayed(
			"/route",
			200,
			successfulRouteResponse(
				1.0,
				10.0,
				encodePoints(new double[][] {{0.0, 0.0}})
			),
			Duration.ofMillis(250)
		)) {
			ValhallaRoutingService service = new ValhallaRoutingService(
				server.baseUrl(),
				Duration.ofSeconds(1),
				Duration.ofMillis(20)
			);

			RoutingEngineException failure = assertThrows(
				RoutingEngineException.class,
				() -> service.route(routeQuery(TravelMode.WALKING))
			);

			assertFailure(
				failure,
				"ROUTING_ENGINE_TIMEOUT",
				HttpStatus.GATEWAY_TIMEOUT
			);
		}
	}

	@Test
	void malformedJsonAndUnexpectedProviderFailuresAreSafelyNormalized()
		throws Exception {
		assertRouteFailure(
			200,
			"not-json",
			"ROUTING_ENGINE_INVALID_RESPONSE",
			HttpStatus.BAD_GATEWAY
		);

		for (int status : List.of(404, 500)) {
			RoutingEngineException failure = assertRouteFailure(
				status,
				valhallaError(999, "private engine message"),
				"ROUTING_ENGINE_ERROR",
				HttpStatus.BAD_GATEWAY
			);
			assertFalse(failure.getMessage().contains("private engine message"));
		}
	}

	@Test
	void providerRejectsCarAndNullQueriesBeforeHttp() {
		ValhallaRoutingService service = new ValhallaRoutingService(
			"http://127.0.0.1:1",
			DEFAULT_TIMEOUT,
			DEFAULT_TIMEOUT
		);

		assertThrows(
			TravelModeUnavailableException.class,
			() -> service.route(routeQuery(TravelMode.CAR))
		);
		assertThrows(
			TravelModeUnavailableException.class,
			() -> service.findNearestPoint(
				new NearestPointQuery(TravelMode.CAR, SOURCE)
			)
		);
		assertThrows(IllegalArgumentException.class, () -> service.route(null));
		assertThrows(
			IllegalArgumentException.class,
			() -> service.findNearestPoint(null)
		);
	}

	@Test
	void invalidTimeoutsAreRejectedBeforeRequestFactoryConversion() {
		for (Duration invalidTimeout : List.of(
			Duration.ZERO,
			Duration.ofNanos(1),
			Duration.ofMillis(Integer.MAX_VALUE).plusMillis(1)
		)) {
			assertThrows(
				IllegalArgumentException.class,
				() -> new ValhallaRoutingService(
					"http://127.0.0.1:1",
					invalidTimeout,
					DEFAULT_TIMEOUT
				)
			);
			assertThrows(
				IllegalArgumentException.class,
				() -> new ValhallaRoutingService(
					"http://127.0.0.1:1",
					DEFAULT_TIMEOUT,
					invalidTimeout
				)
			);
		}

		assertThrows(
			IllegalArgumentException.class,
			() -> new ValhallaRoutingService(
				"http://127.0.0.1:1",
				null,
				DEFAULT_TIMEOUT
			)
		);
		assertThrows(
			IllegalArgumentException.class,
			() -> new ValhallaRoutingService(
				"http://127.0.0.1:1",
				DEFAULT_TIMEOUT,
				null
			)
		);
	}

	private ValhallaRoutingService service(FixtureServer server) {
		return new ValhallaRoutingService(
			server.baseUrl(),
			DEFAULT_TIMEOUT,
			DEFAULT_TIMEOUT
		);
	}

	private RouteQuery routeQuery(TravelMode travelMode) {
		return new RouteQuery(travelMode, SOURCE, DESTINATION);
	}

	private String costingFor(TravelMode travelMode) {
		return travelMode == TravelMode.MOTORCYCLE
			? "motorcycle"
			: "pedestrian";
	}

	private void assertLocation(JsonNode location, RoutingCoordinate expected) {
		assertEquals(expected.latitude(), location.path("lat").doubleValue(), 0.0);
		assertEquals(expected.longitude(), location.path("lon").doubleValue(), 0.0);
		assertEquals(2, location.size());
	}

	private RoutingEngineException assertRouteFailure(
		int responseStatus,
		String responseBody,
		String expectedCode,
		HttpStatus expectedStatus
	) throws Exception {
		try (FixtureServer server = FixtureServer.responding(
			"/route",
			responseStatus,
			responseBody
		)) {
			RoutingEngineException failure = assertThrows(
				RoutingEngineException.class,
				() -> service(server).route(
					routeQuery(TravelMode.MOTORCYCLE)
				)
			);

			assertFailure(failure, expectedCode, expectedStatus);
			return failure;
		}
	}

	private RoutingEngineException assertLocateFailure(
		int responseStatus,
		String responseBody,
		String expectedCode,
		HttpStatus expectedStatus
	) throws Exception {
		try (FixtureServer server = FixtureServer.responding(
			"/locate",
			responseStatus,
			responseBody
		)) {
			RoutingEngineException failure = assertThrows(
				RoutingEngineException.class,
				() -> service(server).findNearestPoint(
					new NearestPointQuery(TravelMode.WALKING, SOURCE)
				)
			);

			assertFailure(failure, expectedCode, expectedStatus);
			return failure;
		}
	}

	private void assertFailure(
		RoutingEngineException failure,
		String expectedCode,
		HttpStatus expectedStatus
	) {
		assertEquals(expectedCode, failure.getErrorCode());
		assertEquals(expectedStatus, failure.getStatus());
	}

	private static String successfulRouteResponse(
		double lengthKilometers,
		double durationSeconds,
		String... shapes
	) throws IOException {
		ObjectNode root = OBJECT_MAPPER.createObjectNode();
		ObjectNode trip = root.putObject("trip");
		trip.put("status", 0);
		trip.put("units", "kilometers");
		ObjectNode summary = trip.putObject("summary");
		summary.put("length", lengthKilometers);
		summary.put("time", durationSeconds);
		ArrayNode legs = trip.putArray("legs");

		for (String shape : shapes) {
			legs.addObject().put("shape", shape);
		}

		return OBJECT_MAPPER.writeValueAsString(root);
	}

	private static String locateResponse(String... edges) {
		return "[{\"edges\":[" + String.join(",", edges) + "]}]";
	}

	private static String valhallaError(int errorCode, String detail) {
		return "{\"error_code\":" + errorCode +
			",\"error\":\"" + detail +
			"\",\"status_code\":400,\"status\":\"Bad Request\"}";
	}

	private static String encodePoints(double[][] coordinates) {
		StringBuilder encoded = new StringBuilder();
		long previousLatitude = 0L;
		long previousLongitude = 0L;

		for (double[] coordinate : coordinates) {
			long latitude = Math.round(coordinate[0] * 1_000_000.0);
			long longitude = Math.round(coordinate[1] * 1_000_000.0);
			encodeValue(encoded, latitude - previousLatitude);
			encodeValue(encoded, longitude - previousLongitude);
			previousLatitude = latitude;
			previousLongitude = longitude;
		}

		return encoded.toString();
	}

	private static void encodeValue(StringBuilder encoded, long value) {
		long encodedValue = value < 0
			? ~(value << 1)
			: value << 1;

		while (encodedValue >= 0x20) {
			encoded.append((char) ((0x20 | (encodedValue & 0x1f)) + 63));
			encodedValue >>= 5;
		}

		encoded.append((char) (encodedValue + 63));
	}

	private static final class FixtureServer implements AutoCloseable {

		private final HttpServer server;
		private final AtomicInteger requests = new AtomicInteger();
		private volatile String requestMethod;
		private volatile String requestPath;
		private volatile String requestBody;

		private FixtureServer(
			String path,
			int responseStatus,
			String responseBody,
			Duration responseDelay
		) throws IOException {
			server = HttpServer.create(new InetSocketAddress(0), 0);
			server.createContext(path, exchange -> handle(
				exchange,
				responseStatus,
				responseBody,
				responseDelay
			));
			server.start();
		}

		static FixtureServer responding(
			String path,
			int responseStatus,
			String responseBody
		) throws IOException {
			return new FixtureServer(
				path,
				responseStatus,
				responseBody,
				Duration.ZERO
			);
		}

		static FixtureServer delayed(
			String path,
			int responseStatus,
			String responseBody,
			Duration responseDelay
		) throws IOException {
			return new FixtureServer(
				path,
				responseStatus,
				responseBody,
				responseDelay
			);
		}

		String baseUrl() {
			return "http://127.0.0.1:" + server.getAddress().getPort();
		}

		String requestMethod() {
			return requestMethod;
		}

		String requestPath() {
			return requestPath;
		}

		String requestBody() {
			return requestBody;
		}

		private void handle(
			HttpExchange exchange,
			int responseStatus,
			String responseBody,
			Duration responseDelay
		) throws IOException {
			requests.incrementAndGet();
			requestMethod = exchange.getRequestMethod();
			requestPath = exchange.getRequestURI().getPath();
			requestBody = new String(
				exchange.getRequestBody().readAllBytes(),
				StandardCharsets.UTF_8
			);

			byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().add(
				"Content-Type",
				"application/json"
			);
			exchange.sendResponseHeaders(responseStatus, body.length);

			if (!responseDelay.isZero()) {
				try {
					Thread.sleep(responseDelay);
				} catch (InterruptedException exception) {
					Thread.currentThread().interrupt();
				}
			}

			exchange.getResponseBody().write(body);
			exchange.close();
		}

		@Override
		public void close() {
			server.stop(0);
		}
	}
}
