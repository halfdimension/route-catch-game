package com.routecatch.api.multiplayer.room.creature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class RoomCreatureSpawnPolicyTests {

	private final RoomCreatureSpawnPolicy policy =
		new RoomCreatureSpawnPolicy();
	private final RoomCreatureSpawnProperties properties = properties();

	@Test
	void desiredPopulationUsesBasePlayersAndMaximumCap() {
		assertEquals(4, policy.desiredActiveCount(0, properties));
		assertEquals(6, policy.desiredActiveCount(1, properties));
		assertEquals(12, policy.desiredActiveCount(4, properties));
		assertEquals(30, policy.desiredActiveCount(100, properties));
	}

	@Test
	void playerWithFewestNearbyActiveCreaturesWinsDeterministically() {
		UUID crowdedId = UUID.fromString(
			"00000000-0000-0000-0000-000000000001"
		);
		UUID underservedId = UUID.fromString(
			"00000000-0000-0000-0000-000000000002"
		);
		EligibleSpawnPlayer crowded = new EligibleSpawnPlayer(
			crowdedId,
			"Crowded",
			new GeoPoint(0.0, 0.0)
		);
		EligibleSpawnPlayer underserved = new EligibleSpawnPlayer(
			underservedId,
			"Underserved",
			new GeoPoint(0.0, 0.02)
		);
		RoomCreatureInstance nearby = creature(0.0, 0.001);

		assertEquals(
			underservedId,
			policy.selectAnchor(
				List.of(crowded, underserved),
				List.of(nearby),
				1200.0
			).orElseThrow().playerId()
		);
	}

	@Test
	void invalidPlayerPositionsAreNotEligibleAnchors() {
		EligibleSpawnPlayer invalid = new EligibleSpawnPlayer(
			UUID.randomUUID(),
			"Invalid",
			new GeoPoint(Double.NaN, 0.0)
		);

		assertTrue(
			policy.selectAnchor(List.of(invalid), List.of(), 1200.0).isEmpty()
		);
	}

	@Test
	void generatedCandidateRadiusStaysInsideConfiguredBounds() {
		GeoPoint anchor = new GeoPoint(28.6139, 77.2090);
		GeoPoint minimum = policy.generateCandidate(
			anchor,
			150.0,
			1200.0,
			new SequenceRandom(0.0, 0.0)
		);
		GeoPoint nearMaximum = policy.generateCandidate(
			anchor,
			150.0,
			1200.0,
			new SequenceRandom(0.75, 0.999999)
		);

		assertEquals(150.0, policy.distanceMeters(anchor, minimum), 0.01);
		assertTrue(policy.distanceMeters(anchor, nearMaximum) < 1200.0);
		assertTrue(policy.distanceMeters(anchor, nearMaximum) > 1199.0);
	}

	@Test
	void minimumCreatureSeparationRejectsNearbyCandidate() {
		List<RoomCreatureInstance> creatures = List.of(creature(0.0, 0.0));

		assertFalse(policy.isSeparatedFromCreatures(
			new GeoPoint(0.0, 0.0001),
			creatures,
			100.0
		));
		assertTrue(policy.isSeparatedFromCreatures(
			new GeoPoint(0.0, 0.002),
			creatures,
			100.0
		));
	}

	private RoomCreatureInstance creature(double latitude, double longitude) {
		Instant now = Instant.parse("2026-07-26T00:00:00Z");
		return new RoomCreatureInstance(
			UUID.randomUUID(),
			"ROOM",
			"cat",
			"Cat",
			"COMMON",
			10,
			latitude,
			longitude,
			now,
			now.plusSeconds(120)
		);
	}

	private RoomCreatureSpawnProperties properties() {
		return new RoomCreatureSpawnProperties(
			true,
			Duration.ofSeconds(5),
			4,
			2,
			30,
			5,
			150.0,
			1200.0,
			100.0,
			8,
			Duration.ofMinutes(2)
		);
	}

	private static final class SequenceRandom implements SpawnRandomSource {

		private final double[] values;
		private int index;

		private SequenceRandom(double... values) {
			this.values = values;
		}

		@Override
		public double nextDouble() {
			return values[index++ % values.length];
		}

		@Override
		public int nextInt(int bound) {
			return 0;
		}
	}
}
