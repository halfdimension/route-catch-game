package com.routecatch.api.routing;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.util.Arrays;

import org.junit.jupiter.api.Test;

import com.routecatch.api.controller.NearestController;
import com.routecatch.api.controller.RoutingController;
import com.routecatch.api.multiplayer.room.creature.OsrmRoomCreatureRoadSnapper;
import com.routecatch.api.multiplayer.room.creature.RoomCreatureService;
import com.routecatch.api.multiplayer.room.movement.routing.MovementRouteClient;
import com.routecatch.api.multiplayer.room.movement.routing.OsrmMovementRouteClient;
import com.routecatch.api.routing.valhalla.ValhallaRoutingService;
import com.routecatch.api.service.OsrmRoutingService;

class RoutingBoundaryTests {

	@Test
	void publicControllersDependOnlyOnTheTravelRoutingFacade() {
		assertArrayEquals(
			new Class<?>[] {TravelRoutingService.class},
			soleConstructor(RoutingController.class).getParameterTypes()
		);
		assertArrayEquals(
			new Class<?>[] {TravelRoutingService.class},
			soleConstructor(NearestController.class).getParameterTypes()
		);
		assertNoFieldOfType(RoutingController.class, OsrmRoutingService.class);
		assertNoFieldOfType(NearestController.class, OsrmRoutingService.class);
	}

	@Test
	void multiplayerCreatureRoutingRemainsExplicitlyOsrm() {
		assertArrayEquals(
			new Class<?>[] {OsrmRoutingService.class},
			soleConstructor(OsrmRoomCreatureRoadSnapper.class).getParameterTypes()
		);
		assertFieldType(
			OsrmRoomCreatureRoadSnapper.class,
			"routingService",
			OsrmRoutingService.class
		);
		assertFieldType(
			RoomCreatureService.class,
			"routingService",
			OsrmRoutingService.class
		);
		assertNoFieldOfType(RoomCreatureService.class, TravelRoutingService.class);
		assertNoFieldOfType(
			OsrmRoomCreatureRoadSnapper.class,
			ValhallaRoutingService.class
		);
		assertNoFieldOfType(
			RoomCreatureService.class,
			ValhallaRoutingService.class
		);
		assertNoFieldOfType(OsrmRoomCreatureRoadSnapper.class, TravelMode.class);
		assertNoFieldOfType(RoomCreatureService.class, TravelMode.class);
	}

	@Test
	void multiplayerMovementKeepsItsSeparateOsrmClientBoundary() {
		assertTrue(MovementRouteClient.class.isInterface());
		assertTrue(
			MovementRouteClient.class.isAssignableFrom(
				OsrmMovementRouteClient.class
			)
		);
		assertNoFieldOfType(
			OsrmMovementRouteClient.class,
			TravelRoutingService.class
		);
		assertNoFieldOfType(
			OsrmMovementRouteClient.class,
			ValhallaRoutingService.class
		);
		assertNoFieldOfType(OsrmMovementRouteClient.class, TravelMode.class);
	}

	private Constructor<?> soleConstructor(Class<?> type) {
		Constructor<?>[] constructors = type.getDeclaredConstructors();
		assertEquals(1, constructors.length);
		return constructors[0];
	}

	private void assertFieldType(
		Class<?> owner,
		String fieldName,
		Class<?> expectedType
	) {
		Field field = Arrays.stream(owner.getDeclaredFields())
			.filter(candidate -> candidate.getName().equals(fieldName))
			.findFirst()
			.orElseThrow();
		assertEquals(expectedType, field.getType());
	}

	private void assertNoFieldOfType(Class<?> owner, Class<?> prohibitedType) {
		assertFalse(Arrays.stream(owner.getDeclaredFields()).anyMatch(field ->
			field.getType().equals(prohibitedType)
		));
	}
}
