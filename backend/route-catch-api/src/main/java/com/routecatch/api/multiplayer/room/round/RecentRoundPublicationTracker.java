package com.routecatch.api.multiplayer.room.round;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

final class RecentRoundPublicationTracker {

	private final int maxRoundsPerRoom;
	private final Map<String, LinkedHashSet<UUID>> publishedByRoom =
		new ConcurrentHashMap<>();

	RecentRoundPublicationTracker(int maxRoundsPerRoom) {
		if (maxRoundsPerRoom < 1) {
			throw new IllegalArgumentException("Publication retention must be positive");
		}
		this.maxRoundsPerRoom = maxRoundsPerRoom;
	}

	boolean isPublished(String roomCode, UUID roundId) {
		LinkedHashSet<UUID> published = publishedByRoom.get(normalize(roomCode));
		if (published == null) {
			return false;
		}
		synchronized (published) {
			return published.contains(roundId);
		}
	}

	void markPublished(String roomCode, UUID roundId) {
		LinkedHashSet<UUID> published = publishedByRoom.computeIfAbsent(
			normalize(roomCode),
			ignored -> new LinkedHashSet<>()
		);
		synchronized (published) {
			published.add(roundId);
			while (published.size() > maxRoundsPerRoom) {
				UUID oldest = published.iterator().next();
				published.remove(oldest);
			}
		}
	}

	int size(String roomCode) {
		LinkedHashSet<UUID> published = publishedByRoom.get(normalize(roomCode));
		if (published == null) {
			return 0;
		}
		synchronized (published) {
			return published.size();
		}
	}

	private String normalize(String roomCode) {
		return roomCode.trim().toUpperCase();
	}
}
