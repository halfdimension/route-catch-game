package com.routecatch.api.multiplayer.room.creature;

public interface SpawnRandomSource {

	double nextDouble();

	int nextInt(int bound);
}
