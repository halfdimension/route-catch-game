package com.routecatch.api.multiplayer.room.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateRoomRequest(
	@NotBlank(message = "must not be blank")
	@Size(max = 80, message = "must be at most 80 characters")
	String roomName
) {
}
