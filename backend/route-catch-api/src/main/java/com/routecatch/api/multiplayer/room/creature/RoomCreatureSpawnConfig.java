package com.routecatch.api.multiplayer.room.creature;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
@EnableConfigurationProperties(RoomCreatureSpawnProperties.class)
public class RoomCreatureSpawnConfig {

	@Bean("roomCreatureTaskScheduler")
	public TaskScheduler roomCreatureTaskScheduler() {
		ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
		scheduler.setPoolSize(2);
		scheduler.setThreadNamePrefix("room-creature-spawn-");
		scheduler.setRemoveOnCancelPolicy(true);
		return scheduler;
	}
}
