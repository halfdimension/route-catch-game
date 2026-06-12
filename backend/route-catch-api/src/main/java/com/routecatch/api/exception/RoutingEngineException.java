package com.routecatch.api.exception;

public class RoutingEngineException extends RuntimeException {

	private final String errorCode;

	public RoutingEngineException(String errorCode, String message) {
		super(message);
		this.errorCode = errorCode;
	}

	public String getErrorCode() {
		return errorCode;
	}
}
