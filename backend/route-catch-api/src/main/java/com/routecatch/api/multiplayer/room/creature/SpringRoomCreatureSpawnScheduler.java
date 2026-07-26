package com.routecatch.api.multiplayer.room.creature;

import java.time.Duration;
import java.util.concurrent.ScheduledFuture;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;

@Component
public class SpringRoomCreatureSpawnScheduler
	implements RoomCreatureSpawnScheduler {

	private final TaskScheduler taskScheduler;

	public SpringRoomCreatureSpawnScheduler(
		@Qualifier("roomCreatureTaskScheduler") TaskScheduler taskScheduler
	) {
		this.taskScheduler = taskScheduler;
	}

	@Override
	public Cancellable scheduleWithFixedDelay(
		Runnable task,
		Duration interval
	) {
		ScheduledFuture<?> future = taskScheduler.scheduleWithFixedDelay(
			task,
			interval
		);
		return () -> future.cancel(false);
	}
}
