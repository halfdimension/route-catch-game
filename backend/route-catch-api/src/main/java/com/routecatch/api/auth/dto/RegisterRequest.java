package com.routecatch.api.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
	@NotBlank(message = "must not be blank")
	@Size(min = 3, max = 40, message = "must be between 3 and 40 characters")
	@Pattern(
		regexp = "^[a-z0-9_]+$",
		message = "must contain only letters, numbers, and underscores"
	)
	String username,

	@Email(message = "must be a valid email address")
	@Size(max = 320, message = "must be at most 320 characters")
	String email,

	@NotBlank(message = "must not be blank")
	@Size(max = 80, message = "must be at most 80 characters")
	String displayName,

	@NotBlank(message = "must not be blank")
	@Size(min = 8, message = "must be at least 8 characters")
	String password
) {

	public RegisterRequest {
		username = normalizeLowercase(username);
		email = normalizeEmail(email);
		displayName = normalize(displayName);
	}

	private static String normalizeLowercase(String value) {
		String normalizedValue = normalize(value);
		return normalizedValue == null ? null : normalizedValue.toLowerCase();
	}

	private static String normalizeEmail(String value) {
		String normalizedValue = normalize(value);
		return normalizedValue == null ? null : normalizedValue.toLowerCase();
	}

	private static String normalize(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}

		return value.trim();
	}
}
