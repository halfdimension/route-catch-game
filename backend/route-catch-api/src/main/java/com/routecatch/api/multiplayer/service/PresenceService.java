package com.routecatch.api.multiplayer.service;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.multiplayer.dto.PresenceResponse;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.model.PresenceSession;

@Service
public class PresenceService {

	private final Map<String, Map<UUID, PresenceResponse>> roomPresence =
		new ConcurrentHashMap<>();
	private final Map<String, PresenceSession> socketSessions =
		new ConcurrentHashMap<>();

	public List<PresenceResponse> updatePresence(
		String roomId,
		UserEntity user,
		PresenceUpdateRequest request,
		String socketSessionId
	) {
		PresenceResponse presence = new PresenceResponse(
			user.getUserId().toString(),
			user.getUsername(),
			user.getDisplayName(),
			request.lat(),
			request.lon(),
			normalizeStatus(request.status()),
			Instant.now()
		);

		roomPresence
			.computeIfAbsent(roomId, (ignored) -> new ConcurrentHashMap<>())
			.put(user.getUserId(), presence);
		trackSocketSession(socketSessionId, user.getUserId(), roomId);

		return listRoomPresence(roomId);
	}

	public List<PresenceResponse> listRoomPresence(String roomId) {
		return roomPresence
			.getOrDefault(roomId, Map.of())
			.values()
			.stream()
			.sorted(Comparator
				.comparing(PresenceResponse::displayName)
				.thenComparing(PresenceResponse::username))
			.toList();
	}

	public Map<String, List<PresenceResponse>> removeSocketSession(
		String socketSessionId
	) {
		PresenceSession session = socketSessions.remove(socketSessionId);

		if (session == null) {
			return Map.of();
		}

		Map<String, List<PresenceResponse>> updatedRooms = new LinkedHashMap<>();

		for (String roomId : session.getRoomIds()) {
			Map<UUID, PresenceResponse> presenceByUser = roomPresence.get(roomId);

			if (presenceByUser == null) {
				continue;
			}

			presenceByUser.remove(session.getUserId());

			if (presenceByUser.isEmpty()) {
				roomPresence.remove(roomId);
				updatedRooms.put(roomId, List.of());
			} else {
				updatedRooms.put(roomId, listRoomPresence(roomId));
			}
		}

		return updatedRooms;
	}

	private void trackSocketSession(
		String socketSessionId,
		UUID userId,
		String roomId
	) {
		if (socketSessionId == null || socketSessionId.isBlank()) {
			return;
		}

		socketSessions
			.computeIfAbsent(socketSessionId, (ignored) -> new PresenceSession(userId))
			.addRoom(roomId);
	}

	private String normalizeStatus(String status) {
		if (status == null || status.isBlank()) {
			return "IDLE";
		}

		return status.trim();
	}
}
