package com.routecatch.api.multiplayer.room.round;

import org.springframework.http.HttpStatus;

public class RoundLifecycleException extends RuntimeException {

	private final String errorCode;
	private final HttpStatus status;

	public RoundLifecycleException(
		String errorCode,
		String message,
		HttpStatus status
	) {
		this(errorCode, message, status, null);
	}

	public RoundLifecycleException(
		String errorCode,
		String message,
		HttpStatus status,
		Throwable cause
	) {
		super(message, cause);
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
