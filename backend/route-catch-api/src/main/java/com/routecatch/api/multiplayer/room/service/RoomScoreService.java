package com.routecatch.api.multiplayer.room.service;

import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.ArrayList;
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
import com.routecatch.api.multiplayer.room.creature.RoomCreatureInstance;
import com.routecatch.api.multiplayer.room.round.CaughtCreatureRecord;
import com.routecatch.api.multiplayer.room.round.RoundParticipant;
import com.routecatch.api.multiplayer.room.round.RoundPlayerScoreSnapshot;

@Service
public class RoomScoreService {

	private final MultiplayerRoomService roomService;
	private final Map<RoundKey, Map<UUID, RoomScoreEntry>> scoresByRound =
		new ConcurrentHashMap<>();
	private final Map<RoundKey, List<CaughtCreatureRecord>> catchesByRound =
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
		RoomScoreEntry scoreEntry = scoresByRound
			.computeIfAbsent(roundKey(room), (ignored) -> new HashMap<>())
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

	public synchronized CaughtCreatureRecord recordCatch(
		MultiplayerRoom room,
		UserEntity currentUser,
		RoomCreatureInstance creature
	) {
		awardCatch(
			room,
			currentUser,
			creature.getScoreValue(),
			creature.getCaughtAt()
		);
		CaughtCreatureRecord caught = new CaughtCreatureRecord(
			creature.getInstanceId(),
			creature.getCreatureId(),
			creature.getName(),
			creature.getRarity(),
			creature.getScoreValue(),
			creature.getCaughtAt(),
			currentUser.getUserId(),
			room.getGameState().getRoundId()
		);
		catchesByRound
			.computeIfAbsent(roundKey(room), ignored -> new ArrayList<>())
			.add(caught);
		return caught;
	}

	public synchronized List<RoundPlayerScoreSnapshot> snapshotRound(
		MultiplayerRoom room
	) {
		RoundKey key = roundKey(room);
		Map<UUID, RoomScoreEntry> scores = scoresByRound.getOrDefault(
			key,
			Map.of()
		);
		List<CaughtCreatureRecord> catches = catchesByRound.getOrDefault(
			key,
			List.of()
		);

		return room.getGameState().getParticipants().stream()
			.map(participant -> snapshotPlayer(participant, scores, catches))
			.toList();
	}

	private RoomScoreEntry scoreEntryForMember(
		String roomCode,
		RoomMember member
	) {
		MultiplayerRoom room = roomService.getRoom(roomCode);
		return scoresByRound
			.computeIfAbsent(roundKey(room), (ignored) -> new HashMap<>())
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

	private RoundPlayerScoreSnapshot snapshotPlayer(
		RoundParticipant participant,
		Map<UUID, RoomScoreEntry> scores,
		List<CaughtCreatureRecord> catches
	) {
		RoomScoreEntry score = scores.get(participant.playerId());
		List<CaughtCreatureRecord> playerCatches = catches.stream()
			.filter(caught ->
				caught.catcherPlayerId().equals(participant.playerId())
			)
			.sorted(Comparator.comparing(CaughtCreatureRecord::caughtAt))
			.toList();
		return new RoundPlayerScoreSnapshot(
			participant.playerId(),
			participant.displayName(),
			score == null ? 0 : score.getScore(),
			playerCatches.size(),
			playerCatches
		);
	}

	private RoundKey roundKey(MultiplayerRoom room) {
		return new RoundKey(
			room.getRoomCode(),
			room.getGameState().getRoundId()
		);
	}

	private record RoundKey(String roomCode, UUID roundId) {
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
