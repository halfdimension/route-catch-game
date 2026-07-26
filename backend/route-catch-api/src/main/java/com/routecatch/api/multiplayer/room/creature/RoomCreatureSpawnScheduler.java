package com.routecatch.api.multiplayer.room.creature;

import java.time.Duration;

public interface RoomCreatureSpawnScheduler {

	Cancellable scheduleWithFixedDelay(Runnable task, Duration interval);

	interface Cancellable {

		void cancel();
	}
}
