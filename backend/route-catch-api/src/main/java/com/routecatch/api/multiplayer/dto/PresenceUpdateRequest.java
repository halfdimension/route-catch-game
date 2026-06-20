package com.routecatch.api.multiplayer.dto;

public record PresenceUpdateRequest(
	Double lat,
	Double lon,
	String status
) {
}
