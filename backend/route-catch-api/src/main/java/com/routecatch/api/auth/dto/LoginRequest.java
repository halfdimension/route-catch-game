package com.routecatch.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
	@NotBlank(message = "must not be blank")
	String usernameOrEmail,

	@NotBlank(message = "must not be blank")
	String password
) {

	public LoginRequest {
		usernameOrEmail = normalizeLookup(usernameOrEmail);
	}

	private static String normalizeLookup(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}

		return value.trim().toLowerCase();
	}
}
