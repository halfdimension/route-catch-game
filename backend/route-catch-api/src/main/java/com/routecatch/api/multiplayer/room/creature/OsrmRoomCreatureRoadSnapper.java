package com.routecatch.api.multiplayer.room.creature;

import java.util.Optional;

import org.springframework.stereotype.Component;

import com.routecatch.api.dto.CoordinateDto;
import com.routecatch.api.dto.NearestRequest;
import com.routecatch.api.dto.NearestResponse;
import com.routecatch.api.exception.RoutingEngineException;
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
			NearestResponse response = routingService.fetchNearest(
				new NearestRequest(candidate.latitude(), candidate.longitude())
			);
			CoordinateDto point = response.snappedPoint();

			if (point == null) {
				return Optional.empty();
			}

			GeoPoint snapped = new GeoPoint(point.lat(), point.lon());
			return snapped.isValid() ? Optional.of(snapped) : Optional.empty();
		} catch (RoutingEngineException exception) {
			return Optional.empty();
		}
	}
}
