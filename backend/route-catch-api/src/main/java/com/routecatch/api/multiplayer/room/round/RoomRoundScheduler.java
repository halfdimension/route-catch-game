package com.routecatch.api.multiplayer.room.round;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;

import jakarta.annotation.PreDestroy;

@Service
public class RoomRoundScheduler {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomRoundScheduler.class
	);
	static final int MAX_FINALIZATION_ATTEMPTS = 3;
	static final Duration RETRY_BASE_DELAY = Duration.ofSeconds(1);
	private final TaskScheduler taskScheduler;
	private final RoomRoundFinalizationGateway finalizationService;
	private final Clock clock;
	private final Map<String, ScheduledRound> scheduledRounds =
		new ConcurrentHashMap<>();

	@Autowired
	public RoomRoundScheduler(
		@Qualifier("taskScheduler") TaskScheduler taskScheduler,
		RoomRoundFinalizationGateway finalizationService
	) {
		this(taskScheduler, finalizationService, Clock.systemUTC());
	}

	RoomRoundScheduler(
		TaskScheduler taskScheduler,
		RoomRoundFinalizationGateway finalizationService,
		Clock clock
	) {
		this.taskScheduler = taskScheduler;
		this.finalizationService = finalizationService;
		this.clock = clock;
	}

	@EventListener
	public void onRoomLifecycle(RoomGameLifecycleEvent event) {
		String roomCode = event.roomCode().trim().toUpperCase();

		if (event.type() == RoomGameLifecycleEvent.Type.STARTED) {
			schedule(roomCode, event);
			return;
		}
		if (event.type() == RoomGameLifecycleEvent.Type.FINALIZING) {
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
				event.generation(),
				1
			),
			event.endsAt()
		);

		if (future != null) {
			scheduledRounds.put(
				roomCode,
				new ScheduledRound(
					event.roundId(),
					event.generation(),
					1,
					future
				)
			);
		}
	}

	private void runTimeout(
		String roomCode,
		UUID roundId,
		long generation,
		int attempt
	) {
		try {
			finalizationService.finalizeRound(
				roomCode,
				roundId,
				generation,
				RoundEndReason.TIME_EXPIRED
			);
		} catch (RoundLifecycleException exception) {
			if (isRetryable(exception)) {
				retryOrExhaust(roomCode, roundId, generation, attempt);
				return;
			}
			if (!"STALE_ROUND_GENERATION".equals(exception.getErrorCode())) {
				LOGGER.error(
					"scheduled round finalization failed roomCode={} roundId={} generation={} attempt={} errorCode={}",
					roomCode,
					roundId,
					generation,
					attempt,
					exception.getErrorCode()
				);
			}
		}

		clearIfCurrent(roomCode, roundId, generation, attempt);
	}

	private boolean isRetryable(RoundLifecycleException exception) {
		return "ROUND_PERSISTENCE_UNAVAILABLE".equals(exception.getErrorCode()) ||
			"ROUND_FINALIZATION_UNAVAILABLE".equals(exception.getErrorCode());
	}

	@PreDestroy
	void shutdown() {
		scheduledRounds.forEach((ignored, scheduled) ->
			scheduled.future().cancel(false)
		);
		scheduledRounds.clear();
	}

	private void retryOrExhaust(
		String roomCode,
		UUID roundId,
		long generation,
		int attempt
	) {
		if (attempt >= MAX_FINALIZATION_ATTEMPTS) {
			clearIfCurrent(roomCode, roundId, generation, attempt);
			LOGGER.error(
				"scheduled round finalization retries exhausted roomCode={} roundId={} generation={} attempts={}",
				roomCode,
				roundId,
				generation,
				attempt
			);
			return;
		}

		int nextAttempt = attempt + 1;
		Instant retryAt = Instant.now(clock).plus(
			RETRY_BASE_DELAY.multipliedBy(attempt)
		);
		scheduledRounds.computeIfPresent(roomCode, (ignored, scheduled) -> {
			if (!scheduled.matches(roundId, generation, attempt)) {
				return scheduled;
			}

			ScheduledFuture<?> retry = taskScheduler.schedule(
				() -> runTimeout(
					roomCode,
					roundId,
					generation,
					nextAttempt
				),
				retryAt
			);
			if (retry == null) {
				LOGGER.error(
					"scheduled round finalization retry rejected roomCode={} roundId={} generation={} nextAttempt={}",
					roomCode,
					roundId,
					generation,
					nextAttempt
				);
				return null;
			}

			LOGGER.warn(
				"scheduled round finalization retry scheduled roomCode={} roundId={} generation={} nextAttempt={} retryAt={}",
				roomCode,
				roundId,
				generation,
				nextAttempt,
				retryAt
			);
			return new ScheduledRound(
				roundId,
				generation,
				nextAttempt,
				retry
			);
		});
	}

	private void clearIfCurrent(
		String roomCode,
		UUID roundId,
		long generation,
		int attempt
	) {
		scheduledRounds.computeIfPresent(roomCode, (ignored, scheduled) ->
			scheduled.matches(roundId, generation, attempt) ? null : scheduled
		);
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
		UUID roundId,
		long generation,
		int attempt,
		ScheduledFuture<?> future
	) {

		private boolean matches(
			UUID expectedRoundId,
			long expectedGeneration,
			int expectedAttempt
		) {
			return roundId.equals(expectedRoundId) &&
				generation == expectedGeneration &&
				attempt == expectedAttempt;
		}
	}
}
