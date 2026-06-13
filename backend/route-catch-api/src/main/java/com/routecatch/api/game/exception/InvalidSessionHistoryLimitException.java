package com.routecatch.api.game.exception;

public class InvalidSessionHistoryLimitException extends RuntimeException {

	public InvalidSessionHistoryLimitException() {
		super("limit must be between 1 and 100");
	}
}
