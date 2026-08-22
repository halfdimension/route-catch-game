package com.routecatch.api.service;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.ResourceAccessException;

import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.exception.TravelModeUnavailableException;
import com.routecatch.api.routing.NearestPointQuery;
import com.routecatch.api.routing.NearestPointResult;
import com.routecatch.api.routing.RouteQuery;
import com.routecatch.api.routing.RouteResult;
import com.routecatch.api.routing.RoutingCoordinate;
import com.routecatch.api.routing.TravelMode;
import com.routecatch.api.routing.TravelRoutingProvider;

@Service
public class OsrmRoutingService implements TravelRoutingProvider {

	private static final Pattern OSRM_CODE_PATTERN =
		Pattern.compile("\"code\"\\s*:\\s*\"([^\"]+)\"");
	private static final Pattern OSRM_MESSAGE_PATTERN =
		Pattern.compile("\"message\"\\s*:\\s*\"([^\"]+)\"");

	private final RestClient restClient;

	public OsrmRoutingService(@Value("${osrm.base-url}") String osrmBaseUrl) {
		this.restClient = RestClient.builder()
			.baseUrl(osrmBaseUrl)
			.build();
	}

	@Override
	public RouteResult route(RouteQuery query) {
		if (query.travelMode() != TravelMode.CAR) {
			throw new TravelModeUnavailableException(query.travelMode());
		}

		return findDrivingRoute(query.source(), query.destination());
	}

	public RouteResult findDrivingRoute(
		RoutingCoordinate source,
		RoutingCoordinate destination
	) {
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
					.queryParam("geometries", "geojson")
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
			throw routingEngineError();
		}

		if (!"Ok".equals(osrmResponse.code())) {
			throw routeStatusException(osrmResponse.code(), osrmResponse.message());
		}

		if (osrmResponse.routes() == null || osrmResponse.routes().isEmpty()) {
			throw new RoutingEngineException(
				"ROUTE_NOT_FOUND",
				"Routing engine did not return a route",
				HttpStatus.BAD_REQUEST
			);
		}

		OsrmRoute route = osrmResponse.routes().getFirst();

		if (route.geometry() == null || route.geometry().coordinates() == null) {
			throw new RoutingEngineException(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				"Routing engine returned an invalid route"
			);
		}

		List<RoutingCoordinate> coordinates = route.geometry().coordinates().stream()
			.map(coordinate -> new RoutingCoordinate(
				coordinate.get(1),
				coordinate.get(0)
			))
			.toList();

		return new RouteResult(
			coordinates,
			route.distance(),
			route.duration(),
			source,
			destination
		);
	}

	@Override
	public NearestPointResult findNearestPoint(NearestPointQuery query) {
		if (query.travelMode() != TravelMode.CAR) {
			throw new TravelModeUnavailableException(query.travelMode());
		}

		return findNearestDrivingPoint(query.point());
	}

	public NearestPointResult findNearestDrivingPoint(
		RoutingCoordinate coordinate
	) {
		String point = "%s,%s".formatted(
			coordinate.longitude(),
			coordinate.latitude()
		);

		OsrmNearestResponse osrmResponse;

		try {
			osrmResponse = restClient.get()
				.uri(uriBuilder -> uriBuilder
					.path("/nearest/v1/driving/{point}")
					.queryParam("number", 1)
					.build(point))
				.retrieve()
				.body(OsrmNearestResponse.class);
		} catch (ResourceAccessException exception) {
			throw routingEngineUnavailable();
		} catch (RestClientResponseException exception) {
			throw routingEngineError(exception);
		} catch (RestClientException exception) {
			throw routingEngineError();
		}

		if (osrmResponse == null) {
			throw routingEngineError();
		}

		if (!"Ok".equals(osrmResponse.code())) {
			throw routeStatusException(osrmResponse.code(), osrmResponse.message());
		}

		if (osrmResponse.waypoints() == null || osrmResponse.waypoints().isEmpty()) {
			throw new RoutingEngineException(
				"NEAREST_POINT_NOT_FOUND",
				"Routing engine did not return a nearest point"
			);
		}

		OsrmWaypoint waypoint = osrmResponse.waypoints().getFirst();

		if (waypoint.location() == null || waypoint.location().size() < 2) {
			throw new RoutingEngineException(
				"ROUTING_ENGINE_INVALID_RESPONSE",
				"Routing engine returned an invalid nearest point"
			);
		}

		return new NearestPointResult(
			new RoutingCoordinate(
				waypoint.location().get(1),
				waypoint.location().get(0)
			),
			waypoint.distance(),
			waypoint.name()
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

		if (errorResponse != null) {
			return routeStatusException(
				errorResponse.code(),
				errorResponse.message(),
				exception.getStatusCode().value()
			);
		}

		return new RoutingEngineException(
			"ROUTING_ENGINE_ERROR",
			"Routing engine returned an unsuccessful response"
		);
	}

	private RoutingEngineException routeStatusException(
		String code,
		String message
	) {
		return routeStatusException(code, message, null);
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
		OsrmGeometry geometry,
		double distance,
		double duration
	) {
	}

	private record OsrmGeometry(
		List<List<Double>> coordinates
	) {
	}

	private record OsrmNearestResponse(
		String code,
		String message,
		List<OsrmWaypoint> waypoints
	) {
	}

	private record OsrmErrorResponse(
		String code,
		String message
	) {
	}

	private record OsrmWaypoint(
		List<Double> location,
		double distance,
		String name
	) {
	}
}
