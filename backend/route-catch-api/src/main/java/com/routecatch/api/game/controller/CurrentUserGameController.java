package com.routecatch.api.game.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.service.CurrentUserService;
import com.routecatch.api.game.dto.CaughtCreatureResponse;
import com.routecatch.api.game.dto.GameSessionResponse;
import com.routecatch.api.game.dto.PlayerStatsResponse;
import com.routecatch.api.game.service.GameSessionService;

@RestController
@RequestMapping("/api/game/me")
public class CurrentUserGameController {

	private final CurrentUserService currentUserService;
	private final GameSessionService gameSessionService;

	public CurrentUserGameController(
		CurrentUserService currentUserService,
		GameSessionService gameSessionService
	) {
		this.currentUserService = currentUserService;
		this.gameSessionService = gameSessionService;
	}

	@GetMapping("/stats")
	public PlayerStatsResponse getCurrentUserStats(
		Authentication authentication
	) {
		return gameSessionService.getCurrentUserStats(currentUser(authentication));
	}

	@GetMapping("/sessions")
	public List<GameSessionResponse> listCurrentUserSessions(
		@RequestParam(defaultValue = "20") int limit,
		Authentication authentication
	) {
		return gameSessionService
			.listCurrentUserSessions(currentUser(authentication), limit)
			.stream()
			.map(GameSessionResponse::from)
			.toList();
	}

	@GetMapping("/sessions/{sessionId}/catches")
	public List<CaughtCreatureResponse> listCurrentUserSessionCatches(
		@PathVariable UUID sessionId,
		Authentication authentication
	) {
		return gameSessionService.listCatchesForCurrentUserSession(
			currentUser(authentication),
			sessionId
		);
	}

	private UserEntity currentUser(Authentication authentication) {
		return currentUserService.getCurrentUserEntity(authentication);
	}
}
