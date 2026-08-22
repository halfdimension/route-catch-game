package com.routecatch.api.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.routecatch.api.exception.TravelModeUnavailableException;

class TravelRoutingServiceTests {

	private static final RoutingCoordinate SOURCE = new RoutingCoordinate(
		28.6139,
		77.2090
	);
	private static final RoutingCoordinate DESTINATION = new RoutingCoordinate(
		28.6200,
		77.2150
	);

	@Test
	void carRouteUsesExactlyTheConfiguredCarProvider() {
		RecordingProvider carProvider = new RecordingProvider();
		TravelRoutingService service = new TravelRoutingService(carProvider);
		RouteQuery query = new RouteQuery(
			TravelMode.CAR,
			SOURCE,
			DESTINATION
		);

		RouteResult result = service.route(query);

		assertSame(carProvider.routeResult, result);
		assertSame(query, carProvider.routeQuery);
		assertEquals(1, carProvider.routeCalls);
	}

	@Test
	void carNearestUsesExactlyTheConfiguredCarProvider() {
		RecordingProvider carProvider = new RecordingProvider();
		TravelRoutingService service = new TravelRoutingService(carProvider);
		NearestPointQuery query = new NearestPointQuery(
			TravelMode.CAR,
			SOURCE
		);

		NearestPointResult result = service.findNearestPoint(query);

		assertSame(carProvider.nearestResult, result);
		assertSame(query, carProvider.nearestQuery);
		assertEquals(1, carProvider.nearestCalls);
	}

	@Test
	void nonCarModesNeverFallBackToTheCarProvider() {
		for (TravelMode travelMode : List.of(
			TravelMode.MOTORCYCLE,
			TravelMode.WALKING
		)) {
			RecordingProvider carProvider = new RecordingProvider();
			TravelRoutingService service = new TravelRoutingService(carProvider);

			TravelModeUnavailableException routeException = assertThrows(
				TravelModeUnavailableException.class,
				() -> service.route(new RouteQuery(
					travelMode,
					SOURCE,
					DESTINATION
				))
			);
			TravelModeUnavailableException nearestException = assertThrows(
				TravelModeUnavailableException.class,
				() -> service.findNearestPoint(new NearestPointQuery(
					travelMode,
					SOURCE
				))
			);

			assertEquals(
				"Routing is not available for travel mode " + travelMode,
				routeException.getMessage()
			);
			assertEquals(routeException.getMessage(), nearestException.getMessage());
			assertEquals(0, carProvider.routeCalls);
			assertEquals(0, carProvider.nearestCalls);
		}
	}

	private static final class RecordingProvider
		implements TravelRoutingProvider {

		private final RouteResult routeResult = new RouteResult(
			List.of(SOURCE, DESTINATION),
			100.0,
			10.0,
			SOURCE,
			DESTINATION
		);
		private final NearestPointResult nearestResult = new NearestPointResult(
			SOURCE,
			0.0,
			"Road"
		);
		private RouteQuery routeQuery;
		private NearestPointQuery nearestQuery;
		private int routeCalls;
		private int nearestCalls;

		@Override
		public RouteResult route(RouteQuery query) {
			routeCalls += 1;
			routeQuery = query;
			return routeResult;
		}

		@Override
		public NearestPointResult findNearestPoint(NearestPointQuery query) {
			nearestCalls += 1;
			nearestQuery = query;
			return nearestResult;
		}
	}
}
