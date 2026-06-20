package com.routecatch.api.multiplayer.dto;

import java.time.Instant;

public record PresenceResponse(
	String userId,
	String username,
	String displayName,
	Double lat,
	Double lon,
	String status,
	Instant lastSeenAt
) {
}
