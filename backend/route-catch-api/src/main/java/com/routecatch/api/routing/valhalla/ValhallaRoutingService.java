package com.routecatch.api.routing.valhalla;

import java.net.SocketTimeoutException;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.exception.TravelModeUnavailableException;
import com.routecatch.api.routing.NearestPointQuery;
import com.routecatch.api.routing.NearestPointResult;
import com.routecatch.api.routing.Polyline6Decoder;
import com.routecatch.api.routing.RouteQuery;
import com.routecatch.api.routing.RouteResult;
import com.routecatch.api.routing.RoutingCoordinate;
import com.routecatch.api.routing.TravelMode;
import com.routecatch.api.routing.TravelRoutingProvider;

@Service
public class ValhallaRoutingService implements TravelRoutingProvider {

	private static final String KILOMETERS = "kilometers";
	private static final String NO_DIRECTIONS = "none";
	private static final Set<Integer> NO_ROUTE_ERROR_CODES = Set.of(
		170,
		171,
		441,
		442
	);
	private static final int NO_SUITABLE_EDGES_ERROR_CODE = 171;
	private static final Duration MINIMUM_TIMEOUT = Duration.ofMillis(1);
	private static final Duration MAXIMUM_TIMEOUT = Duration.ofMillis(
		Integer.MAX_VALUE
	);

	private final RestClient restClient;

	@Autowired
	public ValhallaRoutingService(
		@Value("${valhalla.base-url:http://localhost:8002}")
		String valhallaBaseUrl,
		@Value("${valhalla.connect-timeout:2s}")
		Duration connectTimeout,
		@Value("${valhalla.read-timeout:10s}")
		Duration readTimeout
	) {
		Duration boundedConnectTimeout = requireBoundedTimeout(
			"valhalla.connect-timeout",
			connectTimeout
		);
		Duration boundedReadTimeout = requireBoundedTimeout(
			"valhalla.read-timeout",
			readTimeout
		);
		SimpleClientHttpRequestFactory requestFactory =
			new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout(boundedConnectTimeout);
		requestFactory.setReadTimeout(boundedReadTimeout);
		this.restClient = RestClient.builder()
			.baseUrl(valhallaBaseUrl)
			.requestFactory(requestFactory)
			.build();
	}

	@Override
	public RouteResult route(RouteQuery query) {
		if (query == null) {
			throw new IllegalArgumentException("Route query is required");
		}

		String costing = costingFor(query.travelMode());
		ValhallaRouteRequest request = new ValhallaRouteRequest(
			List.of(
				toLocation(query.source()),
				toLocation(query.destination())
			),
			costing,
			KILOMETERS,
			NO_DIRECTIONS
		);
		ValhallaRouteResponse response;

		try {
			response = restClient.post()
				.uri("/route")
				.contentType(MediaType.APPLICATION_JSON)
				.body(request)
				.retrieve()
				.body(ValhallaRouteResponse.class);
		} catch (ResourceAccessException exception) {
			throw resourceAccessFailure(exception);
		} catch (RestClientResponseException exception) {
			throw providerResponseFailure(exception, Operation.ROUTE);
		} catch (RestClientException exception) {
			if (isTimeout(exception)) {
				throw routingEngineTimeout();
			}

			throw invalidResponse();
		}

		return normalizeRoute(response, query);
	}

	@Override
	public NearestPointResult findNearestPoint(NearestPointQuery query) {
		if (query == null) {
			throw new IllegalArgumentException("Nearest-point query is required");
		}

		String costing = costingFor(query.travelMode());
		ValhallaLocateRequest request = new ValhallaLocateRequest(
			List.of(toLocation(query.point())),
			costing,
			true
		);
		ValhallaLocateLocation[] response;

		try {
			response = restClient.post()
				.uri("/locate")
				.contentType(MediaType.APPLICATION_JSON)
				.body(request)
				.retrieve()
				.body(ValhallaLocateLocation[].class);
		} catch (ResourceAccessException exception) {
			throw resourceAccessFailure(exception);
		} catch (RestClientResponseException exception) {
			throw providerResponseFailure(exception, Operation.LOCATE);
		} catch (RestClientException exception) {
			if (isTimeout(exception)) {
				throw routingEngineTimeout();
			}

			throw invalidResponse();
		}

		return normalizeNearestPoint(response);
	}

	private RouteResult normalizeRoute(
		ValhallaRouteResponse response,
		RouteQuery query
	) {
		if (response == null || response.trip() == null) {
			throw invalidResponse();
		}

		ValhallaTrip trip = response.trip();

		if (trip.status() == null || trip.status() != 0) {
			throw invalidResponse();
		}

		if (!KILOMETERS.equals(trip.units())) {
			throw invalidResponse();
		}

		if (trip.summary() == null) {
			throw invalidResponse();
		}

		Double lengthKilometers = trip.summary().length();
		Double durationSeconds = trip.summary().time();

		if (!isValidMetric(lengthKilometers)) {
			throw invalidResponse();
		}

		if (!isValidMetric(durationSeconds)) {
			throw invalidResponse();
		}

		double distanceMeters = lengthKilometers * 1000.0;

		if (!isValidMetric(distanceMeters)) {
			throw invalidResponse();
		}

		if (trip.legs() == null || trip.legs().isEmpty()) {
			throw invalidResponse();
		}

		List<RoutingCoordinate> coordinates = new ArrayList<>();

		for (ValhallaLeg leg : trip.legs()) {
			appendLeg(coordinates, leg);
		}

		if (coordinates.isEmpty()) {
			throw invalidResponse();
		}

		return new RouteResult(
			coordinates,
			distanceMeters,
			durationSeconds,
			query.source(),
			query.destination()
		);
	}

	private void appendLeg(
		List<RoutingCoordinate> routeCoordinates,
		ValhallaLeg leg
	) {
		if (leg == null || leg.shape() == null || leg.shape().isBlank()) {
			throw invalidResponse();
		}

		List<RoutingCoordinate> legCoordinates;

		try {
			legCoordinates = Polyline6Decoder.decode(leg.shape());
		} catch (IllegalArgumentException exception) {
			throw invalidResponse();
		}

		if (legCoordinates.isEmpty()) {
			throw invalidResponse();
		}

		int startIndex = 0;

		if (
			!routeCoordinates.isEmpty() &&
			routeCoordinates.getLast().equals(legCoordinates.getFirst())
		) {
			startIndex = 1;
		}

		for (int index = startIndex; index < legCoordinates.size(); index += 1) {
			routeCoordinates.add(legCoordinates.get(index));
		}
	}

	private NearestPointResult normalizeNearestPoint(
		ValhallaLocateLocation[] response
	) {
		if (response == null || response.length == 0 || response[0] == null) {
			throw invalidResponse();
		}

		List<ValhallaLocateEdge> edges = response[0].edges();
		LocateCandidate nearestCandidate = null;

		if (edges != null) {
			for (ValhallaLocateEdge edge : edges) {
				LocateCandidate candidate = usableCandidate(edge);

				if (
					candidate != null &&
					(
						nearestCandidate == null ||
						candidate.distanceMeters() <
							nearestCandidate.distanceMeters()
					)
				) {
					nearestCandidate = candidate;
				}
			}
		}

		if (nearestCandidate == null) {
			throw nearestPointNotFound();
		}

		return new NearestPointResult(
			nearestCandidate.coordinate(),
			nearestCandidate.distanceMeters(),
			firstRoadName(nearestCandidate.edge())
		);
	}

	private LocateCandidate usableCandidate(ValhallaLocateEdge edge) {
		if (
			edge == null ||
			edge.correlated_lat() == null ||
			edge.correlated_lon() == null ||
			!isValidMetric(edge.distance())
		) {
			return null;
		}

		try {
			return new LocateCandidate(
				new RoutingCoordinate(
					edge.correlated_lat(),
					edge.correlated_lon()
				),
				edge.distance(),
				edge
			);
		} catch (IllegalArgumentException exception) {
			return null;
		}
	}

	private String firstRoadName(ValhallaLocateEdge edge) {
		if (edge.edge_info() == null || edge.edge_info().names() == null) {
			return null;
		}

		for (String name : edge.edge_info().names()) {
			if (name != null && !name.isBlank()) {
				return name.strip();
			}
		}

		return null;
	}

	private String costingFor(TravelMode travelMode) {
		if (travelMode == null) {
			throw new IllegalArgumentException("Travel mode is required");
		}

		return switch (travelMode) {
			case MOTORCYCLE -> "motorcycle";
			case WALKING -> "pedestrian";
			case CAR -> throw new TravelModeUnavailableException(travelMode);
		};
	}

	private ValhallaLocation toLocation(RoutingCoordinate coordinate) {
		return new ValhallaLocation(
			coordinate.latitude(),
			coordinate.longitude()
		);
	}

	private RoutingEngineException resourceAccessFailure(
		ResourceAccessException exception
	) {
		if (isTimeout(exception)) {
			return routingEngineTimeout();
		}

		return new RoutingEngineException(
			"ROUTING_ENGINE_UNAVAILABLE",
			"Routing engine is not reachable"
		);
	}

	private RoutingEngineException routingEngineTimeout() {
		return new RoutingEngineException(
			"ROUTING_ENGINE_TIMEOUT",
			"Routing engine timed out",
			HttpStatus.GATEWAY_TIMEOUT
		);
	}

	private boolean isTimeout(Throwable throwable) {
		Throwable current = throwable;

		while (current != null) {
			if (
				current instanceof SocketTimeoutException ||
				current instanceof HttpTimeoutException
			) {
				return true;
			}

			if (current == current.getCause()) {
				break;
			}

			current = current.getCause();
		}

		return false;
	}

	private RoutingEngineException providerResponseFailure(
		RestClientResponseException exception,
		Operation operation
	) {
		ValhallaErrorResponse errorResponse = parseErrorResponse(exception);

		if (
			exception.getStatusCode().value() == 400 &&
			errorResponse != null &&
			errorResponse.error_code() != null
		) {
			int errorCode = errorResponse.error_code();

			if (
				operation == Operation.ROUTE &&
				NO_ROUTE_ERROR_CODES.contains(errorCode)
			) {
				return routeNotFound();
			}

			if (
				operation == Operation.LOCATE &&
				errorCode == NO_SUITABLE_EDGES_ERROR_CODE
			) {
				return nearestPointNotFound();
			}
		}

		return new RoutingEngineException(
			"ROUTING_ENGINE_ERROR",
			"Routing engine returned an unsuccessful response"
		);
	}

	private ValhallaErrorResponse parseErrorResponse(
		RestClientResponseException exception
	) {
		try {
			return exception.getResponseBodyAs(ValhallaErrorResponse.class);
		} catch (RuntimeException parseFailure) {
			return null;
		}
	}

	private RoutingEngineException routeNotFound() {
		return new RoutingEngineException(
			"ROUTE_NOT_FOUND",
			"Routing engine did not return a route",
			HttpStatus.BAD_REQUEST
		);
	}

	private RoutingEngineException nearestPointNotFound() {
		return new RoutingEngineException(
			"NEAREST_POINT_NOT_FOUND",
			"Routing engine did not return a nearest point"
		);
	}

	private RoutingEngineException invalidResponse() {
		return new RoutingEngineException(
			"ROUTING_ENGINE_INVALID_RESPONSE",
			"Routing engine returned an invalid response"
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

	private enum Operation {
		ROUTE,
		LOCATE
	}

	private record ValhallaLocation(double lat, double lon) {
	}

	private record ValhallaRouteRequest(
		List<ValhallaLocation> locations,
		String costing,
		String units,
		String directions_type
	) {
	}

	private record ValhallaRouteResponse(ValhallaTrip trip) {
	}

	private record ValhallaTrip(
		Integer status,
		String units,
		ValhallaTripSummary summary,
		List<ValhallaLeg> legs
	) {
	}

	private record ValhallaTripSummary(Double length, Double time) {
	}

	private record ValhallaLeg(String shape) {
	}

	private record ValhallaLocateRequest(
		List<ValhallaLocation> locations,
		String costing,
		boolean verbose
	) {
	}

	private record ValhallaLocateLocation(List<ValhallaLocateEdge> edges) {
	}

	private record ValhallaLocateEdge(
		Double correlated_lat,
		Double correlated_lon,
		Double distance,
		ValhallaEdgeInfo edge_info
	) {
	}

	private record ValhallaEdgeInfo(List<String> names) {
	}

	private record ValhallaErrorResponse(
		Integer error_code,
		String error,
		Integer status_code,
		String status
	) {
	}

	private record LocateCandidate(
		RoutingCoordinate coordinate,
		double distanceMeters,
		ValhallaLocateEdge edge
	) {
	}
}
