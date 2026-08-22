package com.routecatch.api.routing;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import com.routecatch.api.exception.TravelModeUnavailableException;

@Service
public class TravelRoutingService {

	private final TravelRoutingProvider carRoutingProvider;

	public TravelRoutingService(
		@Qualifier("osrmRoutingService")
		TravelRoutingProvider carRoutingProvider
	) {
		this.carRoutingProvider = carRoutingProvider;
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
			case MOTORCYCLE, WALKING ->
				throw new TravelModeUnavailableException(travelMode);
		};
	}
}
