package com.routecatch.api.multiplayer.room.round.history;

public class MultiplayerRoundHistoryUnavailableException
	extends RuntimeException {

	public MultiplayerRoundHistoryUnavailableException(Throwable cause) {
		super("Multiplayer round history is unavailable", cause);
	}
}
