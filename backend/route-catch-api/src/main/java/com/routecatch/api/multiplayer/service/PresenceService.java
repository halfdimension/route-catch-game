package com.routecatch.api.multiplayer.service;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.dto.CoordinateDto;
import com.routecatch.api.multiplayer.dto.PresenceResponse;
import com.routecatch.api.multiplayer.dto.PresenceUpdateRequest;
import com.routecatch.api.multiplayer.model.PresenceSession;

@Service
public class PresenceService {
	private static final int ROOM_LOCK_COUNT = 64;
	private static final int SOCKET_SESSION_LOCK_COUNT = 64;

	private final Map<String, Map<UUID, StoredPresence>> roomPresence =
		new ConcurrentHashMap<>();
	private final Map<String, PresenceSession> socketSessions =
		new ConcurrentHashMap<>();
	private final Set<String> activeSocketSessions = ConcurrentHashMap.newKeySet();
	private final Object[] roomLocks = createLocks(ROOM_LOCK_COUNT);
	private final Object[] socketSessionLocks = createLocks(
		SOCKET_SESSION_LOCK_COUNT
	);

	public void registerSocketSession(String socketSessionId) {
		if (socketSessionId == null || socketSessionId.isBlank()) {
			return;
		}

		synchronized (socketSessionLock(socketSessionId)) {
			activeSocketSessions.add(socketSessionId);
		}
	}

	public List<PresenceResponse> updatePresence(
		String roomId,
		UserEntity user,
		PresenceUpdateRequest request,
		String socketSessionId
	) {
		return withRoomLock(roomId, () -> {
			if (!trackActiveSocketSession(
				socketSessionId,
				user.getUserId(),
				roomId
			)) {
				return listRoomPresence(roomId);
			}

			AtomicReference<List<PresenceResponse>> updatedPresence =
				new AtomicReference<>(List.of());

			roomPresence.compute(roomId, (ignored, currentPresence) -> {
				Map<UUID, StoredPresence> presenceByUser = currentPresence == null
					? new ConcurrentHashMap<>()
					: currentPresence;

				presenceByUser.compute(user.getUserId(), (userId, storedPresence) -> {
					PresenceResponse presence = new PresenceResponse(
						userId.toString(),
						user.getUsername(),
						user.getDisplayName(),
						request.lat(),
						request.lon(),
						normalizeStatus(request.status()),
						nextTimestamp(storedPresence)
					);

					return new StoredPresence(presence, socketSessionId);
				});

				updatedPresence.set(sortedPresence(presenceByUser));
				return presenceByUser;
			});

			return updatedPresence.get();
		});
	}

	public List<PresenceResponse> listRoomPresence(String roomId) {
		return roomPresence
			.getOrDefault(roomId, Map.of())
			.values()
			.stream()
			.map(StoredPresence::presence)
			.sorted(Comparator
				.comparing(PresenceResponse::displayName)
				.thenComparing(PresenceResponse::username))
			.toList();
	}

	public Optional<CoordinateDto> findValidPlayerPosition(
		String roomId,
		UUID userId
	) {
		if (roomId == null || roomId.isBlank() || userId == null) {
			return Optional.empty();
		}

		StoredPresence storedPresence = storedPresence(roomId, userId);

		if (storedPresence == null) {
			String normalizedRoomId = normalizeRoomId(roomId);
			storedPresence = storedPresence(normalizedRoomId, userId);

			if (storedPresence == null) {
				storedPresence = roomPresence
					.entrySet()
					.stream()
					.filter((entry) ->
						normalizeRoomId(entry.getKey()).equals(normalizedRoomId)
					)
					.map((entry) -> entry.getValue().get(userId))
					.filter(Objects::nonNull)
					.max(Comparator.comparing((presence) ->
						presence.presence().lastSeenAt()
					))
					.orElse(null);
			}
		}

		if (storedPresence == null) {
			return Optional.empty();
		}

		PresenceResponse presence = storedPresence.presence();
		Double latitude = presence.lat();
		Double longitude = presence.lon();

		if (!isValidCoordinate(latitude, longitude)) {
			return Optional.empty();
		}

		return Optional.of(new CoordinateDto(latitude, longitude));
	}

	public Map<String, List<PresenceResponse>> removeSocketSession(
		String socketSessionId
	) {
		Map<String, List<PresenceResponse>> updatedRooms = new LinkedHashMap<>();
		removeSocketSession(socketSessionId, updatedRooms::put);
		return updatedRooms;
	}

	public void removeSocketSession(
		String socketSessionId,
		BiConsumer<String, List<PresenceResponse>> roomUpdateHandler
	) {
		if (socketSessionId == null || socketSessionId.isBlank()) {
			return;
		}

		PresenceSession session;

		synchronized (socketSessionLock(socketSessionId)) {
			activeSocketSessions.remove(socketSessionId);
			session = socketSessions.remove(socketSessionId);
		}

		if (session == null) {
			return;
		}

		for (String roomId : session.getRoomIds()) {
			withRoomLock(roomId, () -> {
				AtomicBoolean removedPresence = new AtomicBoolean(false);
				AtomicReference<List<PresenceResponse>> updatedPresence =
					new AtomicReference<>(List.of());

				roomPresence.computeIfPresent(roomId, (ignored, presenceByUser) -> {
					presenceByUser.computeIfPresent(
						session.getUserId(),
						(userId, storedPresence) -> {
							if (!storedPresence.isOwnedBy(socketSessionId)) {
								return storedPresence;
							}

							removedPresence.set(true);
							return null;
						}
					);

					if (!removedPresence.get()) {
						return presenceByUser;
					}

					updatedPresence.set(sortedPresence(presenceByUser));
					return presenceByUser.isEmpty() ? null : presenceByUser;
				});

				if (removedPresence.get()) {
					roomUpdateHandler.accept(roomId, updatedPresence.get());
				}

				return null;
			});
		}
	}

	public <T> T withRoomLock(String roomId, Supplier<T> action) {
		synchronized (lockFor(roomId, roomLocks)) {
			return action.get();
		}
	}

	private boolean trackActiveSocketSession(
		String socketSessionId,
		UUID userId,
		String roomId
	) {
		if (socketSessionId == null || socketSessionId.isBlank()) {
			return false;
		}

		synchronized (socketSessionLock(socketSessionId)) {
			if (!activeSocketSessions.contains(socketSessionId)) {
				return false;
			}

			socketSessions
				.computeIfAbsent(
					socketSessionId,
					(ignored) -> new PresenceSession(userId)
				)
				.addRoom(roomId);
			return true;
		}
	}

	private Object socketSessionLock(String socketSessionId) {
		return lockFor(socketSessionId, socketSessionLocks);
	}

	private StoredPresence storedPresence(String roomId, UUID userId) {
		Map<UUID, StoredPresence> presenceByUser = roomPresence.get(roomId);

		if (presenceByUser == null) {
			return null;
		}

		return presenceByUser.get(userId);
	}

	private Object lockFor(String key, Object[] locks) {
		return locks[Math.floorMod(key.hashCode(), locks.length)];
	}

	private Object[] createLocks(int lockCount) {
		Object[] locks = new Object[lockCount];

		for (int index = 0; index < locks.length; index += 1) {
			locks[index] = new Object();
		}

		return locks;
	}

	private String normalizeStatus(String status) {
		if (status == null || status.isBlank()) {
			return "IDLE";
		}

		return status.trim();
	}

	private String normalizeRoomId(String roomId) {
		return roomId.trim().toUpperCase(Locale.ROOT);
	}

	private boolean isValidCoordinate(Double latitude, Double longitude) {
		return latitude != null
			&& longitude != null
			&& Double.isFinite(latitude)
			&& Double.isFinite(longitude)
			&& latitude >= -90.0
			&& latitude <= 90.0
			&& longitude >= -180.0
			&& longitude <= 180.0;
	}

	private Instant nextTimestamp(StoredPresence storedPresence) {
		Instant timestamp = Instant.now();

		if (
			storedPresence != null &&
			!timestamp.isAfter(storedPresence.presence().lastSeenAt())
		) {
			return storedPresence.presence().lastSeenAt().plusNanos(1);
		}

		return timestamp;
	}

	private List<PresenceResponse> sortedPresence(
		Map<UUID, StoredPresence> presenceByUser
	) {
		return presenceByUser
			.values()
			.stream()
			.map(StoredPresence::presence)
			.sorted(Comparator
				.comparing(PresenceResponse::displayName)
				.thenComparing(PresenceResponse::username))
			.toList();
	}

	private record StoredPresence(
		PresenceResponse presence,
		String socketSessionId
	) {
		private boolean isOwnedBy(String sessionId) {
			return socketSessionId != null && socketSessionId.equals(sessionId);
		}
	}
}
