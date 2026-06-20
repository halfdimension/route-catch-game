package com.routecatch.api.game.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.game.dto.PlayerStatsResponse;
import com.routecatch.api.game.service.GameSessionService;

@RestController
@RequestMapping("/api/game/players")
public class PlayerStatsController {

	private final GameSessionService gameSessionService;

	public PlayerStatsController(GameSessionService gameSessionService) {
		this.gameSessionService = gameSessionService;
	}

	@GetMapping("/{playerName}/stats")
	public PlayerStatsResponse getPlayerStats(
		@PathVariable String playerName
	) {
		return gameSessionService.getPlayerStats(playerName);
	}
}
