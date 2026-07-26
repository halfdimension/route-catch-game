package com.routecatch.api.multiplayer.room.creature;

import java.util.Optional;

public interface RoomCreatureRoadSnapper {

	Optional<GeoPoint> snap(GeoPoint candidate);
}
