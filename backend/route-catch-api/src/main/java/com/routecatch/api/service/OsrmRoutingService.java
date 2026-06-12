package com.routecatch.api.service;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import com.routecatch.api.dto.CoordinateDto;
import com.routecatch.api.dto.RouteRequest;
import com.routecatch.api.dto.RouteResponse;

@Service
public class OsrmRoutingService {

	private final RestClient restClient;

	public OsrmRoutingService(@Value("${osrm.base-url}") String osrmBaseUrl) {
		this.restClient = RestClient.builder()
			.baseUrl(osrmBaseUrl)
			.build();
	}

	public RouteResponse fetchRoute(RouteRequest request) {
		String routeCoordinates = "%s,%s;%s,%s".formatted(
			request.sourceLon(),
			request.sourceLat(),
			request.destinationLon(),
			request.destinationLat()
		);

		OsrmRouteResponse osrmResponse = restClient.get()
			.uri(uriBuilder -> uriBuilder
				.path("/route/v1/driving/{coordinates}")
				.queryParam("overview", "full")
				.queryParam("geometries", "geojson")
				.queryParam("steps", "false")
				.build(routeCoordinates))
			.retrieve()
			.body(OsrmRouteResponse.class);

		if (osrmResponse == null || !"Ok".equals(osrmResponse.code())) {
			throw new RuntimeException("OSRM did not return a successful route response");
		}

		if (osrmResponse.routes() == null || osrmResponse.routes().isEmpty()) {
			throw new RuntimeException("OSRM did not return any routes");
		}

		OsrmRoute route = osrmResponse.routes().getFirst();

		if (route.geometry() == null || route.geometry().coordinates() == null) {
			throw new RuntimeException("OSRM route geometry is missing");
		}

		List<CoordinateDto> coordinates = route.geometry().coordinates().stream()
			.map(coordinate -> new CoordinateDto(coordinate.get(1), coordinate.get(0)))
			.toList();

		return new RouteResponse(
			coordinates,
			route.distance(),
			route.duration(),
			new CoordinateDto(request.sourceLat(), request.sourceLon()),
			new CoordinateDto(request.destinationLat(), request.destinationLon())
		);
	}

	private record OsrmRouteResponse(
		String code,
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
}
