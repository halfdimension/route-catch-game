package com.routecatch.api.game.exception;

public class GameSessionForbiddenException extends RuntimeException {

	public GameSessionForbiddenException() {
		super("You cannot modify this game session");
	}
}
