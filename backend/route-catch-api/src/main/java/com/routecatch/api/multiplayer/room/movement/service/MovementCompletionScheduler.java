package com.routecatch.api.multiplayer.room.movement.service;

import java.time.Instant;

public interface MovementCompletionScheduler {

	void schedule(Instant completionTime, Runnable completionTask);
}
