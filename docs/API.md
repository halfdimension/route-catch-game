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

## WebSocket Multiplayer Presence

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

Presence is stored in memory for local/demo use. It does not synchronize shared
targets, catches, scoring, or routes.

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
