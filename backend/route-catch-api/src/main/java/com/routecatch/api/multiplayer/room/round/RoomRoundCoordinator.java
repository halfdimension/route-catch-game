package com.routecatch.api.multiplayer.room.round;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * The authoritative mutation boundary for a room. Locks are room-local so
 * unrelated rooms never block one another.
 */
public final class RoomRoundCoordinator {

	private final Map<String, Object> roomLocks = new ConcurrentHashMap<>();

	public <T> T withRoom(String roomCode, Supplier<T> action) {
		synchronized (lockFor(roomCode)) {
			return action.get();
		}
	}

	public void withRoom(String roomCode, Runnable action) {
		withRoom(roomCode, () -> {
			action.run();
			return null;
		});
	}

	private Object lockFor(String roomCode) {
		return roomLocks.computeIfAbsent(normalize(roomCode), ignored -> new Object());
	}

	private String normalize(String roomCode) {
		return roomCode.trim().toUpperCase();
	}
}
