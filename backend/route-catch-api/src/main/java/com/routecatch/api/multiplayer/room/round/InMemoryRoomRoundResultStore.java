package com.routecatch.api.multiplayer.room.round;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

import org.springframework.stereotype.Repository;

@Repository
public class InMemoryRoomRoundResultStore implements RoomRoundResultStore {

	static final int MAX_RESULTS_PER_ROOM = 100;
	private final Map<RoundKey, FinalizedRoomRound> results =
		new ConcurrentHashMap<>();
	private final Map<String, UUID> latestRoundByRoom = new ConcurrentHashMap<>();
	private final Map<String, ConcurrentLinkedDeque<UUID>> roundOrderByRoom =
		new ConcurrentHashMap<>();

	@Override
	public FinalizedRoomRound saveIfAbsent(FinalizedRoomRound result) {
		PublicRoundResult publicResult = result.publicResult();
		RoundKey key = new RoundKey(
			normalize(publicResult.roomCode()),
			publicResult.roundId()
		);
		FinalizedRoomRound stored = results.putIfAbsent(key, result);

		if (stored == null) {
			latestRoundByRoom.put(key.roomCode(), key.roundId());
			ConcurrentLinkedDeque<UUID> order = roundOrderByRoom.computeIfAbsent(
				key.roomCode(),
				ignored -> new ConcurrentLinkedDeque<>()
			);
			order.addLast(key.roundId());
			while (order.size() > MAX_RESULTS_PER_ROOM) {
				UUID oldest = order.pollFirst();
				if (oldest != null) {
					results.remove(new RoundKey(key.roomCode(), oldest));
				}
			}
			return result;
		}

		return stored;
	}

	@Override
	public Optional<FinalizedRoomRound> find(String roomCode, UUID roundId) {
		return Optional.ofNullable(results.get(new RoundKey(
			normalize(roomCode),
			roundId
		)));
	}

	@Override
	public Optional<FinalizedRoomRound> findLatest(String roomCode) {
		String normalized = normalize(roomCode);
		UUID roundId = latestRoundByRoom.get(normalized);
		return roundId == null ? Optional.empty() : find(normalized, roundId);
	}

	private String normalize(String roomCode) {
		return roomCode.trim().toUpperCase();
	}

	private record RoundKey(String roomCode, UUID roundId) {
	}
}
