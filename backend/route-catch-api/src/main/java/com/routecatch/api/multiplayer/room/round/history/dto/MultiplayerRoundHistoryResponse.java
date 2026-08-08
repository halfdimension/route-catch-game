package com.routecatch.api.multiplayer.room.round.history.dto;

import java.util.List;

public record MultiplayerRoundHistoryResponse(
	List<MultiplayerRoundHistoryItemResponse> content,
	int page,
	int size,
	long totalElements,
	int totalPages
) {
}
