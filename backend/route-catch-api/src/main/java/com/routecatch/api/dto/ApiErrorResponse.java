package com.routecatch.api.dto;

import java.time.Instant;

public record ApiErrorResponse(
	String errorCode,
	String message,
	String path,
	Instant timestamp
) {
}
