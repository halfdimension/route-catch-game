package com.routecatch.api.multiplayer.room.creature;

public class RoomCreatureCatalogEmptyException extends RuntimeException {

	public RoomCreatureCatalogEmptyException() {
		super("Creature catalog is empty; room creatures cannot be spawned");
	}
}
