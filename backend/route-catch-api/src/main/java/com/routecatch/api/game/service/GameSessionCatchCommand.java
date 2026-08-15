package com.routecatch.api.game.service;

import java.util.UUID;

record GameSessionCatchCommand(
	UUID sessionId,
	UUID catchId,
	String creatureId,
	UUID authenticatedUserId
) {
}
