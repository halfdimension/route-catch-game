package com.routecatch.api.multiplayer.room.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;

import com.routecatch.api.auth.persistence.UserEntity;

public class MultiplayerRoom {

	private final String roomCode;
	private final String roomName;
	private UUID hostUserId;
	private String hostDisplayName;
	private MultiplayerRoomStatus status;
	private final Instant createdAt;
	private final LinkedHashMap<UUID, RoomMember> members = new LinkedHashMap<>();

	public MultiplayerRoom(String roomCode, String roomName, UserEntity host) {
		this.roomCode = roomCode;
		this.roomName = roomName;
		this.hostUserId = host.getUserId();
		this.hostDisplayName = host.getDisplayName();
		this.status = MultiplayerRoomStatus.OPEN;
		this.createdAt = Instant.now();
		this.members.put(host.getUserId(), new RoomMember(host, true));
	}

	public void addMember(UserEntity user) {
		members.computeIfAbsent(
			user.getUserId(),
			(ignored) -> new RoomMember(user, false)
		);
	}

	public void removeMember(UUID userId) {
		RoomMember removedMember = members.remove(userId);

		if (removedMember == null || !removedMember.isHost()) {
			return;
		}

		transferHostOrClose();
	}

	public boolean isHost(UUID userId) {
		return hostUserId.equals(userId);
	}

	public boolean hasMember(UUID userId) {
		return members.containsKey(userId);
	}

	public void close() {
		status = MultiplayerRoomStatus.CLOSED;
	}

	public String getRoomCode() {
		return roomCode;
	}

	public String getRoomName() {
		return roomName;
	}

	public UUID getHostUserId() {
		return hostUserId;
	}

	public String getHostDisplayName() {
		return hostDisplayName;
	}

	public MultiplayerRoomStatus getStatus() {
		return status;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public List<RoomMember> getMembers() {
		return new ArrayList<>(members.values());
	}

	private void transferHostOrClose() {
		members.values().forEach((member) -> member.setHost(false));

		RoomMember nextHost = members.values().stream()
			.findFirst()
			.orElse(null);

		if (nextHost == null) {
			close();
			return;
		}

		nextHost.setHost(true);
		hostUserId = nextHost.getUserId();
		hostDisplayName = nextHost.getDisplayName();
	}
}
