package com.routecatch.api.multiplayer.room.event;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Component;

@Component
public class InMemoryRoomEventSequencer implements RoomEventSequencer {

	private final Map<String, AtomicLong> roomSequences =
		new ConcurrentHashMap<>();

	@Override
	public long next(String roomCode) {
		return roomSequences
			.computeIfAbsent(normalize(roomCode), (ignored) -> new AtomicLong())
			.incrementAndGet();
	}

	@Override
	public long current(String roomCode) {
		AtomicLong sequence = roomSequences.get(normalize(roomCode));
		return sequence == null ? 0L : sequence.get();
	}

	private String normalize(String roomCode) {
		return roomCode.trim().toUpperCase();
	}
}
