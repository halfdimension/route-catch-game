package com.routecatch.api.multiplayer.room.creature;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Component;

@Component
public class RoomCreatureSpawnPolicy {

	private static final double EARTH_RADIUS_METERS = 6_371_000.0;

	public int desiredActiveCount(
		int activePlayerCount,
		RoomCreatureSpawnProperties properties
	) {
		long unbounded = (long) properties.baseActiveCount()
			+ (long) Math.max(0, activePlayerCount)
			* properties.perPlayerActiveCount();
		return (int) Math.max(
			0L,
			Math.min(properties.maxActiveCount(), unbounded)
		);
	}

	public Optional<EligibleSpawnPlayer> selectAnchor(
		List<EligibleSpawnPlayer> players,
		List<RoomCreatureInstance> activeCreatures,
		double fairnessRadiusMeters
	) {
		return players.stream()
			.filter((player) ->
				player.playerId() != null &&
				player.position() != null &&
				player.position().isValid()
			)
			.min(
				Comparator
					.<EligibleSpawnPlayer>comparingLong((player) ->
						nearbyCreatureCount(
						player.position(),
						activeCreatures,
						fairnessRadiusMeters
					))
					.thenComparing((player) -> player.playerId().toString())
			);
	}

	public GeoPoint generateCandidate(
		GeoPoint anchor,
		double minRadiusMeters,
		double maxRadiusMeters,
		SpawnRandomSource random
	) {
		double bearing = random.nextDouble() * Math.PI * 2.0;
		double distance = minRadiusMeters
			+ random.nextDouble() * (maxRadiusMeters - minRadiusMeters);
		double angularDistance = distance / EARTH_RADIUS_METERS;
		double startLatitude = Math.toRadians(anchor.latitude());
		double startLongitude = Math.toRadians(anchor.longitude());
		double latitude = Math.asin(
			Math.sin(startLatitude) * Math.cos(angularDistance)
			+ Math.cos(startLatitude)
			* Math.sin(angularDistance)
			* Math.cos(bearing)
		);
		double longitude = startLongitude + Math.atan2(
			Math.sin(bearing)
				* Math.sin(angularDistance)
				* Math.cos(startLatitude),
			Math.cos(angularDistance)
				- Math.sin(startLatitude) * Math.sin(latitude)
		);
		double normalizedLongitude =
			(longitude + Math.PI * 3.0) % (Math.PI * 2.0) - Math.PI;

		return new GeoPoint(
			Math.toDegrees(latitude),
			Math.toDegrees(normalizedLongitude)
		);
	}

	public boolean isSeparatedFromCreatures(
		GeoPoint point,
		List<RoomCreatureInstance> activeCreatures,
		double minimumSeparationMeters
	) {
		return activeCreatures.stream().noneMatch((creature) ->
			distanceMeters(
				point,
				new GeoPoint(creature.getLatitude(), creature.getLongitude())
			) < minimumSeparationMeters
		);
	}

	public double distanceMeters(GeoPoint start, GeoPoint end) {
		double startLatitude = Math.toRadians(start.latitude());
		double endLatitude = Math.toRadians(end.latitude());
		double latitudeDelta = endLatitude - startLatitude;
		double longitudeDelta = Math.toRadians(
			end.longitude() - start.longitude()
		);
		double haversine = Math.sin(latitudeDelta / 2.0)
			* Math.sin(latitudeDelta / 2.0)
			+ Math.cos(startLatitude)
			* Math.cos(endLatitude)
			* Math.sin(longitudeDelta / 2.0)
			* Math.sin(longitudeDelta / 2.0);

		return EARTH_RADIUS_METERS * 2.0 * Math.atan2(
			Math.sqrt(haversine),
			Math.sqrt(Math.max(0.0, 1.0 - haversine))
		);
	}

	private long nearbyCreatureCount(
		GeoPoint player,
		List<RoomCreatureInstance> activeCreatures,
		double fairnessRadiusMeters
	) {
		return activeCreatures.stream()
			.filter((creature) -> distanceMeters(
				player,
				new GeoPoint(creature.getLatitude(), creature.getLongitude())
			) <= fairnessRadiusMeters)
			.count();
	}
}
