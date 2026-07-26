# API Reference

Base URL:

```bash
API_URL=http://localhost:8080
```

All request and response bodies use JSON. Examples assume the backend,
PostgreSQL, and OSRM are running.

## Health

```bash
curl --fail "$API_URL/api/health"
```

```json
{
  "status": "UP",
  "service": "route-catch-api"
}
```

## Authentication

Register:

```bash
curl --fail \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "username": "harsh",
    "email": "harsh@example.com",
    "displayName": "Harsh",
    "password": "password123"
  }' \
  "$API_URL/api/auth/register"
```

Login:

```bash
curl --fail \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"usernameOrEmail":"harsh","password":"password123"}' \
  "$API_URL/api/auth/login"
```

Both return:

```json
{
  "token": "JWT",
  "tokenType": "Bearer",
  "user": {
    "userId": "UUID",
    "username": "harsh",
    "email": "harsh@example.com",
    "displayName": "Harsh",
    "createdAt": "2026-06-13T12:00:00Z"
  }
}
```

Store the token for protected examples:

```bash
TOKEN=replace-with-jwt
```

Current user:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/auth/me"
```

`GET /api/auth/me` returns the `user` object shape shown above.

## Route

```bash
curl --fail \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "sourceLat": 28.6139,
    "sourceLon": 77.2090,
    "destinationLat": 28.6200,
    "destinationLon": 77.2150
  }' \
  "$API_URL/api/routes"
```

The response contains:

```json
{
  "coordinates": [{"lat": 28.6139, "lon": 77.209}],
  "distanceMeters": 1200.5,
  "durationSeconds": 180.2,
  "source": {"lat": 28.6139, "lon": 77.209},
  "destination": {"lat": 28.62, "lon": 77.215}
}
```

## Nearest Road

```bash
curl --fail \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"lat":28.6139,"lon":77.2090}' \
  "$API_URL/api/nearest"
```

```json
{
  "snappedPoint": {"lat": 28.6139, "lon": 77.209},
  "distanceMeters": 4.2,
  "name": "Road name"
}
```

## Creature Catalog

```bash
curl --fail "$API_URL/api/game/creatures"
```

Each item contains `creatureId`, `creatureName`, `rarity`, and `scoreValue`.

## Create Session

```bash
curl --fail \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"durationSeconds":60,"playerName":"Harsh"}' \
  "$API_URL/api/game/sessions"
```

Duration must be between 30 and 600 seconds. `playerName` is optional, trimmed,
limited to 80 characters, and defaults to `Guest`. The response uses this
shape:

```json
{
  "sessionId": "UUID",
  "status": "CREATED",
  "createdAt": "2026-06-13T12:00:00Z",
  "startedAt": null,
  "endedAt": null,
  "durationSeconds": 60,
  "score": 0,
  "caughtCount": 0,
  "playerName": "Harsh",
  "userId": null
}
```

When a valid `Authorization: Bearer $TOKEN` header is provided, the session is
linked to the authenticated user, `userId` is populated, and the backend uses
the user's `displayName` as `playerName`.

Set the returned ID for the following examples:

```bash
SESSION_ID=replace-with-session-uuid
```

## List Sessions

```bash
curl --fail "$API_URL/api/game/sessions"
curl --fail "$API_URL/api/game/sessions?limit=5"
```

The default limit is 20. Valid limits are 1 through 100. Results use the
session response shape and are ordered by creation time descending.

## Get Session

```bash
curl --fail "$API_URL/api/game/sessions/$SESSION_ID"
```

A stale running session is auto-expired before it is returned.

## Start Session

```bash
curl --fail \
  --request POST \
  "$API_URL/api/game/sessions/$SESSION_ID/start"
```

`CREATED` becomes `RUNNING`. Starting an already running session returns the
same running session.

## End Session

```bash
curl --fail \
  --request POST \
  "$API_URL/api/game/sessions/$SESSION_ID/end"
```

`CREATED` or `RUNNING` becomes `ENDED`. Ending an ended session is idempotent.

## Submit Catch

The backend requires the creature ID and resolves trusted score data from its
catalog:

```bash
curl --fail \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{"creatureId":"voltfox"}' \
  "$API_URL/api/game/sessions/$SESSION_ID/catches"
```

```json
{
  "sessionId": "UUID",
  "status": "RUNNING",
  "score": 30,
  "caughtCount": 1,
  "acceptedCatchScore": 30,
  "creatureId": "voltfox",
  "creatureName": "Voltfox",
  "rarity": "rare"
}
```

Only running sessions accept catches. Legacy name, rarity, or score fields may
be accepted in the request DTO but are ignored.

## List Session Catches

```bash
curl --fail "$API_URL/api/game/sessions/$SESSION_ID/catches"
```

Results are ordered by catch time ascending:

```json
[
  {
    "catchId": "UUID",
    "sessionId": "UUID",
    "creatureId": "voltfox",
    "creatureName": "Voltfox",
    "rarity": "rare",
    "scoreValue": 30,
    "caughtAt": "2026-06-13T12:01:00Z"
  }
]
```

## Current User Stats and History

These endpoints require `Authorization: Bearer $TOKEN` and use
`game_sessions.user_id`, not player-name matching. Guest sessions are excluded.

Current user stats:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/game/me/stats"
```

```json
{
  "playerName": "Harsh",
  "totalSessions": 3,
  "completedSessions": 2,
  "totalScore": 160,
  "totalCatches": 5,
  "bestScore": 100,
  "bestCaughtCount": 3,
  "averageScore": 80.0,
  "latestSessionAt": "2026-06-13T12:00:00Z"
}
```

Current user sessions:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/game/me/sessions?limit=20"
```

Results use the session response shape and are ordered by creation time
descending. Valid limits are 1 through 100.

Current user session catches:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/game/me/sessions/$SESSION_ID/catches"
```

The session must belong to the authenticated user. Results use the catch
response shape.

## Public Player Stats

The name-based stats endpoint remains public for guest/demo flows:

```bash
curl --fail "$API_URL/api/game/players/Harsh/stats"
```

It returns the same stats shape but matches sessions by `player_name`.

## Leaderboard

```bash
curl --fail "$API_URL/api/game/leaderboard"
curl --fail "$API_URL/api/game/leaderboard?limit=20"
```

The default limit is 10 and valid limits are 1 through 100. Only ended sessions
appear.

```json
[
  {
    "rank": 1,
    "sessionId": "UUID",
    "score": 100,
    "caughtCount": 3,
    "durationSeconds": 60,
    "startedAt": "2026-06-13T12:00:00Z",
    "endedAt": "2026-06-13T12:01:00Z",
    "playerName": "Harsh"
  }
]
```

Ordering is score descending, caught count descending, ended time ascending,
then creation time descending.

## Multiplayer Room Games and Shared Creatures

Starting a room game is host-only and changes the room to `IN_PROGRESS` with a
`RUNNING` game:

```bash
curl --fail \
  --request POST \
  --header "Authorization: Bearer $TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"durationSeconds": 300}' \
  "$API_URL/api/multiplayer/rooms/A8F3KQ/game/start"
```

The response includes a unique `roundId` and a monotonically increasing,
room-local `generation`. The authoritative lifecycle is
`WAITING -> RUNNING -> FINALIZING -> ENDED`. `FINALIZING` is normally brief:
gameplay is frozen atomically and the room reopens only after an immutable
result has been stored. Explicit room closure remains final.

Players present when `game/start` commits are the round participants. A member
who joins an already-running room may observe it but cannot move, catch, or
appear in that round's result. Every participant is ranked, including players
with zero score.

Host end, deadline expiry, and running-room closure all use the same
generation-guarded finalizer. The first request changes `RUNNING` to
`FINALIZING`; duplicate requests reuse the stored result, and delayed work for
an older round cannot affect a restart. At the freeze boundary the backend:

- rejects new/replacement movement and catch commands;
- cancels active movement at its interpolated authoritative position;
- prevents late movement completions from changing that position;
- stops automatic spawning and invalidates remaining active creatures; and
- snapshots scores and caught-creature history before publishing the result.

Competition ranking uses score descending. Equal scores share a rank and later
positions are skipped (`180, 150, 150, 90` becomes `1, 2, 2, 4`). Equal-score
display order is catch count descending, display name case-insensitive
ascending, then player UUID. These secondary fields do not change the shared
rank.

### Multiplayer Round Results

An authenticated participant can recover a completed result even if its
WebSocket event was missed:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/multiplayer/rooms/A8F3KQ/rounds/$ROUND_ID/result"

curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/multiplayer/rooms/A8F3KQ/rounds/latest/result"
```

The response separates the public leaderboard from the requester's private
catch details:

```json
{
  "publicResult": {
    "roundId": "UUID",
    "roomCode": "A8F3KQ",
    "startedAt": "2026-07-26T10:00:00Z",
    "endedAt": "2026-07-26T10:05:00Z",
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
        "caughtAt": "2026-07-26T10:01:00Z"
      }
    ],
    "startedAt": "2026-07-26T10:00:00Z",
    "endedAt": "2026-07-26T10:05:00Z",
    "endReason": "HOST_ENDED"
  }
}
```

Other players' caught-creature lists are never included in `publicResult`.
End reasons are `HOST_ENDED`, `TIME_EXPIRED`, or `ROOM_CLOSED`.

The public event is published exactly once after the result is retrievable:

```text
/topic/rooms/{roomCode}/events
```

It uses the existing room envelope and sequence with `eventType: "GAME_ENDED"`;
the payload is `publicResult`. Movement and `GAME_ENDED` therefore share the
same monotonic `roomSequence`, even though they use their respective room
topics.

Completed multiplayer results are currently single-JVM and in memory. The
replaceable `RoomRoundResultStore` retains the latest 100 rounds per room.
Process restart loses them; PostgreSQL persistence is not implemented.

While a generation is `RUNNING`, the backend automatically maintains active
shared creatures:

```text
desiredActiveCount =
  clamp(baseActiveCount + activePlayerCount * perPlayerActiveCount,
        0,
        maxActiveCount)
```

Only non-expired `ACTIVE` creatures count. Each five-second cycle fills at most
the configured deficit and never more than `maxSpawnsPerCycle`. For every
placement, the backend prefers the eligible player with the fewest active
creatures inside the spawn radius. An eligible position comes from the
interpolated active movement plan first, a stored authoritative stationary
position second, and valid presence only as a legacy fallback.

The backend generates a bounded-distance geographic candidate around that
player, snaps it through OSRM `/nearest`, and rejects failed/invalid snaps,
points too close to the player, duplicates, and points within the configured
minimum separation from another active creature. Browser coordinates are not
used by the automatic cycle.

Room members list active creatures with:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/multiplayer/rooms/A8F3KQ/creatures"
```

Clients may subscribe to compatible lifecycle events:

```text
/topic/rooms/{roomCode}/creatures
```

Event types remain `CREATED`, `CAUGHT`, and `EXPIRED`.

The existing host-only endpoint below is retained only as a manual
development/admin override. Normal gameplay does not call it, it does not
start another scheduler, and authoritative active-count, lifecycle, catalog,
event, and separation validation still applies:

```bash
curl --fail \
  --request POST \
  --header "Authorization: Bearer $TOKEN" \
  --header "Content-Type: application/json" \
  --data \
  '{"centerLat":28.6139,"centerLon":77.2090,"count":1,"ttlSeconds":120,"radiusMeters":500}' \
  "$API_URL/api/multiplayer/rooms/A8F3KQ/creatures/spawn"
```

Automatic scheduling, room ownership, movement state, and shared-creature state
are currently single-JVM and in memory. The scheduler/position/snapper
abstractions are the boundary for future distributed room ownership; Redis or
a broker is not implemented.

## WebSocket Multiplayer

Endpoint:

```text
ws://localhost:8080/ws
```

STOMP `CONNECT` must include:

```text
Authorization: Bearer <JWT>
```

Publish presence updates:

```text
/app/rooms/{roomId}/presence
```

Payload:

```json
{
  "lat": 28.6,
  "lon": 77.2,
  "status": "IDLE"
}
```

Subscribe to room presence:

```text
/topic/rooms/{roomId}/presence
```

Broadcast payload:

```json
[
  {
    "userId": "UUID",
    "username": "harsh",
    "displayName": "Harsh",
    "lat": 28.6,
    "lon": 77.2,
    "status": "IDLE",
    "lastSeenAt": "2026-06-13T12:00:00Z"
  }
]
```

Presence is stored in memory for local/demo use. After Phase A2 it supplies
identity and socket liveness, while its coordinate is only a sparse legacy
fallback for players that have no movement plan. Multiplayer route progression
comes from authoritative movement plans; shared creatures and scoring retain
their separate authoritative room services.

### Authoritative Movement Commands

Room members can start a backend-owned movement plan while the room game is
running:

```text
/app/rooms/{roomCode}/movements/start
```

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

`destinationLat` and `destinationLon` are required for `MAP`. For `CREATURE`,
the browser omits them:

```json
{
  "requestedSpeedMps": 80,
  "destinationType": "CREATURE",
  "targetCreatureInstanceId": "UUID",
  "clientCommandId": "UUID",
  "expectedMovementVersion": 0
}
```

`expectedMovementVersion` is optional; when supplied, a stale command is
rejected. `playerId`, source coordinates, route geometry, and client-displayed
creature coordinates are never accepted as authority. For `CREATURE`,
`targetCreatureInstanceId` is required and the server resolves the active
creature's authoritative coordinate. When player speed control is disabled, the
server uses the room maximum speed.

Cancel the current movement with its authoritative identity and version:

```text
/app/rooms/{roomCode}/movements/cancel
```

```json
{
  "movementId": "UUID",
  "movementVersion": 1,
  "clientCommandId": "UUID"
}
```

Stale cancellation commands are harmless no-ops. Movement events are published
to:

```text
/topic/rooms/{roomCode}/movements
```

Each `MOVEMENT_STARTED`, `MOVEMENT_CANCELLED`, or `MOVEMENT_COMPLETED` event
uses this envelope:

```json
{
  "eventId": "UUID",
  "roomCode": "A8F3KQ",
  "roomSequence": 1,
  "eventType": "MOVEMENT_STARTED",
  "serverTimestamp": "2026-07-18T08:00:00Z",
  "payload": {
    "movementId": "UUID",
    "roomCode": "A8F3KQ",
    "playerId": "UUID",
    "version": 1,
    "encodedPolyline6": "encoded route geometry",
    "totalDistanceMeters": 1200.5,
    "simulationSpeedMps": 80,
    "startedAt": "2026-07-18T08:00:00Z",
    "expectedEndAt": "2026-07-18T08:00:15.006250Z",
    "source": {"latitude": 28.6139, "longitude": 77.209},
    "destination": {"latitude": 28.62, "longitude": 77.215},
    "currentPosition": {"latitude": 28.6139, "longitude": 77.209},
    "destinationType": "MAP",
    "targetCreatureInstanceId": null,
    "status": "MOVING",
    "createdAt": "2026-07-18T08:00:00Z",
    "updatedAt": "2026-07-18T08:00:00Z"
  }
}
```

`roomSequence` increases for committed movement events, and `version` increases
for each accepted plan belonging to a room/player pair. `encodedPolyline6`
uses the encoded-polyline algorithm at six decimal places (1e-6 degree
precision), and Java `Instant` values serialize as ISO-8601 UTC strings.

### Movement Reconnect Snapshot

After subscribing, clients can recover the latest plan for every player from:

```bash
curl --fail \
  --header "Authorization: Bearer $TOKEN" \
  "$API_URL/api/multiplayer/rooms/A8F3KQ/movements"
```

The response contains the canonical `roomCode`, current `roomSequence`, an ISO
`serverTimestamp`, and a `movements` array using the payload shape above. The
frontend subscribes before fetching this snapshot on room-play entry and every
WebSocket reconnect, and fetches it again after a detected sequence gap.

## Error Responses

Errors use a consistent shape:

```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "sourceLat must be between -90 and 90",
  "path": "/api/routes",
  "timestamp": "2026-06-13T12:00:00Z"
}
```

Common statuses:

- `400`: validation, malformed JSON, invalid UUID, or invalid limit
- `401`: missing or invalid authentication token
- `404`: session or creature not found
- `405`: unsupported HTTP method
- `409`: invalid session state
- `502`: OSRM unavailable or invalid routing response
- `500`: unexpected server error with no raw exception details

Round-specific error codes include `ROUND_NOT_RUNNING`, `ROUND_FINALIZING`,
`ROUND_ALREADY_ENDED`, `ROUND_NOT_FOUND`, `ROUND_RESULT_NOT_READY`,
`ROUND_RESULT_FORBIDDEN`, and `STALE_ROUND_GENERATION`.
