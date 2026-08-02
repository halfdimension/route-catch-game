package com.routecatch.api.multiplayer.room.round;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureSpawnCoordinator;
import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.event.RoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventType;
import com.routecatch.api.multiplayer.room.event.RoomGameLifecycleEvent;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomGameState;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.movement.service.RoomMovementRoundControl;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceCommand;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceOutcome;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceService;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;

import jakarta.annotation.PostConstruct;

@Service
public class RoomRoundFinalizationService
	implements RoomRoundFinalizationGateway {

	private static final Logger LOGGER = LoggerFactory.getLogger(
		RoomRoundFinalizationService.class
	);

	private final MultiplayerRoomService roomService;
	private final RoomMovementRoundControl movementService;
	private final RoomCreatureService creatureService;
	private final RoomCreatureSpawnCoordinator spawnCoordinator;
	private final RoomScoreService scoreService;
	private final RoomRoundResultStore resultStore;
	private final CompletedRoundPersistenceService persistenceService;
	private final RoomEventSequencer eventSequencer;
	private final RoomRoundEventPublisher eventPublisher;
	private final Clock clock;
	private final RecentRoundPublicationTracker publishedRounds =
		new RecentRoundPublicationTracker(
			InMemoryRoomRoundResultStore.MAX_RESULTS_PER_ROOM
		);
	private final Map<FinalizationKey, FinalizationContext> finalizationContexts =
		new ConcurrentHashMap<>();

	@Autowired
	public RoomRoundFinalizationService(
		MultiplayerRoomService roomService,
		RoomMovementRoundControl movementService,
		RoomCreatureService creatureService,
		RoomCreatureSpawnCoordinator spawnCoordinator,
		RoomScoreService scoreService,
		RoomRoundResultStore resultStore,
		CompletedRoundPersistenceService persistenceService,
		RoomEventSequencer eventSequencer,
		RoomRoundEventPublisher eventPublisher
	) {
		this(
			roomService,
			movementService,
			creatureService,
			spawnCoordinator,
			scoreService,
			resultStore,
			persistenceService,
			eventSequencer,
			eventPublisher,
			Clock.systemUTC()
		);
	}

	RoomRoundFinalizationService(
		MultiplayerRoomService roomService,
		RoomMovementRoundControl movementService,
		RoomCreatureService creatureService,
		RoomCreatureSpawnCoordinator spawnCoordinator,
		RoomScoreService scoreService,
		RoomRoundResultStore resultStore,
		CompletedRoundPersistenceService persistenceService,
		RoomEventSequencer eventSequencer,
		RoomRoundEventPublisher eventPublisher,
		Clock clock
	) {
		this.roomService = roomService;
		this.movementService = movementService;
		this.creatureService = creatureService;
		this.spawnCoordinator = spawnCoordinator;
		this.scoreService = scoreService;
		this.resultStore = resultStore;
		this.persistenceService = persistenceService;
		this.eventSequencer = eventSequencer;
		this.eventPublisher = eventPublisher;
		this.clock = clock;
	}

	@PostConstruct
	void registerWithRoomLifecycle() {
		roomService.registerFinalizationGateway(this);
	}

	@Override
	public FinalizedRoomRound finalizeRound(
		String roomCode,
		UUID expectedRoundId,
		long expectedGeneration,
		RoundEndReason reason
	) {
		String normalizedRoomCode = roomCode.trim().toUpperCase();
		LOGGER.info(
			"round finalization requested roomCode={} roundId={} generation={} reason={}",
			normalizedRoomCode,
			expectedRoundId,
			expectedGeneration,
			reason
		);

		return roomService.getRoundCoordinator().withRoom(
			normalizedRoomCode,
			() -> finalizeCoordinated(
				normalizedRoomCode,
				expectedRoundId,
				expectedGeneration,
				reason
			)
		);
	}

	private FinalizedRoomRound finalizeCoordinated(
		String roomCode,
		UUID expectedRoundId,
		long expectedGeneration,
		RoundEndReason reason
	) {
		MultiplayerRoom room = roomService.getRoom(roomCode);
		RoomGameState state = room.getGameState();

		if (
			state.getGeneration() != expectedGeneration ||
			!expectedRoundId.equals(state.getRoundId())
		) {
			LOGGER.info(
				"stale finalization ignored roomCode={} roundId={} generation={} currentRoundId={} currentGeneration={}",
				roomCode,
				expectedRoundId,
				expectedGeneration,
				state.getRoundId(),
				state.getGeneration()
			);
			throw roundError(
				"STALE_ROUND_GENERATION",
				"Finalization belongs to an older room round",
				HttpStatus.CONFLICT
			);
		}

		FinalizedRoomRound existing = resultStore
			.find(roomCode, expectedRoundId)
			.orElse(null);

		if (existing != null) {
			LOGGER.info(
				"duplicate finalization reusing result roomCode={} roundId={} generation={}",
				roomCode,
				expectedRoundId,
				expectedGeneration
			);
			publishGameEnded(existing);
			return existing;
		}

		FinalizationKey key = new FinalizationKey(
			roomCode,
			expectedRoundId,
			expectedGeneration
		);

		if (state.getStatus() == RoomGameStatus.FINALIZING) {
			FinalizationContext context = finalizationContexts.get(key);
			if (context == null) {
				throw roundError(
					"ROUND_RESULT_NOT_READY",
					"Round result is still being finalized",
					HttpStatus.CONFLICT
				);
			}
			context.upgradeDisposition(reason);
			return resumeFinalization(room, context);
		}
		if (state.getStatus() == RoomGameStatus.ENDED) {
			throw roundError(
				"ROUND_ALREADY_ENDED",
				"Round has already ended",
				HttpStatus.CONFLICT
			);
		}
		if (state.getStatus() != RoomGameStatus.RUNNING) {
			throw roundError(
				"ROUND_NOT_RUNNING",
				"Round is not running",
				HttpStatus.CONFLICT
			);
		}

		if (!state.beginFinalizing(expectedRoundId, expectedGeneration)) {
			throw roundError(
				"STALE_ROUND_GENERATION",
				"Round changed before finalization could start",
				HttpStatus.CONFLICT
			);
		}

		Instant endedAt = reason == RoundEndReason.TIME_EXPIRED
			? state.getEndsAt()
			: Instant.now(clock);
		FinalizationContext context = new FinalizationContext(
			key,
			reason,
			endedAt,
			state.getDurationSeconds(),
			RoomDisposition.forReason(reason)
		);
		finalizationContexts.put(key, context);
		LOGGER.info(
			"round transition RUNNING -> FINALIZING roomCode={} roundId={} generation={}",
			roomCode,
			expectedRoundId,
			expectedGeneration
		);

		return resumeFinalization(room, context);
	}

	private FinalizedRoomRound resumeFinalization(
		MultiplayerRoom room,
		FinalizationContext context
	) {
		try {
			prepareResult(room, context);
		} catch (RuntimeException exception) {
			LOGGER.error(
				"round finalization failed roomCode={} roundId={} generation={} reason={} failureType={}",
				context.key().roomCode(),
				context.key().roundId(),
				context.key().generation(),
				context.endReason(),
				exception.getClass().getSimpleName()
			);
			throw roundError(
				"ROUND_FINALIZATION_UNAVAILABLE",
				"Round result could not be prepared for durable finalization",
				HttpStatus.SERVICE_UNAVAILABLE
			);
		}

		return completeFinalization(room, context);
	}

	private void prepareResult(
		MultiplayerRoom room,
		FinalizationContext context
	) {
		FinalizationKey key = context.key();
		if (!context.finalizingLifecyclePublished()) {
			roomService.publishLifecycle(
				room,
				RoomGameLifecycleEvent.Type.FINALIZING
			);
			context.markFinalizingLifecyclePublished();
		}
		if (!context.movementsFrozen()) {
			context.markMovementsFrozen(movementService.freezeRound(
				key.roomCode(),
				key.roundId(),
				key.generation(),
				context.endedAt()
			));
		}
		if (!context.creaturesInvalidated()) {
			context.markCreaturesInvalidated(creatureService.freezeRound(
				key.roomCode(),
				key.generation()
			));
		}
		if (!context.spawnStopped()) {
			spawnCoordinator.stop(
				key.roomCode(),
				key.generation(),
				"FINALIZING"
			);
			context.markSpawnStopped();
		}
		if (context.result() == null) {
			List<RoundPlayerScoreSnapshot> scores = scoreService.snapshotRound(room);
			context.cacheResult(buildResult(
				room,
				scores,
				context.endedAt(),
				context.endReason()
			));
		}
	}

	private FinalizedRoomRound completeFinalization(
		MultiplayerRoom room,
		FinalizationContext context
	) {
		FinalizedRoomRound result = context.result();
		PublicRoundResult publicResult = result.publicResult();
		String roomCode = publicResult.roomCode();
		UUID roundId = publicResult.roundId();

		persistCompletedRound(roomCode, result.generation(), context);

		RoomGameState state = room.getGameState();
		state.end(publicResult.endedAt());
		FinalizedRoomRound stored = resultStore.saveIfAbsent(result);
		if (context.disposition() == RoomDisposition.CLOSE_ROOM) {
			room.close();
		} else {
			room.markOpen();
		}

		finalizationContexts.remove(context.key(), context);
		LOGGER.info(
			"round result committed and stored roomCode={} roundId={} generation={} frozenMovements={} invalidatedCreatures={} participants={}",
			roomCode,
			roundId,
			result.generation(),
			context.frozenMovements(),
			context.invalidatedCreatures(),
			publicResult.playerCount()
		);
		roomService.publishLifecycle(
			room,
			context.disposition() == RoomDisposition.CLOSE_ROOM
				? RoomGameLifecycleEvent.Type.CLOSED
				: RoomGameLifecycleEvent.Type.STOPPED
		);
		publishGameEnded(stored);
		return stored;
	}

	private void persistCompletedRound(
		String roomCode,
		long generation,
		FinalizationContext context
	) {
		UUID roundId = context.result().publicResult().roundId();

		try {
			CompletedRoundPersistenceOutcome outcome = persistenceService
				.persistIfAbsent(new CompletedRoundPersistenceCommand(
					context.result(),
					context.durationSeconds()
				));
			if (!roundId.equals(outcome.roundInstanceId())) {
				throw new IllegalStateException(
					"Persistence outcome identified a different round"
				);
			}
		} catch (RuntimeException exception) {
			LOGGER.error(
				"round persistence failed roomCode={} roundId={} generation={} reason={} failureType={}",
				roomCode,
				roundId,
				generation,
				context.result().publicResult().endReason(),
				exception.getClass().getSimpleName()
			);
			throw roundError(
				"ROUND_PERSISTENCE_UNAVAILABLE",
				"Round result could not be durably finalized",
				HttpStatus.SERVICE_UNAVAILABLE
			);
		}
	}

	private FinalizedRoomRound buildResult(
		MultiplayerRoom room,
		List<RoundPlayerScoreSnapshot> snapshots,
		Instant endedAt,
		RoundEndReason reason
	) {
		List<RankedPlayer> rankedPlayers = rank(snapshots);
		List<RoundLeaderboardEntry> leaderboard = rankedPlayers.stream()
			.map(RankedPlayer::leaderboardEntry)
			.toList();
		RoomGameState state = room.getGameState();
		PublicRoundResult publicResult = new PublicRoundResult(
			state.getRoundId(),
			room.getRoomCode(),
			state.getStartedAt(),
			endedAt,
			reason,
			leaderboard.size(),
			leaderboard
		);
		Map<UUID, PersonalRoundResult> personalResults = new LinkedHashMap<>();

		for (RankedPlayer ranked : rankedPlayers) {
			RoundPlayerScoreSnapshot snapshot = ranked.snapshot();
			List<CaughtCreatureResult> caughtCreatures =
				snapshot.caughtCreatures().stream()
					.map(CaughtCreatureResult::from)
					.toList();
			Map<String, Integer> rarityCounts = new HashMap<>();
			caughtCreatures.forEach(caught ->
				rarityCounts.merge(caught.rarity(), 1, Integer::sum)
			);
			personalResults.put(
				snapshot.playerId(),
				new PersonalRoundResult(
					state.getRoundId(),
					room.getRoomCode(),
					snapshot.playerId(),
					snapshot.displayName(),
					ranked.score(),
					ranked.rank(),
					leaderboard.size(),
					caughtCreatures.size(),
					rarityCounts,
					caughtCreatures,
					state.getStartedAt(),
					endedAt,
					reason
				)
			);
		}

		return new FinalizedRoomRound(
			state.getGeneration(),
			publicResult,
			personalResults
		);
	}

	private List<RankedPlayer> rank(
		List<RoundPlayerScoreSnapshot> snapshots
	) {
		List<RoundPlayerScoreSnapshot> ordered = new ArrayList<>(snapshots);
		ordered.sort(
			Comparator
				.comparingInt(this::authoritativeScore)
				.reversed()
				.thenComparing(
					Comparator.comparingInt(
						RoundPlayerScoreSnapshot::creaturesCaught
					).reversed()
				)
				.thenComparing(snapshot ->
					snapshot.displayName().toLowerCase(Locale.ROOT)
				)
				.thenComparing(snapshot -> snapshot.playerId().toString())
		);
		List<RankedPlayer> ranked = new ArrayList<>();
		Integer previousScore = null;
		int currentRank = 0;

		for (int index = 0; index < ordered.size(); index += 1) {
			RoundPlayerScoreSnapshot snapshot = ordered.get(index);
			int score = authoritativeScore(snapshot);

			if (previousScore == null || score != previousScore) {
				currentRank = index + 1;
				previousScore = score;
			}

			ranked.add(new RankedPlayer(snapshot, score, currentRank));
		}

		return List.copyOf(ranked);
	}

	private int authoritativeScore(RoundPlayerScoreSnapshot snapshot) {
		return snapshot.caughtCreatures().stream()
			.mapToInt(CaughtCreatureRecord::scoreAwarded)
			.sum();
	}

	private void publishGameEnded(FinalizedRoomRound result) {
		UUID roundId = result.publicResult().roundId();
		String roomCode = result.publicResult().roomCode();

		if (publishedRounds.isPublished(roomCode, roundId)) {
			return;
		}

		PublicRoundResult payload = result.publicResult();
		try {
			eventPublisher.publish(new RoomEventEnvelope<>(
				UUID.randomUUID(),
				payload.roomCode(),
				eventSequencer.next(payload.roomCode()),
				RoomEventType.GAME_ENDED,
				Instant.now(clock),
				payload
			));
		} catch (RuntimeException exception) {
			LOGGER.error(
				"GAME_ENDED publication failed roomCode={} roundId={} generation={} failureType={}",
				payload.roomCode(),
				roundId,
				result.generation(),
				exception.getClass().getSimpleName()
			);
			throw exception;
		}
		publishedRounds.markPublished(roomCode, roundId);
	}

	boolean hasFinalizationContext(
		String roomCode,
		UUID roundId,
		long generation
	) {
		return finalizationContexts.containsKey(new FinalizationKey(
			roomCode.trim().toUpperCase(),
			roundId,
			generation
		));
	}

	boolean closesRoomAfterFinalization(
		String roomCode,
		UUID roundId,
		long generation
	) {
		FinalizationContext context = finalizationContexts.get(
			new FinalizationKey(
				roomCode.trim().toUpperCase(),
				roundId,
				generation
			)
		);
		return context != null &&
			context.disposition() == RoomDisposition.CLOSE_ROOM;
	}

	private RoundLifecycleException roundError(
		String code,
		String message,
		HttpStatus status
	) {
		return new RoundLifecycleException(code, message, status);
	}

	private record RankedPlayer(
		RoundPlayerScoreSnapshot snapshot,
		int score,
		int rank
	) {

		private RoundLeaderboardEntry leaderboardEntry() {
			return new RoundLeaderboardEntry(
				snapshot.playerId(),
				snapshot.displayName(),
				score,
				rank,
				snapshot.creaturesCaught()
			);
		}
	}

	private enum RoomDisposition {
		KEEP_OPEN,
		CLOSE_ROOM;

		private static RoomDisposition forReason(RoundEndReason reason) {
			return reason == RoundEndReason.ROOM_CLOSED
				? CLOSE_ROOM
				: KEEP_OPEN;
		}
	}

	private record FinalizationKey(
		String roomCode,
		UUID roundId,
		long generation
	) {
	}

	private static final class FinalizationContext {

		private final FinalizationKey key;
		private final RoundEndReason endReason;
		private final Instant endedAt;
		private final int durationSeconds;
		private RoomDisposition disposition;
		private boolean finalizingLifecyclePublished;
		private boolean movementsFrozen;
		private int frozenMovements;
		private boolean creaturesInvalidated;
		private int invalidatedCreatures;
		private boolean spawnStopped;
		private FinalizedRoomRound result;

		private FinalizationContext(
			FinalizationKey key,
			RoundEndReason endReason,
			Instant endedAt,
			int durationSeconds,
			RoomDisposition disposition
		) {
			this.key = key;
			this.endReason = endReason;
			this.endedAt = endedAt;
			this.durationSeconds = durationSeconds;
			this.disposition = disposition;
		}

		private void upgradeDisposition(RoundEndReason requestedReason) {
			if (requestedReason == RoundEndReason.ROOM_CLOSED) {
				disposition = RoomDisposition.CLOSE_ROOM;
			}
		}

		private void markFinalizingLifecyclePublished() {
			finalizingLifecyclePublished = true;
		}

		private void markMovementsFrozen(int count) {
			frozenMovements = count;
			movementsFrozen = true;
		}

		private void markCreaturesInvalidated(int count) {
			invalidatedCreatures = count;
			creaturesInvalidated = true;
		}

		private void markSpawnStopped() {
			spawnStopped = true;
		}

		private void cacheResult(FinalizedRoomRound finalizedRound) {
			if (result == null) {
				result = finalizedRound;
			}
		}

		private FinalizationKey key() {
			return key;
		}

		private RoundEndReason endReason() {
			return endReason;
		}

		private Instant endedAt() {
			return endedAt;
		}

		private int durationSeconds() {
			return durationSeconds;
		}

		private RoomDisposition disposition() {
			return disposition;
		}

		private boolean finalizingLifecyclePublished() {
			return finalizingLifecyclePublished;
		}

		private boolean movementsFrozen() {
			return movementsFrozen;
		}

		private int frozenMovements() {
			return frozenMovements;
		}

		private boolean creaturesInvalidated() {
			return creaturesInvalidated;
		}

		private int invalidatedCreatures() {
			return invalidatedCreatures;
		}

		private boolean spawnStopped() {
			return spawnStopped;
		}

		private FinalizedRoomRound result() {
			return result;
		}
	}
}
