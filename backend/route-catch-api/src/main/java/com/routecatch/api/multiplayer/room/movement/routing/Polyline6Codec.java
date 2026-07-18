package com.routecatch.api.multiplayer.room.movement.routing;

import java.util.ArrayList;
import java.util.List;

import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;

public final class Polyline6Codec {

	private static final double POLYLINE6_SCALE = 1_000_000.0;
	private static final double EARTH_RADIUS_METERS = 6_371_000.0;

	private Polyline6Codec() {
	}

	public static List<MovementCoordinate> decode(String encodedPolyline6) {
		if (encodedPolyline6 == null || encodedPolyline6.isBlank()) {
			throw new IllegalArgumentException("Encoded polyline6 must not be blank");
		}

		List<MovementCoordinate> coordinates = new ArrayList<>();
		int index = 0;
		long latitude = 0;
		long longitude = 0;

		while (index < encodedPolyline6.length()) {
			DecodedValue latitudeDelta = decodeValue(encodedPolyline6, index);
			DecodedValue longitudeDelta = decodeValue(
				encodedPolyline6,
				latitudeDelta.nextIndex()
			);

			try {
				latitude = Math.addExact(latitude, latitudeDelta.value());
				longitude = Math.addExact(longitude, longitudeDelta.value());
			} catch (ArithmeticException exception) {
				throw malformedPolyline("Coordinate delta overflow", exception);
			}

			coordinates.add(new MovementCoordinate(
				latitude / POLYLINE6_SCALE,
				longitude / POLYLINE6_SCALE
			));
			index = longitudeDelta.nextIndex();
		}

		return List.copyOf(coordinates);
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

	private static DecodedValue decodeValue(String encodedPolyline6, int startIndex) {
		if (startIndex >= encodedPolyline6.length()) {
			throw malformedPolyline("Incomplete coordinate pair");
		}

		long result = 0L;
		int shift = 0;
		int index = startIndex;

		while (true) {
			if (index >= encodedPolyline6.length()) {
				throw malformedPolyline("Truncated encoded value");
			}

			int encodedChunk = encodedPolyline6.charAt(index) - 63;
			index += 1;

			if (encodedChunk < 0 || encodedChunk > 63) {
				throw malformedPolyline("Invalid encoded character");
			}

			long chunk = encodedChunk & 0x1fL;

			if (shift > 60 || chunk > (Long.MAX_VALUE >> shift)) {
				throw malformedPolyline("Encoded value overflow");
			}

			result |= chunk << shift;

			if (encodedChunk < 0x20) {
				break;
			}

			shift += 5;
		}

		long value = (result & 1L) == 0L
			? result >> 1
			: ~(result >> 1);
		return new DecodedValue(value, index);
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

	private static IllegalArgumentException malformedPolyline(String detail) {
		return new IllegalArgumentException("Malformed encoded polyline6: " + detail);
	}

	private static IllegalArgumentException malformedPolyline(
		String detail,
		RuntimeException cause
	) {
		return new IllegalArgumentException(
			"Malformed encoded polyline6: " + detail,
			cause
		);
	}

	private record DecodedValue(long value, int nextIndex) {
	}
}
