package com.routecatch.api.multiplayer.room.model;

import java.time.Instant;
import java.util.UUID;

import com.routecatch.api.auth.persistence.UserEntity;

public class RoomMember {

	private final UUID userId;
	private final String username;
	private final String displayName;
	private final Instant joinedAt;
	private boolean host;

	public RoomMember(UserEntity user, boolean host) {
		this.userId = user.getUserId();
		this.username = user.getUsername();
		this.displayName = user.getDisplayName();
		this.joinedAt = Instant.now();
		this.host = host;
	}

	public UUID getUserId() {
		return userId;
	}

	public String getUsername() {
		return username;
	}

	public String getDisplayName() {
		return displayName;
	}

	public Instant getJoinedAt() {
		return joinedAt;
	}

	public boolean isHost() {
		return host;
	}

	public void setHost(boolean host) {
		this.host = host;
	}
}
