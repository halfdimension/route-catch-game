package com.routecatch.api.multiplayer.room.movement.routing;

import java.time.Duration;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.ResourceAccessException;

import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;

@Component
public class OsrmMovementRouteClient implements MovementRouteClient {

	private static final Pattern OSRM_CODE_PATTERN =
		Pattern.compile("\"code\"\\s*:\\s*\"([^\"]+)\"");
	private static final Pattern OSRM_MESSAGE_PATTERN =
		Pattern.compile("\"message\"\\s*:\\s*\"([^\"]+)\"");
	private static final Duration DEFAULT_CONNECT_TIMEOUT = Duration.ofSeconds(
		2
	);
	private static final Duration DEFAULT_READ_TIMEOUT = Duration.ofSeconds(10);
	private static final Duration MINIMUM_TIMEOUT = Duration.ofMillis(1);
	private static final Duration MAXIMUM_TIMEOUT = Duration.ofMillis(
		Integer.MAX_VALUE
	);

	private final RestClient restClient;

	@Autowired
	public OsrmMovementRouteClient(
		@Value("${osrm.base-url:http://localhost:5000}") String osrmBaseUrl,
		@Value(
			"${multiplayer.movement.osrm.connect-timeout:2s}"
		) Duration connectTimeout,
		@Value(
			"${multiplayer.movement.osrm.read-timeout:10s}"
		) Duration readTimeout
	) {
		Duration boundedConnectTimeout = requireBoundedTimeout(
			"multiplayer.movement.osrm.connect-timeout",
			connectTimeout
		);
		Duration boundedReadTimeout = requireBoundedTimeout(
			"multiplayer.movement.osrm.read-timeout",
			readTimeout
		);
		SimpleClientHttpRequestFactory requestFactory =
			new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout(boundedConnectTimeout);
		requestFactory.setReadTimeout(boundedReadTimeout);
		this.restClient = RestClient.builder()
			.baseUrl(osrmBaseUrl)
			.requestFactory(requestFactory)
			.build();
	}

	public OsrmMovementRouteClient(String osrmBaseUrl) {
		this(osrmBaseUrl, DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT);
	}

	@Override
	public MovementRoute fetchRoute(
		MovementCoordinate source,
		MovementCoordinate destination
	) {
		if (source == null || destination == null) {
			throw new IllegalArgumentException(
				"Movement route source and destination are required"
			);
		}

		String routeCoordinates = "%s,%s;%s,%s".formatted(
			source.longitude(),
			source.latitude(),
			destination.longitude(),
			destination.latitude()
		);
		OsrmRouteResponse osrmResponse;

		try {
			osrmResponse = restClient.get()
				.uri(uriBuilder -> uriBuilder
					.path("/route/v1/driving/{coordinates}")
					.queryParam("overview", "full")
					.queryParam("geometries", "polyline6")
					.queryParam("steps", "false")
					.build(routeCoordinates))
				.retrieve()
				.body(OsrmRouteResponse.class);
		} catch (ResourceAccessException exception) {
			throw routingEngineUnavailable();
		} catch (RestClientResponseException exception) {
			throw routingEngineError(exception);
		} catch (RestClientException exception) {
			throw routingEngineError();
		}

		if (osrmResponse == null) {
			throw invalidResponse("Routing engine returned an empty response");
		}

		if (osrmResponse.code() == null || osrmResponse.code().isBlank()) {
			throw invalidResponse("Routing engine response did not include a status");
		}

		if (!"Ok".equals(osrmResponse.code())) {
			throw routeStatusException(osrmResponse.code(), osrmResponse.message(), null);
		}

		if (osrmResponse.routes() == null || osrmResponse.routes().isEmpty()) {
			throw new RoutingEngineException(
				"ROUTE_NOT_FOUND",
				"Routing engine did not return a route",
				HttpStatus.BAD_REQUEST
			);
		}

		OsrmRoute route = osrmResponse.routes().getFirst();

		if (route == null) {
			throw invalidResponse("Routing engine returned an invalid route");
		}

		String encodedPolyline6 = route.geometry();

		if (encodedPolyline6 == null || encodedPolyline6.isBlank()) {
			throw invalidResponse(
				"Routing engine route did not include encoded polyline6 geometry"
			);
		}

		try {
			if (Polyline6Codec.decode(encodedPolyline6).isEmpty()) {
				throw invalidResponse("Routing engine route geometry was empty");
			}
		} catch (IllegalArgumentException exception) {
			throw invalidResponse("Routing engine returned malformed route geometry");
		}

		if (!isValidMetric(route.distance())) {
			throw invalidResponse("Routing engine returned an invalid route distance");
		}

		if (!isValidMetric(route.duration())) {
			throw invalidResponse("Routing engine returned an invalid route duration");
		}

		return new MovementRoute(
			encodedPolyline6,
			route.distance(),
			route.duration()
		);
	}

	private boolean isValidMetric(Double value) {
		return value != null && Double.isFinite(value) && value >= 0.0;
	}

	private static Duration requireBoundedTimeout(
		String propertyName,
		Duration timeout
	) {
		if (
			timeout == null ||
			timeout.compareTo(MINIMUM_TIMEOUT) < 0 ||
			timeout.compareTo(MAXIMUM_TIMEOUT) > 0
		) {
			throw new IllegalArgumentException(
				propertyName + " must be between 1ms and " +
				MAXIMUM_TIMEOUT.toMillis() + "ms"
			);
		}

		return timeout;
	}

	private RoutingEngineException invalidResponse(String message) {
		return new RoutingEngineException(
			"ROUTING_ENGINE_INVALID_RESPONSE",
			message
		);
	}

	private RoutingEngineException routingEngineUnavailable() {
		return new RoutingEngineException(
			"ROUTING_ENGINE_UNAVAILABLE",
			"Routing engine is not reachable"
		);
	}

	private RoutingEngineException routingEngineError() {
		return new RoutingEngineException(
			"ROUTING_ENGINE_ERROR",
			"Routing engine returned an unsuccessful response"
		);
	}

	private RoutingEngineException routingEngineError(
		RestClientResponseException exception
	) {
		OsrmErrorResponse errorResponse = parseOsrmError(exception);
		int responseStatus = exception.getStatusCode().value();

		if (errorResponse != null || responseStatus == 400) {
			return routeStatusException(
				errorResponse == null ? null : errorResponse.code(),
				errorResponse == null ? null : errorResponse.message(),
				responseStatus
			);
		}

		return routingEngineError();
	}

	private RoutingEngineException routeStatusException(
		String code,
		String message,
		Integer responseStatus
	) {
		String safeCode = code == null || code.isBlank()
			? "ROUTE_UNAVAILABLE"
			: code;
		String safeMessage = message == null || message.isBlank()
			? "Routing engine could not find a route"
			: message;

		if (
			"NoRoute".equals(safeCode) ||
			"NoSegment".equals(safeCode) ||
			Integer.valueOf(400).equals(responseStatus)
		) {
			return new RoutingEngineException(
				safeCode,
				safeMessage,
				HttpStatus.BAD_REQUEST
			);
		}

		return new RoutingEngineException(
			"ROUTING_ENGINE_ERROR",
			safeMessage
		);
	}

	private OsrmErrorResponse parseOsrmError(
		RestClientResponseException exception
	) {
		String responseBody = exception.getResponseBodyAsString();

		if (responseBody == null || responseBody.isBlank()) {
			return null;
		}

		String code = extractJsonString(responseBody, OSRM_CODE_PATTERN);
		String message = extractJsonString(responseBody, OSRM_MESSAGE_PATTERN);

		if (code == null && message == null) {
			return null;
		}

		return new OsrmErrorResponse(code, message);
	}

	private String extractJsonString(String responseBody, Pattern pattern) {
		Matcher matcher = pattern.matcher(responseBody);

		if (!matcher.find()) {
			return null;
		}

		return matcher.group(1);
	}

	private record OsrmRouteResponse(
		String code,
		String message,
		List<OsrmRoute> routes
	) {
	}

	private record OsrmRoute(
		String geometry,
		Double distance,
		Double duration
	) {
	}

	private record OsrmErrorResponse(String code, String message) {
	}
}
