package com.routecatch.api.exception;

import com.routecatch.api.routing.TravelMode;

public class TravelModeUnavailableException extends RuntimeException {

	public TravelModeUnavailableException(TravelMode travelMode) {
		super("Routing is not available for travel mode " + travelMode);
	}
}
