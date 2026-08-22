package com.routecatch.api.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

class Polyline6DecoderTests {

	private static final double COORDINATE_TOLERANCE = 0.0000001;

	@Test
	void decodesPolyline6IntoNeutralRoutingCoordinatesInOrder() {
		List<RoutingCoordinate> coordinates = Polyline6Decoder.decode(
			"_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI"
		);

		assertEquals(3, coordinates.size());
		assertCoordinate(coordinates.get(0), 38.5, -120.2);
		assertCoordinate(coordinates.get(1), 40.7, -120.95);
		assertCoordinate(coordinates.get(2), 43.252, -126.453);
	}

	@Test
	void rejectsBlankTruncatedInvalidAndOverflowingEncodings() {
		for (String encodedPolyline : List.of(
			" ",
			"_izlhA",
			"? ",
			"~~~~~~~~~~~~~?"
		)) {
			assertThrows(
				IllegalArgumentException.class,
				() -> Polyline6Decoder.decode(encodedPolyline)
			);
		}

		assertThrows(
			IllegalArgumentException.class,
			() -> Polyline6Decoder.decode(null)
		);
	}

	@Test
	void rejectsDecodedCoordinatesOutsideGeographicBounds() {
		assertThrows(
			IllegalArgumentException.class,
			() -> Polyline6Decoder.decode(encodePoint(91.0, 0.0))
		);
		assertThrows(
			IllegalArgumentException.class,
			() -> Polyline6Decoder.decode(encodePoint(0.0, 181.0))
		);
	}

	private String encodePoint(double latitude, double longitude) {
		return encodeValue(Math.round(latitude * 1_000_000.0)) +
			encodeValue(Math.round(longitude * 1_000_000.0));
	}

	private String encodeValue(long value) {
		long encodedValue = value < 0
			? ~(value << 1)
			: value << 1;
		StringBuilder encoded = new StringBuilder();

		while (encodedValue >= 0x20) {
			encoded.append((char) ((0x20 | (encodedValue & 0x1f)) + 63));
			encodedValue >>= 5;
		}

		encoded.append((char) (encodedValue + 63));
		return encoded.toString();
	}

	private void assertCoordinate(
		RoutingCoordinate coordinate,
		double expectedLatitude,
		double expectedLongitude
	) {
		assertEquals(
			expectedLatitude,
			coordinate.latitude(),
			COORDINATE_TOLERANCE
		);
		assertEquals(
			expectedLongitude,
			coordinate.longitude(),
			COORDINATE_TOLERANCE
		);
	}
}
