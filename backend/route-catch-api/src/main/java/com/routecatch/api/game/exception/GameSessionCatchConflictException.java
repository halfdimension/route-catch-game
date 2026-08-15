package com.routecatch.api.game.exception;

public class GameSessionCatchConflictException extends RuntimeException {

	public GameSessionCatchConflictException() {
		super("Catch ID is already assigned to a different catch");
	}
}
