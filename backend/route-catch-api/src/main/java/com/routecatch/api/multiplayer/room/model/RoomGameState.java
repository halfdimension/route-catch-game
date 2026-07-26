package com.routecatch.api.multiplayer.room.model;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.round.RoundParticipant;

public class RoomGameState {

	private final String roomCode;
	private RoomGameStatus status;
	private int durationSeconds;
	private Instant startedAt;
	private Instant endsAt;
	private Instant endedAt;
	private UUID startedByUserId;
	private String startedByDisplayName;
	private long generation;
	private UUID roundId;
	private List<RoundParticipant> participants = List.of();

	public RoomGameState(String roomCode) {
		this.roomCode = roomCode;
		this.status = RoomGameStatus.WAITING;
		this.durationSeconds = 0;
		this.generation = 0L;
	}

	public void start(
		int requestedDurationSeconds,
		Instant now,
		UserEntity currentUser,
		List<RoomMember> members
	) {
		generation += 1L;
		roundId = UUID.randomUUID();
		status = RoomGameStatus.RUNNING;
		durationSeconds = requestedDurationSeconds;
		startedAt = now;
		endsAt = now.plusSeconds(requestedDurationSeconds);
		endedAt = null;
		startedByUserId = currentUser.getUserId();
		startedByDisplayName = currentUser.getDisplayName();
		participants = members.stream().map(RoundParticipant::from).toList();
	}

	public boolean beginFinalizing(UUID expectedRoundId, long expectedGeneration) {
		if (
			status != RoomGameStatus.RUNNING ||
			generation != expectedGeneration ||
			!roundId.equals(expectedRoundId)
		) {
			return false;
		}

		status = RoomGameStatus.FINALIZING;
		return true;
	}

	public void end(Instant endedAt) {
		status = RoomGameStatus.ENDED;
		this.endedAt = endedAt;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public RoomGameStatus getStatus() {
		return status;
	}

	public int getDurationSeconds() {
		return durationSeconds;
	}

	public Instant getStartedAt() {
		return startedAt;
	}

	public Instant getEndsAt() {
		return endsAt;
	}

	public Instant getEndedAt() {
		return endedAt;
	}

	public UUID getStartedByUserId() {
		return startedByUserId;
	}

	public String getStartedByDisplayName() {
		return startedByDisplayName;
	}

	public long getGeneration() {
		return generation;
	}

	public UUID getRoundId() {
		return roundId;
	}

	public List<RoundParticipant> getParticipants() {
		return participants;
	}

	public boolean hasParticipant(UUID playerId) {
		return participants.stream().anyMatch(participant ->
			participant.playerId().equals(playerId)
		);
	}
}
