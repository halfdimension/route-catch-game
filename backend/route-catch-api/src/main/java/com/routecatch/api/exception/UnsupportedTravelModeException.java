package com.routecatch.api.exception;

public class UnsupportedTravelModeException extends RuntimeException {

	public UnsupportedTravelModeException() {
		super("travelMode must be one of CAR, MOTORCYCLE, or WALKING");
	}
}
