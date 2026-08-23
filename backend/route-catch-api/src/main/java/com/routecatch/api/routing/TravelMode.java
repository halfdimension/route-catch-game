package com.routecatch.api.routing;

import com.routecatch.api.exception.UnsupportedTravelModeException;

public enum TravelMode {

	CAR,
	MOTORCYCLE,
	WALKING;

	public static TravelMode fromApiValue(String value) {
		if (value == null) {
			return CAR;
		}

		try {
			return valueOf(value);
		} catch (IllegalArgumentException exception) {
			throw new UnsupportedTravelModeException();
		}
	}
}
