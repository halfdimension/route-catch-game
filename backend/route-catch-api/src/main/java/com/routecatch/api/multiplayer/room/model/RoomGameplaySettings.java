package com.routecatch.api.multiplayer.room.model;

public class RoomGameplaySettings {

	public static final int DEFAULT_MAX_SPEED_MPS = 80;
	public static final int MIN_MAX_SPEED_MPS = 40;
	public static final int MAX_MAX_SPEED_MPS = 700;
	public static final boolean DEFAULT_ALLOW_PLAYER_SPEED_CONTROL = false;
	public static final boolean DEFAULT_ALLOW_MANUAL_CREATURE_SPAWN = true;

	private int maxSpeedMps = DEFAULT_MAX_SPEED_MPS;
	private boolean allowPlayerSpeedControl =
		DEFAULT_ALLOW_PLAYER_SPEED_CONTROL;
	private boolean allowManualCreatureSpawn =
		DEFAULT_ALLOW_MANUAL_CREATURE_SPAWN;

	public int getMaxSpeedMps() {
		return maxSpeedMps;
	}

	public boolean isAllowPlayerSpeedControl() {
		return allowPlayerSpeedControl;
	}

	public boolean isAllowManualCreatureSpawn() {
		return allowManualCreatureSpawn;
	}

	public void update(
		int maxSpeedMps,
		boolean allowPlayerSpeedControl,
		boolean allowManualCreatureSpawn
	) {
		this.maxSpeedMps = maxSpeedMps;
		this.allowPlayerSpeedControl = allowPlayerSpeedControl;
		this.allowManualCreatureSpawn = allowManualCreatureSpawn;
	}
}
