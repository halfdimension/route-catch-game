package com.routecatch.api.multiplayer.room.movement.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class MovementSchedulingConfig {

	@Bean("taskScheduler")
	public TaskScheduler movementTaskScheduler() {
		ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
		scheduler.setPoolSize(1);
		scheduler.setThreadNamePrefix("room-movement-completion-");
		scheduler.setRemoveOnCancelPolicy(true);
		return scheduler;
	}
}
