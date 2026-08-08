package com.routecatch.api.multiplayer.room.round;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventType;

import jakarta.annotation.PreDestroy;

@Service
public class GameEndedPublicationRetryService {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		GameEndedPublicationRetryService.class
	);
	static final int MAX_PUBLICATION_ATTEMPTS = 3;
	static final Duration RETRY_BASE_DELAY = Duration.ofSeconds(1);

	private final TaskScheduler taskScheduler;
	private final RoomEventSequencer eventSequencer;
	private final RoomRoundEventPublisher eventPublisher;
	private final Clock clock;
	private final RecentRoundPublicationTracker publishedRounds =
		new RecentRoundPublicationTracker(
			InMemoryRoomRoundResultStore.MAX_RESULTS_PER_ROOM
		);
	private final ConcurrentHashMap<PublicationKey, PublicationAttempt>
		publicationAttempts = new ConcurrentHashMap<>();
	private volatile boolean shuttingDown;

	@Autowired
	public GameEndedPublicationRetryService(
		@Qualifier("taskScheduler") TaskScheduler taskScheduler,
		RoomEventSequencer eventSequencer,
		RoomRoundEventPublisher eventPublisher
	) {
		this(
			taskScheduler,
			eventSequencer,
			eventPublisher,
			Clock.systemUTC()
		);
	}

	GameEndedPublicationRetryService(
		TaskScheduler taskScheduler,
		RoomEventSequencer eventSequencer,
		RoomRoundEventPublisher eventPublisher,
		Clock clock
	) {
		this.taskScheduler = taskScheduler;
		this.eventSequencer = eventSequencer;
		this.eventPublisher = eventPublisher;
		this.clock = clock;
	}

	/**
	 * Publishes only from the immutable result already stored after a successful
	 * database commit. Failures are retried here and never re-enter round
	 * finalization or persistence.
	 */
	public void publish(FinalizedRoomRound storedResult) {
		Objects.requireNonNull(storedResult, "storedResult is required");
		PublicRoundResult payload = Objects.requireNonNull(
			storedResult.publicResult(),
			"publicResult is required"
		);
		PublicationKey key = new PublicationKey(
			normalize(payload.roomCode()),
			payload.roundId(),
			storedResult.generation()
		);

		if (
			shuttingDown ||
			publishedRounds.isPublished(key.roomCode(), key.roundId())
		) {
			return;
		}

		PublicationAttempt attempt = publicationAttempts.compute(
			key,
			(ignored, existing) -> {
				if (existing != null) {
					return existing;
				}

				return new PublicationAttempt(
					key,
					storedResult,
					new RoomEventEnvelope<>(
						UUID.randomUUID(),
						payload.roomCode(),
						eventSequencer.next(payload.roomCode()),
						RoomEventType.GAME_ENDED,
						Instant.now(clock),
						payload
					)
				);
			}
		);

		attemptPublication(attempt, null);
	}

	@PreDestroy
	void shutdown() {
		shuttingDown = true;
		publicationAttempts.forEach((ignored, attempt) -> {
			synchronized (attempt) {
				finish(attempt);
			}
		});
		publicationAttempts.clear();
	}

	int pendingPublicationCount() {
		return publicationAttempts.size();
	}

	boolean isPublished(String roomCode, UUID roundId) {
		return publishedRounds.isPublished(roomCode, roundId);
	}

	private void attemptPublication(
		PublicationAttempt attempt,
		Long expectedScheduleVersion
	) {
		synchronized (attempt) {
			if (
				attempt.finished ||
				shuttingDown ||
				publishedRounds.isPublished(
					attempt.key.roomCode(),
					attempt.key.roundId()
				)
			) {
				finish(attempt);
				return;
			}
			if (
				expectedScheduleVersion != null &&
				expectedScheduleVersion != attempt.scheduleVersion
			) {
				return;
			}
			invalidateScheduledRetry(attempt, expectedScheduleVersion == null);
			if (attempt.attempts >= MAX_PUBLICATION_ATTEMPTS) {
				finish(attempt);
				return;
			}

			attempt.attempts += 1;
			try {
				eventPublisher.publish(attempt.event);
				publishedRounds.markPublished(
					attempt.key.roomCode(),
					attempt.key.roundId()
				);
				finish(attempt);
				return;
			} catch (RuntimeException exception) {
				if (attempt.attempts >= MAX_PUBLICATION_ATTEMPTS) {
					LOGGER.error(
						"GAME_ENDED publication retries exhausted roomCode={} roundId={} generation={} attempts={} failureType={}",
						attempt.key.roomCode(),
						attempt.key.roundId(),
						attempt.key.generation(),
						attempt.attempts,
						exception.getClass().getSimpleName()
					);
					finish(attempt);
					return;
				}

				scheduleRetry(attempt, exception);
			}
		}
	}

	private void scheduleRetry(
		PublicationAttempt attempt,
		RuntimeException failure
	) {
		Duration delay = RETRY_BASE_DELAY.multipliedBy(attempt.attempts);
		Instant retryAt = Instant.now(clock).plus(delay);
		long scheduleVersion = attempt.scheduleVersion + 1;
		attempt.scheduleVersion = scheduleVersion;

		try {
			ScheduledFuture<?> future = taskScheduler.schedule(
				() -> attemptPublication(
					attempt,
					scheduleVersion
				),
				retryAt
			);
			if (future == null) {
				LOGGER.error(
					"GAME_ENDED publication retry rejected roomCode={} roundId={} generation={} completedAttempts={}",
					attempt.key.roomCode(),
					attempt.key.roundId(),
					attempt.key.generation(),
					attempt.attempts
				);
				finish(attempt);
				return;
			}
			attempt.scheduledFuture = future;
			LOGGER.warn(
				"GAME_ENDED publication retry scheduled roomCode={} roundId={} generation={} nextAttempt={} retryAt={} failureType={}",
				attempt.key.roomCode(),
				attempt.key.roundId(),
				attempt.key.generation(),
				attempt.attempts + 1,
				retryAt,
				failure.getClass().getSimpleName()
			);
		} catch (RuntimeException exception) {
			LOGGER.error(
				"GAME_ENDED publication retry scheduling failed roomCode={} roundId={} generation={} completedAttempts={} failureType={}",
				attempt.key.roomCode(),
				attempt.key.roundId(),
				attempt.key.generation(),
				attempt.attempts,
				exception.getClass().getSimpleName()
			);
			finish(attempt);
		}
	}

	private void invalidateScheduledRetry(
		PublicationAttempt attempt,
		boolean cancel
	) {
		ScheduledFuture<?> scheduled = attempt.scheduledFuture;
		attempt.scheduledFuture = null;
		attempt.scheduleVersion += 1;

		if (cancel && scheduled != null) {
			scheduled.cancel(false);
		}
	}

	private void finish(PublicationAttempt attempt) {
		attempt.finished = true;
		attempt.scheduleVersion += 1;
		ScheduledFuture<?> scheduled = attempt.scheduledFuture;
		attempt.scheduledFuture = null;
		if (scheduled != null) {
			scheduled.cancel(false);
		}
		publicationAttempts.remove(attempt.key, attempt);
	}

	private String normalize(String roomCode) {
		return roomCode.trim().toUpperCase();
	}

	private record PublicationKey(
		String roomCode,
		UUID roundId,
		long generation
	) {
	}

	private static final class PublicationAttempt {

		private final PublicationKey key;
		private final FinalizedRoomRound storedResult;
		private final RoomEventEnvelope<PublicRoundResult> event;
		private int attempts;
		private long scheduleVersion;
		private ScheduledFuture<?> scheduledFuture;
		private boolean finished;

		private PublicationAttempt(
			PublicationKey key,
			FinalizedRoomRound storedResult,
			RoomEventEnvelope<PublicRoundResult> event
		) {
			this.key = key;
			this.storedResult = storedResult;
			this.event = event;
		}
	}
}
