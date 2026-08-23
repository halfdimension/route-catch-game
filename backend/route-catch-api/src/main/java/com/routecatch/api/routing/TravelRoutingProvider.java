package com.routecatch.api.routing;

public interface TravelRoutingProvider {

	RouteResult route(RouteQuery query);

	NearestPointResult findNearestPoint(NearestPointQuery query);
}
