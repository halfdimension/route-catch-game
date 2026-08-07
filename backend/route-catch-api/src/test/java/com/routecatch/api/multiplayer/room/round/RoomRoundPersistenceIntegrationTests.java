package com.routecatch.api.multiplayer.room.round;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.scheduling.TaskScheduler;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.game.persistence.CaughtCreatureRepository;
import com.routecatch.api.game.persistence.GameSessionRepository;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureInstance;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureSpawnCoordinator;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.StartRoomGameRequest;
import com.routecatch.api.multiplayer.room.event.InMemoryRoomEventSequencer;
import com.routecatch.api.multiplayer.room.event.RoomEventEnvelope;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;
import com.routecatch.api.multiplayer.room.model.RoomGameStatus;
import com.routecatch.api.multiplayer.room.movement.service.RoomMovementRoundControl;
import com.routecatch.api.multiplayer.room.round.persistence.CompletedRoundPersistenceService;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerCatchRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundPlayerRepository;
import com.routecatch.api.multiplayer.room.round.persistence.GameRoundRepository;
import com.routecatch.api.multiplayer.room.service.MultiplayerRoomService;
import com.routecatch.api.multiplayer.room.service.RoomScoreService;

@SpringBootTest
class RoomRoundPersistenceIntegrationTests {

	@Autowired
	private CompletedRoundPersistenceService persistenceService;

	@Autowired
	private GameRoundRepository roundRepository;

	@Autowired
	private GameRoundPlayerRepository playerRepository;

	@Autowired
	private GameRoundPlayerCatchRepository catchRepository;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private GameSessionRepository gameSessionRepository;

	@Autowired
	private CaughtCreatureRepository caughtCreatureRepository;

	@AfterEach
	void clearData() {
		catchRepository.deleteAll();
		playerRepository.deleteAll();
		roundRepository.deleteAll();
		caughtCreatureRepository.deleteAll();
		gameSessionRepository.deleteAll();
		userRepository.deleteAll();
	}

	@Test
	void finalizerCommitsRoundPlayersAndCatchesBeforeGameEnded() {
		UserEntity host = saveUser("host-integration", "Host Integration");
		UserEntity zero = saveUser("zero-integration", "Zero Integration");
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomScoreService scoreService = new RoomScoreService(roomService);
		InMemoryRoomRoundResultStore resultStore =
			new InMemoryRoomRoundResultStore();
		List<RoomEventEnvelope<PublicRoundResult>> events = new ArrayList<>();
		MultiplayerRoom room = roomService.createRoom(
			host,
			new CreateRoomRequest("Persistence Integration")
		);
		roomService.joinRoom(room.getRoomCode(), zero);
		roomService.startGame(
			room.getRoomCode(),
			host,
			new StartRoomGameRequest(90)
		);
		UUID roundId = room.getGameState().getRoundId();
		RoomCreatureInstance creature = new RoomCreatureInstance(
			UUID.randomUUID(),
			room.getRoomCode(),
			"integration-creature",
			"Integration Creature",
			"rare",
			30,
			28.6,
			77.2,
			Instant.now().minusSeconds(5),
			Instant.now().plusSeconds(30)
		);
		creature.markCaught(host.getUserId(), host.getDisplayName(), Instant.now());
		scoreService.recordCatch(room, host, creature);
		RoomRoundEventPublisher publisher = event -> {
			assertTrue(roundRepository.findByRoundInstanceId(roundId).isPresent());
			assertEquals(RoomGameStatus.ENDED, room.getGameState().getStatus());
			assertTrue(resultStore.find(room.getRoomCode(), roundId).isPresent());
			events.add(event);
		};
		RoomRoundFinalizationService finalizer =
			new RoomRoundFinalizationService(
				roomService,
				mock(RoomMovementRoundControl.class),
				mock(RoomCreatureService.class),
				mock(RoomCreatureSpawnCoordinator.class),
				scoreService,
				resultStore,
				persistenceService,
				new GameEndedPublicationRetryService(
					mock(TaskScheduler.class),
					new InMemoryRoomEventSequencer(),
					publisher,
					java.time.Clock.systemUTC()
				)
			);
		finalizer.registerWithRoomLifecycle();

		FinalizedRoomRound result = finalizer.finalizeRound(
			room.getRoomCode(),
			roundId,
			room.getGameState().getGeneration(),
			RoundEndReason.HOST_ENDED
		);

		var persisted = roundRepository.findByRoundInstanceId(roundId).orElseThrow();
		assertEquals(90, persisted.getDurationSeconds());
		assertEquals(2, playerRepository.countByGameRoundId(
			persisted.getGameRoundId()
		));
		assertEquals(1, catchRepository.count());
		assertSame(result, resultStore.find(room.getRoomCode(), roundId).orElseThrow());
		assertEquals(1, events.size());
		assertEquals(roundId, events.getFirst().payload().roundId());
	}

	private UserEntity saveUser(String username, String displayName) {
		return userRepository.saveAndFlush(new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			displayName,
			"hashed-password"
		));
	}
}
