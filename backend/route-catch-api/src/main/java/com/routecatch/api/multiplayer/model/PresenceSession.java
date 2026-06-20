package com.routecatch.api.multiplayer.model;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class PresenceSession {

	private final UUID userId;
	private final Set<String> roomIds = ConcurrentHashMap.newKeySet();

	public PresenceSession(UUID userId) {
		this.userId = userId;
	}

	public UUID getUserId() {
		return userId;
	}

	public Set<String> getRoomIds() {
		return roomIds;
	}

	public void addRoom(String roomId) {
		roomIds.add(roomId);
	}
}
