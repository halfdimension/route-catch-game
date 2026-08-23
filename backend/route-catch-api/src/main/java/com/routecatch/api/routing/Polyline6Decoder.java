package com.routecatch.api.routing;

import java.util.ArrayList;
import java.util.List;

public final class Polyline6Decoder {

	private static final double POLYLINE6_SCALE = 1_000_000.0;

	private Polyline6Decoder() {
	}

	public static List<RoutingCoordinate> decode(String encodedPolyline6) {
		if (encodedPolyline6 == null || encodedPolyline6.isBlank()) {
			throw new IllegalArgumentException(
				"Encoded polyline6 must not be blank"
			);
		}

		List<RoutingCoordinate> coordinates = new ArrayList<>();
		int index = 0;
		long latitude = 0L;
		long longitude = 0L;

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

			try {
				coordinates.add(new RoutingCoordinate(
					latitude / POLYLINE6_SCALE,
					longitude / POLYLINE6_SCALE
				));
			} catch (IllegalArgumentException exception) {
				throw malformedPolyline(
					"Decoded coordinate is out of range",
					exception
				);
			}

			index = longitudeDelta.nextIndex();
		}

		return List.copyOf(coordinates);
	}

	private static DecodedValue decodeValue(
		String encodedPolyline6,
		int startIndex
	) {
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

	private static IllegalArgumentException malformedPolyline(String detail) {
		return new IllegalArgumentException(
			"Malformed encoded polyline6: " + detail
		);
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
