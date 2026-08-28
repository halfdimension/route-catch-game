# Route Catch Game API Reference

This reference describes the committed public contract at PR #18 (`d44655c`).
Controllers and DTOs remain the ultimate contract.

Default base URL:

```bash
API_URL=http://localhost:8080
```

Request and response bodies use JSON. Error responses use:

```json
{
  "errorCode": "ERROR_CODE",
  "message": "Sanitized message",
  "path": "/api/path",
  "timestamp": "2026-08-28T12:00:00Z"
}
```

## Health

```http
GET /api/health
```

```json
{
  "status": "UP",
  "service": "route-catch-api"
}
```

This is application health only. It does not probe OSRM, Valhalla, or
PostgreSQL readiness, so it may be `UP` while a route provider is unavailable.

## Public TravelMode Contract

Both public routing requests accept an optional `travelMode` string.

| JSON input | Behavior |
|---|---|
| field omitted | defaults to `CAR` |
| `null` | defaults to `CAR` |
| `"CAR"` | valid; OSRM driving |
| `"MOTORCYCLE"` | valid; Valhalla motorcycle |
| `"WALKING"` | valid; Valhalla pedestrian |
| any other value, including lowercase | `400 UNSUPPORTED_TRAVEL_MODE` |

Values are case-sensitive. There is no `BICYCLE`. These strings are
provider-neutral API values; Valhalla costing strings are internal and are not
accepted as public modes.

Successful route and nearest responses do not echo `travelMode`.

## Route

```http
POST /api/routes
Content-Type: application/json
```

Request:

```json
{
  "sourceLat": 28.6139,
  "sourceLon": 77.209,
  "destinationLat": 28.62,
  "destinationLon": 77.215,
  "travelMode": "WALKING"
}
```

`sourceLat` and `destinationLat` are required numbers in `[-90, 90]`.
`sourceLon` and `destinationLon` are required numbers in `[-180, 180]`.

Response:

```json
{
  "coordinates": [
    {"lat": 28.6139, "lon": 77.209},
    {"lat": 28.62, "lon": 77.215}
  ],
  "distanceMeters": 1250.0,
  "durationSeconds": 900.5,
  "source": {"lat": 28.6139, "lon": 77.209},
  "destination": {"lat": 28.62, "lon": 77.215}
}
```

`coordinates` are `{lat, lon}` objects regardless of the provider's native
shape. Distance is normalized to metres and duration to seconds. `source` and
`destination` are the requested normalized coordinates; there is no response
`travelMode` field.

Example:

```bash
curl --fail-with-body \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "sourceLat":28.6139,
    "sourceLon":77.209,
    "destinationLat":28.62,
    "destinationLon":77.215,
    "travelMode":"MOTORCYCLE"
  }' \
  "$API_URL/api/routes"
```

## Nearest Routable Point

```http
POST /api/nearest
Content-Type: application/json
```

Request:

```json
{
  "lat": 28.6139,
  "lon": 77.209,
  "travelMode": "CAR"
}
```

`lat` is required and constrained to `[-90, 90]`; `lon` is required and
constrained to `[-180, 180]`.

Response:

```json
{
  "snappedPoint": {"lat": 28.61391, "lon": 77.20902},
  "distanceMeters": 4.2,
  "name": "Road name"
}
```

`name` may be `null` when no nonblank road name is available.

Example:

```bash
curl --fail-with-body \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"lat":28.6139,"lon":77.209,"travelMode":"WALKING"}' \
  "$API_URL/api/nearest"
```

## Routing Selection and Failure Contract

The controllers depend on `TravelRoutingService`, which selects exactly one
provider. A failed request is not silently retried through a different mode or
provider.

| Condition | HTTP | `errorCode` |
|---|---:|---|
| Unsupported/case-mismatched mode | 400 | `UNSUPPORTED_TRAVEL_MODE` |
| Valhalla known no-route response | 400 | `ROUTE_NOT_FOUND` |
| OSRM no-route/no-segment response | 400 | provider code such as `NoRoute` or `NoSegment` |
| Selected provider unreachable | 502 | `ROUTING_ENGINE_UNAVAILABLE` |
| Valhalla connection/read timeout | 504 | `ROUTING_ENGINE_TIMEOUT` |
| No usable nearest edge/point | 502 | `NEAREST_POINT_NOT_FOUND` |
| Malformed JSON or normalized invalid Valhalla response | 502 | `ROUTING_ENGINE_INVALID_RESPONSE` |
| Recognized invalid OSRM response | 502 | `ROUTING_ENGINE_INVALID_RESPONSE` |
| Other unsuccessful provider response | 502 | `ROUTING_ENGINE_ERROR` |

Current nuance: the public CAR adapter maps an OSRM `ResourceAccessException`
to `502 ROUTING_ENGINE_UNAVAILABLE`; it does not currently distinguish OSRM
timeouts as the Valhalla adapter does. `TRAVEL_MODE_UNAVAILABLE` (503) protects
an internal provider/mode mismatch but should not occur through the normal
facade mapping. Valhalla comprehensively validates route/locate success bodies:
malformed JSON and the invalid structures, route metrics, or route geometry
handled by its normalizers map to `502 ROUTING_ENGINE_INVALID_RESPONSE`; no
usable locate edge remains the separate nearest-point error above. OSRM
recognizes some invalid responses, but its coordinate-array/shape validation is
not as comprehensive. Do not rely on every arbitrary malformed OSRM payload
returning that 502; an unexpected failure may reach the sanitized generic
`500 INTERNAL_SERVER_ERROR` path.

## Authentication

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

Register request:

```json
{
  "username": "harsh",
  "email": "harsh@example.com",
  "displayName": "Harsh",
  "password": "password123"
}
```

Login request:

```json
{
  "usernameOrEmail": "harsh",
  "password": "password123"
}
```

Register/login response:

```json
{
  "token": "JWT",
  "tokenType": "Bearer",
  "user": {
    "userId": "UUID",
    "username": "harsh",
    "email": "harsh@example.com",
    "displayName": "Harsh",
    "createdAt": "2026-08-28T12:00:00Z"
  }
}
```

Protected REST requests use:

```http
Authorization: Bearer <JWT>
```

## SOLO Session API

### Endpoint Inventory

```text
GET  /api/game/creatures
POST /api/game/sessions
GET  /api/game/sessions?limit=20
GET  /api/game/sessions/{sessionId}
POST /api/game/sessions/{sessionId}/start
POST /api/game/sessions/{sessionId}/end
POST /api/game/sessions/{sessionId}/catches
GET  /api/game/sessions/{sessionId}/catches

GET /api/game/me/stats
GET /api/game/me/sessions?limit=20
GET /api/game/me/sessions/{sessionId}/catches
GET /api/game/leaderboard?limit=10
GET /api/game/players/{playerName}/stats
```

Session creation accepts `durationSeconds` from 30 through 600 and an optional
guest `playerName` up to 80 characters. A valid bearer token links the session
to the authenticated UUID and uses that user's display name.

### Catch Submission and Idempotency

```http
POST /api/game/sessions/{sessionId}/catches
```

```json
{
  "creatureId": "voltfox",
  "catchId": "optional-client-UUID"
}
```

`creatureId` is required. Legacy `creatureName`, `rarity`, and `scoreValue`
request fields may deserialize but are not trusted; the backend resolves the
catalog snapshot and score. `catchId` is optional:

- Supplied: it becomes the stable logical catch ID.
- Omitted: the backend generates a UUID for that request; separate legacy
  retries are separate catches.
- Same ID + same session + same creature: idempotent success with no second
  score/count award.
- Same ID + different session or creature: `409 CATCH_ID_CONFLICT`.

Response:

```json
{
  "sessionId": "UUID",
  "catchId": "UUID",
  "status": "RUNNING",
  "score": 30,
  "caughtCount": 1,
  "acceptedCatchScore": 30,
  "creatureId": "voltfox",
  "creatureName": "Voltfox",
  "rarity": "rare"
}
```

An exact persisted replay can succeed after the session has ended. A new catch
against an ended session remains invalid.

## Multiplayer REST API

Multiplayer REST routes are security-protected. Host, membership, and frozen
participant checks vary by operation. Notably, the current
`GET /api/multiplayer/rooms/{roomCode}` controller read is authenticated but
does not itself enforce membership; completed-result reads separately authorize
persisted participation.

### Rooms, Game, and Score

```text
POST  /api/multiplayer/rooms
GET   /api/multiplayer/rooms/me
GET   /api/multiplayer/rooms/{roomCode}
POST  /api/multiplayer/rooms/{roomCode}/join
POST  /api/multiplayer/rooms/{roomCode}/leave
POST  /api/multiplayer/rooms/{roomCode}/close
PATCH /api/multiplayer/rooms/{roomCode}/settings
POST  /api/multiplayer/rooms/{roomCode}/game/start
GET   /api/multiplayer/rooms/{roomCode}/game
POST  /api/multiplayer/rooms/{roomCode}/game/end
GET   /api/multiplayer/rooms/{roomCode}/scoreboard
```

Game status is `WAITING`, `RUNNING`, `FINALIZING`, or `ENDED`. Room status is
separately `OPEN`, `IN_PROGRESS`, or `CLOSED`. Start freezes the participant
roster and assigns a round UUID and room-local generation. End reasons are
`HOST_ENDED`, `TIME_EXPIRED`, and `ROOM_CLOSED`.

### Movement and Shared Creatures

```text
GET  /api/multiplayer/rooms/{roomCode}/movements
GET  /api/multiplayer/rooms/{roomCode}/creatures
POST /api/multiplayer/rooms/{roomCode}/creatures/spawn
POST /api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch
```

The spawn endpoint is a host-only manual development/admin override. Normal
population is backend-scheduled. The catch request includes `playerLat` and
`playerLon`; the backend owns the shared transition and score, but currently
calculates distance from those submitted coordinates.

### Durable Completed Result

```text
GET /api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result
GET /api/multiplayer/rooms/{roomCode}/rounds/latest/result
```

Only an authenticated persisted participant may read the result. Completed
results are backed by PostgreSQL and survive backend restart.

Response:

```json
{
  "publicResult": {
    "roundId": "UUID",
    "roomCode": "A8F3KQ",
    "startedAt": "2026-08-28T10:00:00Z",
    "endedAt": "2026-08-28T10:05:00Z",
    "endReason": "HOST_ENDED",
    "playerCount": 2,
    "leaderboard": [
      {
        "playerId": "UUID",
        "displayName": "Harsh",
        "score": 180,
        "rank": 1,
        "creaturesCaught": 2
      }
    ]
  },
  "personalResult": {
    "roundId": "UUID",
    "roomCode": "A8F3KQ",
    "playerId": "UUID",
    "displayName": "Harsh",
    "score": 180,
    "rank": 1,
    "playerCount": 2,
    "creaturesCaught": 2,
    "rarityCounts": {"rare": 1, "legendary": 1},
    "caughtCreatures": [
      {
        "instanceId": "UUID",
        "creatureId": "catalog-id",
        "name": "Creature",
        "rarity": "rare",
        "scoreAwarded": 80,
        "caughtAt": "2026-08-28T10:01:00Z"
      }
    ],
    "startedAt": "2026-08-28T10:00:00Z",
    "endedAt": "2026-08-28T10:05:00Z",
    "endReason": "HOST_ENDED"
  }
}
```

The public leaderboard does not include other players' private catch lists.
Competition rank is score-defined; ties share a rank and skip later numeric
positions.

Exact lookup checks a matching committed in-memory result before PostgreSQL.
Latest lookup checks PostgreSQL first so an older memory entry cannot mask a
newer committed result. “Latest” means latest completed room round, not latest
round in that room played by the requester.

### Current-User Multiplayer History

```http
GET /api/multiplayer/me/rounds?page=0&size=20
```

`page` must be non-negative. `size` must be 1 through 100. The authenticated
user UUID is taken from the principal, and only persisted `ENDED` rounds are
returned in deterministic `endedAt DESC, roundId DESC` order.

```json
{
  "content": [
    {
      "roundId": "UUID",
      "roomCode": "A8F3KQ",
      "startedAt": "2026-08-28T10:00:00Z",
      "endedAt": "2026-08-28T10:05:00Z",
      "endReason": "HOST_ENDED",
      "durationSeconds": 300,
      "participantCount": 2,
      "rank": 1,
      "score": 180,
      "creaturesCaught": 2
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

History is a summary projection. Catch details are loaded only through the
specific result endpoint.

## WebSocket/STOMP Contract

Endpoint:

```text
ws://localhost:8080/ws
```

STOMP `CONNECT` requires `Authorization: Bearer <JWT>`.

```text
SEND /app/rooms/{roomCode}/presence
SEND /app/rooms/{roomCode}/movements/start
SEND /app/rooms/{roomCode}/movements/cancel

SUBSCRIBE /topic/rooms/{roomCode}/presence
SUBSCRIBE /topic/rooms/{roomCode}/creatures
SUBSCRIBE /topic/rooms/{roomCode}/movements
SUBSCRIBE /topic/rooms/{roomCode}/events
```

Movement start payload:

```json
{
  "destinationLat": 28.62,
  "destinationLon": 77.215,
  "requestedSpeedMps": 80,
  "destinationType": "MAP",
  "targetCreatureInstanceId": null,
  "clientCommandId": "UUID",
  "expectedMovementVersion": 0
}
```

For `CREATURE`, destination coordinates are omitted and
`targetCreatureInstanceId` is required; the backend resolves the authoritative
creature position. Source coordinate, route geometry, and player identity are
not accepted as client authority.

Movement cancel payload:

```json
{
  "movementId": "UUID",
  "movementVersion": 1,
  "clientCommandId": "UUID"
}
```

Movement events are `MOVEMENT_STARTED`, `MOVEMENT_CANCELLED`, and
`MOVEMENT_COMPLETED`. They carry event UUID, room sequence, server timestamp,
and a versioned movement plan with OSRM polyline6 geometry. The authenticated
movement snapshot returns the latest plan per player plus current room sequence
for reconnect/gap recovery.

`GAME_ENDED` is published on the room events topic only after durable result
persistence. Publication failures receive bounded in-memory retries using the
same event envelope. This is not exactly-once or durable event delivery; REST
and PostgreSQL are result recovery truth.

SOLO `TravelMode` is absent from multiplayer REST/STOMP contracts.

## General Error Categories

Common statuses include:

| HTTP | Meaning |
|---:|---|
| 400 | Validation, malformed JSON, unsupported travel mode, invalid UUID/limit, or known no-route condition |
| 401 | Missing/invalid authentication |
| 403 | Room/result operation forbidden |
| 404 | Requested resource not found |
| 405 | Unsupported HTTP method |
| 409 | Invalid lifecycle state, catch conflict, or multiplayer state conflict |
| 500 | Sanitized unexpected/persistence/history/result failure |
| 502 | Routing provider unavailable, recognized invalid response, nearest failure, or other provider error |
| 504 | Valhalla routing timeout |

Infrastructure errors are sanitized; provider bodies, SQL, tokens, and server
internals are not public response contracts.
