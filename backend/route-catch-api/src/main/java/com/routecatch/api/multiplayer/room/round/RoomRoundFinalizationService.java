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
import java.util.Set;
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
	private final RoomEventSequencer eventSequencer;
	private final RoomRoundEventPublisher eventPublisher;
	private final Clock clock;
	private final Set<UUID> publishedRoundIds = ConcurrentHashMap.newKeySet();

	@Autowired
	public RoomRoundFinalizationService(
		MultiplayerRoomService roomService,
		RoomMovementRoundControl movementService,
		RoomCreatureService creatureService,
		RoomCreatureSpawnCoordinator spawnCoordinator,
		RoomScoreService scoreService,
		RoomRoundResultStore resultStore,
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
		FinalizedRoomRound existing = resultStore
			.find(roomCode, expectedRoundId)
			.orElse(null);

		if (existing != null) {
			LOGGER.info(
				"duplicate finalization ignored roomCode={} roundId={} generation={}",
				roomCode,
				expectedRoundId,
				expectedGeneration
			);
			return existing;
		}

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

		if (state.getStatus() == RoomGameStatus.FINALIZING) {
			throw roundError(
				"ROUND_RESULT_NOT_READY",
				"Round result is still being finalized",
				HttpStatus.CONFLICT
			);
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
		LOGGER.info(
			"round transition RUNNING -> FINALIZING roomCode={} roundId={} generation={}",
			roomCode,
			expectedRoundId,
			expectedGeneration
		);

		try {
			int frozenMovements = movementService.freezeRound(
				roomCode,
				expectedRoundId,
				expectedGeneration,
				endedAt
			);
			int invalidatedCreatures = creatureService.freezeRound(
				roomCode,
				expectedGeneration
			);
			spawnCoordinator.stop(roomCode, expectedGeneration, "FINALIZING");
			roomService.publishLifecycle(
				room,
				RoomGameLifecycleEvent.Type.FINALIZING
			);

			List<RoundPlayerScoreSnapshot> scores =
				scoreService.snapshotRound(room);
			FinalizedRoomRound result = buildResult(
				room,
				scores,
				endedAt,
				reason
			);

			state.end(endedAt);
			if (reason == RoundEndReason.ROOM_CLOSED) {
				room.close();
			} else {
				room.markOpen();
			}

			FinalizedRoomRound stored = resultStore.saveIfAbsent(result);
			LOGGER.info(
				"round result stored roomCode={} roundId={} generation={} frozenMovements={} invalidatedCreatures={} participants={}",
				roomCode,
				expectedRoundId,
				expectedGeneration,
				frozenMovements,
				invalidatedCreatures,
				scores.size()
			);
			roomService.publishLifecycle(
				room,
				reason == RoundEndReason.ROOM_CLOSED
					? RoomGameLifecycleEvent.Type.CLOSED
					: RoomGameLifecycleEvent.Type.STOPPED
			);
			publishGameEnded(stored);
			return stored;
		} catch (RuntimeException exception) {
			LOGGER.error(
				"round finalization failed roomCode={} roundId={} generation={} reason={}",
				roomCode,
				expectedRoundId,
				expectedGeneration,
				reason,
				exception
			);
			throw exception;
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

		if (publishedRoundIds.contains(roundId)) {
			return;
		}

		PublicRoundResult payload = result.publicResult();
		eventPublisher.publish(new RoomEventEnvelope<>(
			UUID.randomUUID(),
			payload.roomCode(),
			eventSequencer.next(payload.roomCode()),
			RoomEventType.GAME_ENDED,
			Instant.now(clock),
			payload
		));
		publishedRoundIds.add(roundId);
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
}
