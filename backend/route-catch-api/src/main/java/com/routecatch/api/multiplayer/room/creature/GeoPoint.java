package com.routecatch.api.multiplayer.room.creature;

public record GeoPoint(double latitude, double longitude) {

	public boolean isValid() {
		return Double.isFinite(latitude)
			&& Double.isFinite(longitude)
			&& latitude >= -90.0
			&& latitude <= 90.0
			&& longitude >= -180.0
			&& longitude <= 180.0;
	}
}
