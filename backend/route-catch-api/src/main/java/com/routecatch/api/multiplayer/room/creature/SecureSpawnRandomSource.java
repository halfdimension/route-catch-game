package com.routecatch.api.multiplayer.room.creature;

import java.security.SecureRandom;

import org.springframework.stereotype.Component;

@Component
public class SecureSpawnRandomSource implements SpawnRandomSource {

	private final SecureRandom random = new SecureRandom();

	@Override
	public double nextDouble() {
		return random.nextDouble();
	}

	@Override
	public int nextInt(int bound) {
		return random.nextInt(bound);
	}
}
