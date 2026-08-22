package com.routecatch.api.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.routecatch.api.exception.RoutingEngineException;

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
	void routeDelegatesEachModeToExactlyItsConfiguredProvider() {
		for (TravelMode travelMode : TravelMode.values()) {
			RecordingProvider carProvider = new RecordingProvider();
			RecordingProvider valhallaProvider = new RecordingProvider();
			TravelRoutingService service = new TravelRoutingService(
				carProvider,
				valhallaProvider
			);
			RouteQuery query = new RouteQuery(
				travelMode,
				SOURCE,
				DESTINATION
			);
			RecordingProvider expectedProvider = travelMode == TravelMode.CAR
				? carProvider
				: valhallaProvider;
			RecordingProvider unusedProvider = travelMode == TravelMode.CAR
				? valhallaProvider
				: carProvider;

			RouteResult result = service.route(query);

			assertSame(expectedProvider.routeResult, result);
			assertSame(query, expectedProvider.routeQuery);
			assertEquals(1, expectedProvider.routeCalls);
			assertEquals(0, unusedProvider.routeCalls);
		}
	}

	@Test
	void nearestPointDelegatesEachModeToExactlyItsConfiguredProvider() {
		for (TravelMode travelMode : TravelMode.values()) {
			RecordingProvider carProvider = new RecordingProvider();
			RecordingProvider valhallaProvider = new RecordingProvider();
			TravelRoutingService service = new TravelRoutingService(
				carProvider,
				valhallaProvider
			);
			NearestPointQuery query = new NearestPointQuery(
				travelMode,
				SOURCE
			);
			RecordingProvider expectedProvider = travelMode == TravelMode.CAR
				? carProvider
				: valhallaProvider;
			RecordingProvider unusedProvider = travelMode == TravelMode.CAR
				? valhallaProvider
				: carProvider;

			NearestPointResult result = service.findNearestPoint(query);

			assertSame(expectedProvider.nearestResult, result);
			assertSame(query, expectedProvider.nearestQuery);
			assertEquals(1, expectedProvider.nearestCalls);
			assertEquals(0, unusedProvider.nearestCalls);
		}
	}

	@Test
	void routeProviderFailuresPropagateWithoutFallback() {
		for (TravelMode travelMode : TravelMode.values()) {
			RecordingProvider carProvider = new RecordingProvider();
			RecordingProvider valhallaProvider = new RecordingProvider();
			TravelRoutingService service = new TravelRoutingService(
				carProvider,
				valhallaProvider
			);
			RecordingProvider expectedProvider = travelMode == TravelMode.CAR
				? carProvider
				: valhallaProvider;
			RecordingProvider unusedProvider = travelMode == TravelMode.CAR
				? valhallaProvider
				: carProvider;
			RoutingEngineException providerFailure = providerFailure();
			expectedProvider.routeFailure = providerFailure;

			RoutingEngineException actualFailure = assertThrows(
				RoutingEngineException.class,
				() -> service.route(new RouteQuery(
					travelMode,
					SOURCE,
					DESTINATION
				))
			);

			assertSame(providerFailure, actualFailure);
			assertEquals(1, expectedProvider.routeCalls);
			assertEquals(0, unusedProvider.routeCalls);
		}
	}

	@Test
	void nearestPointProviderFailuresPropagateWithoutFallback() {
		for (TravelMode travelMode : TravelMode.values()) {
			RecordingProvider carProvider = new RecordingProvider();
			RecordingProvider valhallaProvider = new RecordingProvider();
			TravelRoutingService service = new TravelRoutingService(
				carProvider,
				valhallaProvider
			);
			RecordingProvider expectedProvider = travelMode == TravelMode.CAR
				? carProvider
				: valhallaProvider;
			RecordingProvider unusedProvider = travelMode == TravelMode.CAR
				? valhallaProvider
				: carProvider;
			RoutingEngineException providerFailure = providerFailure();
			expectedProvider.nearestFailure = providerFailure;

			RoutingEngineException actualFailure = assertThrows(
				RoutingEngineException.class,
				() -> service.findNearestPoint(new NearestPointQuery(
					travelMode,
					SOURCE
				))
			);

			assertSame(providerFailure, actualFailure);
			assertEquals(1, expectedProvider.nearestCalls);
			assertEquals(0, unusedProvider.nearestCalls);
		}
	}

	private RoutingEngineException providerFailure() {
		return new RoutingEngineException(
			"TEST_PROVIDER_FAILURE",
			"Provider failed"
		);
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
		private RoutingEngineException routeFailure;
		private RoutingEngineException nearestFailure;
		private int routeCalls;
		private int nearestCalls;

		@Override
		public RouteResult route(RouteQuery query) {
			routeCalls += 1;
			routeQuery = query;

			if (routeFailure != null) {
				throw routeFailure;
			}

			return routeResult;
		}

		@Override
		public NearestPointResult findNearestPoint(NearestPointQuery query) {
			nearestCalls += 1;
			nearestQuery = query;

			if (nearestFailure != null) {
				throw nearestFailure;
			}

			return nearestResult;
		}
	}
}
