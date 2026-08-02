package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class RecentRoundPublicationTrackerTests {

	@Test
	void evictsOldestPublicationAtPerRoomResultRetentionBound() {
		RecentRoundPublicationTracker tracker = new RecentRoundPublicationTracker(
			InMemoryRoomRoundResultStore.MAX_RESULTS_PER_ROOM
		);
		List<UUID> roundIds = new ArrayList<>();

		for (
			int index = 0;
			index < InMemoryRoomRoundResultStore.MAX_RESULTS_PER_ROOM + 1;
			index += 1
		) {
			UUID roundId = UUID.randomUUID();
			roundIds.add(roundId);
			tracker.markPublished("room01", roundId);
		}

		assertEquals(
			InMemoryRoomRoundResultStore.MAX_RESULTS_PER_ROOM,
			tracker.size("ROOM01")
		);
		assertFalse(tracker.isPublished("ROOM01", roundIds.getFirst()));
		assertTrue(tracker.isPublished("room01", roundIds.getLast()));
	}

	@Test
	void publicationRetentionIsIndependentPerRoomAndDeduplicatesIds() {
		RecentRoundPublicationTracker tracker = new RecentRoundPublicationTracker(2);
		UUID first = UUID.randomUUID();
		UUID second = UUID.randomUUID();

		tracker.markPublished("room01", first);
		tracker.markPublished("ROOM01", first);
		tracker.markPublished("room02", second);

		assertEquals(1, tracker.size("ROOM01"));
		assertEquals(1, tracker.size("ROOM02"));
		assertTrue(tracker.isPublished("room01", first));
		assertTrue(tracker.isPublished("room02", second));
	}
}
