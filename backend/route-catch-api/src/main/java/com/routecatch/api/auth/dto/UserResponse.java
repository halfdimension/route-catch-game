package com.routecatch.api.auth.dto;

import java.time.Instant;

import com.routecatch.api.auth.persistence.UserEntity;

public record UserResponse(
	String userId,
	String username,
	String email,
	String displayName,
	Instant createdAt
) {

	public static UserResponse from(UserEntity user) {
		return new UserResponse(
			user.getUserId().toString(),
			user.getUsername(),
			user.getEmail(),
			user.getDisplayName(),
			user.getCreatedAt()
		);
	}
}
