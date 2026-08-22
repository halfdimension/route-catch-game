package com.routecatch.api.multiplayer.room.movement.routing;

import java.util.List;

import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;
import com.routecatch.api.routing.Polyline6Decoder;

public final class Polyline6Codec {

	private static final double EARTH_RADIUS_METERS = 6_371_000.0;

	private Polyline6Codec() {
	}

	public static List<MovementCoordinate> decode(String encodedPolyline6) {
		return Polyline6Decoder.decode(encodedPolyline6).stream()
			.map(coordinate -> new MovementCoordinate(
				coordinate.latitude(),
				coordinate.longitude()
			))
			.toList();
	}

	public static MovementCoordinate interpolate(
		String encodedPolyline6,
		double normalizedRouteFraction
	) {
		return interpolate(decode(encodedPolyline6), normalizedRouteFraction);
	}

	public static MovementCoordinate interpolate(
		List<MovementCoordinate> coordinates,
		double normalizedRouteFraction
	) {
		if (coordinates == null || coordinates.isEmpty()) {
			throw new IllegalArgumentException(
				"Route coordinates must not be empty"
			);
		}

		if (!Double.isFinite(normalizedRouteFraction)) {
			throw new IllegalArgumentException("Route fraction must be finite");
		}

		double routeFraction = Math.max(
			0.0,
			Math.min(1.0, normalizedRouteFraction)
		);

		if (coordinates.size() == 1 || routeFraction == 0.0) {
			return coordinates.getFirst();
		}

		if (routeFraction == 1.0) {
			return coordinates.getLast();
		}

		double[] segmentLengths = segmentLengths(coordinates);
		double totalLengthMeters = sum(segmentLengths);

		if (totalLengthMeters == 0.0) {
			return coordinates.getFirst();
		}

		double targetDistanceMeters = totalLengthMeters * routeFraction;
		double traversedDistanceMeters = 0.0;

		for (int index = 0; index < segmentLengths.length; index += 1) {
			double segmentLengthMeters = segmentLengths[index];

			if (segmentLengthMeters == 0.0) {
				continue;
			}

			double segmentEndDistanceMeters =
				traversedDistanceMeters + segmentLengthMeters;

			if (targetDistanceMeters <= segmentEndDistanceMeters) {
				double segmentFraction = (
					targetDistanceMeters - traversedDistanceMeters
				) / segmentLengthMeters;
				return interpolateCoordinate(
					coordinates.get(index),
					coordinates.get(index + 1),
					segmentFraction
				);
			}

			traversedDistanceMeters = segmentEndDistanceMeters;
		}

		return coordinates.getLast();
	}

	public static double geometryLengthMeters(
		List<MovementCoordinate> coordinates
	) {
		if (coordinates == null || coordinates.isEmpty()) {
			throw new IllegalArgumentException(
				"Route coordinates must not be empty"
			);
		}

		return sum(segmentLengths(coordinates));
	}

	private static double[] segmentLengths(
		List<MovementCoordinate> coordinates
	) {
		double[] lengths = new double[Math.max(0, coordinates.size() - 1)];

		for (int index = 0; index < lengths.length; index += 1) {
			lengths[index] = distanceMeters(
				coordinates.get(index),
				coordinates.get(index + 1)
			);
		}

		return lengths;
	}

	private static double sum(double[] values) {
		double sum = 0.0;

		for (double value : values) {
			sum += value;
		}

		return sum;
	}

	private static double distanceMeters(
		MovementCoordinate source,
		MovementCoordinate destination
	) {
		double sourceLatitudeRadians = Math.toRadians(source.latitude());
		double destinationLatitudeRadians = Math.toRadians(
			destination.latitude()
		);
		double latitudeDelta = Math.toRadians(
			destination.latitude() - source.latitude()
		);
		double longitudeDelta = Math.toRadians(
			destination.longitude() - source.longitude()
		);
		double haversine = Math.sin(latitudeDelta / 2.0)
			* Math.sin(latitudeDelta / 2.0)
			+ Math.cos(sourceLatitudeRadians)
			* Math.cos(destinationLatitudeRadians)
			* Math.sin(longitudeDelta / 2.0)
			* Math.sin(longitudeDelta / 2.0);
		double boundedHaversine = Math.max(0.0, Math.min(1.0, haversine));

		return EARTH_RADIUS_METERS * 2.0 * Math.atan2(
			Math.sqrt(boundedHaversine),
			Math.sqrt(1.0 - boundedHaversine)
		);
	}

	private static MovementCoordinate interpolateCoordinate(
		MovementCoordinate source,
		MovementCoordinate destination,
		double fraction
	) {
		return new MovementCoordinate(
			source.latitude() + (
				destination.latitude() - source.latitude()
			) * fraction,
			source.longitude() + (
				destination.longitude() - source.longitude()
			) * fraction
		);
	}

}
