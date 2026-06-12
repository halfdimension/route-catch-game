package com.routecatch.api.game.exception;

public class CreatureNotFoundException extends RuntimeException {

	public CreatureNotFoundException(String creatureId) {
		super("Creature not found: " + creatureId);
	}
}
