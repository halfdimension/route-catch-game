package com.routecatch.api.multiplayer.room.service;

import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.dto.RoomScoreEntryResponse;
import com.routecatch.api.multiplayer.room.dto.RoomScoreboardResponse;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomMember;
import com.routecatch.api.multiplayer.room.model.RoomScoreEntry;

@Service
public class RoomScoreService {

	private final MultiplayerRoomService roomService;
	private final Map<String, Map<UUID, RoomScoreEntry>> scoresByRoom =
		new ConcurrentHashMap<>();

	public RoomScoreService(MultiplayerRoomService roomService) {
		this.roomService = roomService;
	}

	public synchronized RoomScoreboardResponse getScoreboard(
		String roomCode,
		UserEntity currentUser
	) {
		MultiplayerRoom room = roomService.getGameState(roomCode, currentUser);
		List<RoomScoreEntryResponse> entries = room.getMembers()
			.stream()
			.map((member) -> RoomScoreEntryResponse.from(
				member,
				scoreEntryForMember(room.getRoomCode(), member)
			))
			.sorted(scoreboardOrder())
			.toList();

		return new RoomScoreboardResponse(
			room.getRoomCode(),
			room.getStatus(),
			room.getGameState().getStatus(),
			entries
		);
	}

	public synchronized void awardCatch(
		MultiplayerRoom room,
		UserEntity currentUser,
		int scoreValue,
		Instant caughtAt
	) {
		RoomScoreEntry scoreEntry = scoresByRoom
			.computeIfAbsent(room.getRoomCode(), (ignored) -> new HashMap<>())
			.computeIfAbsent(
				currentUser.getUserId(),
				(ignored) -> new RoomScoreEntry(
					room.getRoomCode(),
					currentUser.getUserId(),
					currentUser.getUsername(),
					currentUser.getDisplayName()
				)
			);

		scoreEntry.awardCatch(scoreValue, caughtAt);
	}

	private RoomScoreEntry scoreEntryForMember(
		String roomCode,
		RoomMember member
	) {
		return scoresByRoom
			.computeIfAbsent(roomCode, (ignored) -> new HashMap<>())
			.computeIfAbsent(
				member.getUserId(),
				(ignored) -> new RoomScoreEntry(
					roomCode,
					member.getUserId(),
					member.getUsername(),
					member.getDisplayName()
				)
			);
	}

	private Comparator<RoomScoreEntryResponse> scoreboardOrder() {
		return Comparator
			.comparingInt(RoomScoreEntryResponse::score)
			.reversed()
			.thenComparing(
				Comparator.comparingInt(RoomScoreEntryResponse::catches)
					.reversed()
			)
			.thenComparing(
				RoomScoreEntryResponse::lastCatchAt,
				Comparator.nullsLast(Comparator.naturalOrder())
			)
			.thenComparing(RoomScoreEntryResponse::displayName);
	}
}
