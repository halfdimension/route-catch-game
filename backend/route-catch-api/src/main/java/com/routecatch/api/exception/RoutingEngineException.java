package com.routecatch.api.exception;

import org.springframework.http.HttpStatus;

public class RoutingEngineException extends RuntimeException {

	private final String errorCode;
	private final HttpStatus status;

	public RoutingEngineException(String errorCode, String message) {
		this(errorCode, message, HttpStatus.BAD_GATEWAY);
	}

	public RoutingEngineException(
		String errorCode,
		String message,
		HttpStatus status
	) {
		super(message);
		this.errorCode = errorCode;
		this.status = status;
	}

	public String getErrorCode() {
		return errorCode;
	}

	public HttpStatus getStatus() {
		return status;
	}
}
