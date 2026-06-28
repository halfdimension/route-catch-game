package com.routecatch.api.multiplayer.room.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.room.dto.CreateRoomRequest;
import com.routecatch.api.multiplayer.room.dto.RoomScoreboardResponse;
import com.routecatch.api.multiplayer.room.model.MultiplayerRoom;

class RoomScoreServiceTests {

	@Test
	void scoreboardSortsByScoreDescending() {
		MultiplayerRoomService roomService = new MultiplayerRoomService();
		RoomScoreService scoreService = new RoomScoreService(roomService);
		UserEntity host = user("host", "Host");
		UserEntity member = user("member", "Member");
		MultiplayerRoom room = roomService.createRoom(
			host,
			new CreateRoomRequest("Delhi Room")
		);
		roomService.joinRoom(room.getRoomCode(), member);

		scoreService.awardCatch(
			room,
			host,
			10,
			Instant.parse("2026-06-25T10:00:00Z")
		);
		scoreService.awardCatch(
			room,
			member,
			20,
			Instant.parse("2026-06-25T10:01:00Z")
		);

		RoomScoreboardResponse scoreboard = scoreService.getScoreboard(
			room.getRoomCode(),
			host
		);

		assertEquals(member.getUserId(), scoreboard.entries().get(0).userId());
		assertEquals(20, scoreboard.entries().get(0).score());
		assertEquals(host.getUserId(), scoreboard.entries().get(1).userId());
		assertEquals(10, scoreboard.entries().get(1).score());
	}

	private UserEntity user(String username, String displayName) {
		return new UserEntity(
			UUID.randomUUID(),
			username,
			username + "@example.com",
			displayName,
			"hashed-password"
		);
	}
}
