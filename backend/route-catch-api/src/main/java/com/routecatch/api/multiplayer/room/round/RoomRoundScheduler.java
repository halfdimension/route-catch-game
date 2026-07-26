package com.routecatch.api.multiplayer.room.round;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;

@Service
public class RoomRoundScheduler {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomRoundScheduler.class
	);
	private final TaskScheduler taskScheduler;
	private final RoomRoundFinalizationGateway finalizationService;
	private final Map<String, ScheduledRound> scheduledRounds =
		new ConcurrentHashMap<>();

	public RoomRoundScheduler(
		@Qualifier("taskScheduler") TaskScheduler taskScheduler,
		RoomRoundFinalizationGateway finalizationService
	) {
		this.taskScheduler = taskScheduler;
		this.finalizationService = finalizationService;
	}

	@EventListener
	public void onRoomLifecycle(RoomGameLifecycleEvent event) {
		String roomCode = event.roomCode().trim().toUpperCase();

		if (event.type() == RoomGameLifecycleEvent.Type.STARTED) {
			schedule(roomCode, event);
			return;
		}

		cancel(roomCode, event.generation());
	}

	private void schedule(String roomCode, RoomGameLifecycleEvent event) {
		if (
			event.endsAt() == null ||
			event.roundId() == null
		) {
			return;
		}

		ScheduledRound previous = scheduledRounds.remove(roomCode);
		if (previous != null) {
			previous.future().cancel(false);
		}

		ScheduledFuture<?> future = taskScheduler.schedule(
			() -> runTimeout(
				roomCode,
				event.roundId(),
				event.generation()
			),
			event.endsAt()
		);

		if (future != null) {
			scheduledRounds.put(
				roomCode,
				new ScheduledRound(event.generation(), future)
			);
		}
	}

	private void runTimeout(
		String roomCode,
		java.util.UUID roundId,
		long generation
	) {
		try {
			finalizationService.finalizeRound(
				roomCode,
				roundId,
				generation,
				RoundEndReason.TIME_EXPIRED
			);
		} catch (RoundLifecycleException exception) {
			if (!"STALE_ROUND_GENERATION".equals(exception.getErrorCode())) {
				LOGGER.error(
					"scheduled round finalization failed roomCode={} roundId={} generation={} errorCode={}",
					roomCode,
					roundId,
					generation,
					exception.getErrorCode(),
					exception
				);
			}
		} finally {
			scheduledRounds.computeIfPresent(roomCode, (ignored, scheduled) ->
				scheduled.generation() == generation ? null : scheduled
			);
		}
	}

	private void cancel(String roomCode, long generation) {
		scheduledRounds.computeIfPresent(roomCode, (ignored, scheduled) -> {
			if (scheduled.generation() <= generation) {
				scheduled.future().cancel(false);
				return null;
			}
			return scheduled;
		});
	}

	private record ScheduledRound(
		long generation,
		ScheduledFuture<?> future
	) {
	}
}
