package com.routecatch.api.game.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.game.dto.CaughtCreatureResponse;
import com.routecatch.api.game.dto.CreateGameSessionRequest;
import com.routecatch.api.game.dto.GameSessionResponse;
import com.routecatch.api.game.dto.SubmitCatchRequest;
import com.routecatch.api.game.dto.SubmitCatchResponse;
import com.routecatch.api.game.service.GameSessionService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/game/sessions")
public class GameSessionController {

	private final GameSessionService gameSessionService;

	public GameSessionController(GameSessionService gameSessionService) {
		this.gameSessionService = gameSessionService;
	}

	@PostMapping
	public GameSessionResponse createSession(
		@Valid @RequestBody CreateGameSessionRequest request
	) {
		return GameSessionResponse.from(
			gameSessionService.createSession(
				request.durationSeconds(),
				request.playerName()
			)
		);
	}

	@GetMapping
	public List<GameSessionResponse> listRecentSessions(
		@RequestParam(defaultValue = "20") int limit
	) {
		return gameSessionService.listRecentSessions(limit)
			.stream()
			.map(GameSessionResponse::from)
			.toList();
	}

	@GetMapping("/{sessionId}")
	public GameSessionResponse getSession(@PathVariable UUID sessionId) {
		return GameSessionResponse.from(gameSessionService.getSession(sessionId));
	}

	@GetMapping("/{sessionId}/catches")
	public List<CaughtCreatureResponse> listCatchesForSession(
		@PathVariable UUID sessionId
	) {
		return gameSessionService.listCatchesForSession(sessionId);
	}

	@PostMapping("/{sessionId}/start")
	public GameSessionResponse startSession(@PathVariable UUID sessionId) {
		return GameSessionResponse.from(gameSessionService.startSession(sessionId));
	}

	@PostMapping("/{sessionId}/end")
	public GameSessionResponse endSession(@PathVariable UUID sessionId) {
		return GameSessionResponse.from(gameSessionService.endSession(sessionId));
	}

	@PostMapping("/{sessionId}/catches")
	public SubmitCatchResponse submitCatch(
		@PathVariable UUID sessionId,
		@Valid @RequestBody SubmitCatchRequest request
	) {
		return gameSessionService.submitCatch(sessionId, request);
	}
}
