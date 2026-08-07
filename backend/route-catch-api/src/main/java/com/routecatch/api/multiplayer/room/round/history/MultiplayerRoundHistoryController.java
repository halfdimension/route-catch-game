package com.routecatch.api.multiplayer.room.round.history;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.service.CurrentUserService;
import com.routecatch.api.multiplayer.room.round.history.dto.MultiplayerRoundHistoryResponse;

@RestController
@RequestMapping("/api/multiplayer/me/rounds")
public class MultiplayerRoundHistoryController {

	private final CurrentUserService currentUserService;
	private final MultiplayerRoundHistoryService historyService;

	public MultiplayerRoundHistoryController(
		CurrentUserService currentUserService,
		MultiplayerRoundHistoryService historyService
	) {
		this.currentUserService = currentUserService;
		this.historyService = historyService;
	}

	@GetMapping
	public MultiplayerRoundHistoryResponse getHistory(
		@RequestParam(defaultValue = "0") int page,
		@RequestParam(defaultValue = "20") int size,
		Authentication authentication
	) {
		UserEntity currentUser = currentUserService.getCurrentUserEntity(
			authentication
		);
		return historyService.getHistory(currentUser.getUserId(), page, size);
	}
}
