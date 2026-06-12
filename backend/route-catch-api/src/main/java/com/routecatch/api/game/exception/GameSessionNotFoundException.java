package com.routecatch.api.game.exception;

import java.util.UUID;

public class GameSessionNotFoundException extends RuntimeException {

	public GameSessionNotFoundException(UUID sessionId) {
		super("Game session not found: " + sessionId);
	}
}
