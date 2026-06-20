package com.routecatch.api.game.exception;

public class InvalidPlayerNameException extends RuntimeException {

	public InvalidPlayerNameException() {
		super("playerName must be at most 80 characters");
	}
}
