package com.routecatch.api.game.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.game.dto.LeaderboardEntryResponse;
import com.routecatch.api.game.service.GameSessionService;

@RestController
@RequestMapping("/api/game/leaderboard")
public class GameLeaderboardController {

	private final GameSessionService gameSessionService;

	public GameLeaderboardController(GameSessionService gameSessionService) {
		this.gameSessionService = gameSessionService;
	}

	@GetMapping
	public List<LeaderboardEntryResponse> getLeaderboard(
		@RequestParam(defaultValue = "10") int limit
	) {
		return gameSessionService.getLeaderboard(limit);
	}
}
