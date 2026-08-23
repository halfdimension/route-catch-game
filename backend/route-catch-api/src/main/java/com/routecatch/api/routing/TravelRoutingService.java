package com.routecatch.api.routing;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class TravelRoutingService {

	private final TravelRoutingProvider carRoutingProvider;
	private final TravelRoutingProvider valhallaRoutingProvider;

	public TravelRoutingService(
		@Qualifier("osrmRoutingService")
		TravelRoutingProvider carRoutingProvider,
		@Qualifier("valhallaRoutingService")
		TravelRoutingProvider valhallaRoutingProvider
	) {
		this.carRoutingProvider = carRoutingProvider;
		this.valhallaRoutingProvider = valhallaRoutingProvider;
	}

	public RouteResult route(RouteQuery query) {
		return providerFor(query.travelMode()).route(query);
	}

	public NearestPointResult findNearestPoint(NearestPointQuery query) {
		return providerFor(query.travelMode()).findNearestPoint(query);
	}

	private TravelRoutingProvider providerFor(TravelMode travelMode) {
		return switch (travelMode) {
			case CAR -> carRoutingProvider;
			case MOTORCYCLE, WALKING -> valhallaRoutingProvider;
		};
	}
}
