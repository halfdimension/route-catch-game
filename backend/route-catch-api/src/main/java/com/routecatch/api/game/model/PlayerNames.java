package com.routecatch.api.game.model;

public final class PlayerNames {

	public static final String DEFAULT_PLAYER_NAME = "Guest";
	public static final int MAX_LENGTH = 80;

	private PlayerNames() {
	}

	public static String normalize(String playerName) {
		if (playerName == null || playerName.isBlank()) {
			return DEFAULT_PLAYER_NAME;
		}

		return playerName.trim();
	}

	public static boolean isTooLong(String playerName) {
		return normalize(playerName).length() > MAX_LENGTH;
	}
}
