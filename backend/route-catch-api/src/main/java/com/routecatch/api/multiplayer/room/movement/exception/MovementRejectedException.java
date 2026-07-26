package com.routecatch.api.multiplayer.room.movement.exception;

import org.springframework.http.HttpStatus;

public class MovementRejectedException extends RuntimeException {

	private final String errorCode;
	private final HttpStatus status;

	public MovementRejectedException(String errorCode, String message) {
		this(errorCode, message, HttpStatus.BAD_REQUEST);
	}

	public MovementRejectedException(
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
