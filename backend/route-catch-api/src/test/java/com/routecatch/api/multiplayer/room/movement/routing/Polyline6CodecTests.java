package com.routecatch.api.multiplayer.room.movement.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.routecatch.api.multiplayer.room.movement.model.MovementCoordinate;

class Polyline6CodecTests {

	private static final double COORDINATE_TOLERANCE = 0.0000001;

	@Test
	void decodesKnownPolyline6Geometry() {
		List<MovementCoordinate> coordinates = Polyline6Codec.decode(
			"_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI"
		);

		assertEquals(3, coordinates.size());
		assertCoordinate(coordinates.get(0), 38.5, -120.2);
		assertCoordinate(coordinates.get(1), 40.7, -120.95);
		assertCoordinate(coordinates.get(2), 43.252, -126.453);
	}

	@Test
	void interpolationUsesCumulativeHaversineGeometryLength() {
		String encodedPolyline6 = "???o}@?o}@";

		assertCoordinate(
			Polyline6Codec.interpolate(encodedPolyline6, 0.25),
			0.0,
			0.0005
		);
		assertCoordinate(
			Polyline6Codec.interpolate(encodedPolyline6, 0.75),
			0.0,
			0.0015
		);
		assertEquals(
			222.389853,
			Polyline6Codec.geometryLengthMeters(
				Polyline6Codec.decode(encodedPolyline6)
			),
			0.001
		);
	}

	@Test
	void interpolationClampsFiniteFractionToRouteBounds() {
		String encodedPolyline6 = "???o}@";

		assertCoordinate(
			Polyline6Codec.interpolate(encodedPolyline6, -2.0),
			0.0,
			0.0
		);
		assertCoordinate(
			Polyline6Codec.interpolate(encodedPolyline6, 3.0),
			0.0,
			0.001
		);
	}

	@Test
	void malformedAndNonFiniteInputsAreRejected() {
		assertThrows(
			IllegalArgumentException.class,
			() -> Polyline6Codec.decode("_izlhA")
		);
		assertThrows(
			IllegalArgumentException.class,
			() -> Polyline6Codec.decode(" ")
		);
		assertThrows(
			IllegalArgumentException.class,
			() -> Polyline6Codec.interpolate("???o}@", Double.NaN)
		);
	}

	private void assertCoordinate(
		MovementCoordinate coordinate,
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
