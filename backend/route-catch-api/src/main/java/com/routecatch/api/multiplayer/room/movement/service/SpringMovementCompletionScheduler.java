package com.routecatch.api.multiplayer.room.movement.service;

import java.time.Instant;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;

@Component
public class SpringMovementCompletionScheduler
	implements MovementCompletionScheduler {

	private final TaskScheduler taskScheduler;

	public SpringMovementCompletionScheduler(
		@Qualifier("taskScheduler") TaskScheduler taskScheduler
	) {
		this.taskScheduler = taskScheduler;
	}

	@Override
	public void schedule(Instant completionTime, Runnable completionTask) {
		taskScheduler.schedule(completionTask, completionTime);
	}
}
