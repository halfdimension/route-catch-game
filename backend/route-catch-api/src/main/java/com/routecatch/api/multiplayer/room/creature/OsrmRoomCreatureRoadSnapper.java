package com.routecatch.api.multiplayer.room.creature;

import java.util.Optional;

import org.springframework.stereotype.Component;

import com.routecatch.api.exception.RoutingEngineException;
import com.routecatch.api.routing.NearestPointResult;
import com.routecatch.api.routing.RoutingCoordinate;
import com.routecatch.api.service.OsrmRoutingService;

@Component
public class OsrmRoomCreatureRoadSnapper
	implements RoomCreatureRoadSnapper {

	private final OsrmRoutingService routingService;

	public OsrmRoomCreatureRoadSnapper(OsrmRoutingService routingService) {
		this.routingService = routingService;
	}

	@Override
	public Optional<GeoPoint> snap(GeoPoint candidate) {
		try {
			NearestPointResult response = routingService.findNearestDrivingPoint(
				new RoutingCoordinate(
					candidate.latitude(),
					candidate.longitude()
				)
			);
			RoutingCoordinate point = response.snappedPoint();

			if (point == null) {
				return Optional.empty();
			}

			GeoPoint snapped = new GeoPoint(
				point.latitude(),
				point.longitude()
			);
			return snapped.isValid() ? Optional.of(snapped) : Optional.empty();
		} catch (RoutingEngineException exception) {
			return Optional.empty();
		}
	}
}
