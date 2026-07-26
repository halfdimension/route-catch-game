# Architecture

Route Catch Game is a four-process local system. React handles realtime game
presentation, Spring Boot exposes the application API, OSRM supplies routing,
and PostgreSQL stores durable game records.

## System Diagram

```text
Browser
  |
  v
React + Vite + Leaflet
  |
  | JSON over HTTP + STOMP over WebSocket
  v
Spring Boot API
  |                    |
  | route / nearest    | JPA transactions
  v                    v
OSRM                  PostgreSQL
```

Local ports:

```text
Vite frontend     http://localhost:5173
Spring Boot API   http://localhost:8080
OSRM              http://localhost:5000
PostgreSQL        localhost:5432
```

For reproducible local setup, `docker-compose.yml` runs only PostgreSQL in the
`route-catch-postgres` container. Frontend, backend, and OSRM remain native
local processes.

## Frontend

The frontend is a React application under `frontend/`.

- `components/` renders the Leaflet map, player, creature, and online-player
  markers, routes, compact HUD, target and catch panels, round summary, auth
  UI, multiplayer controls, and Stats drawer.
- `hooks/` owns route animation, player state, target spawning, catch
  detection, local sessions, backend session synchronization, progression, and
  multiplayer presence.
- `api/` calls Spring Boot for routes, nearest-road snapping, backend sessions,
  catch submission, auth, current-user data, history, and leaderboard data.
- `config/` centralizes API, game, map, routing, and progression values.
- `data/` contains frontend creature presentation data and the mock profile.
- `utils/` contains browser-generated sound and rarity styling helpers.

Solo gameplay remains frontend-controlled, while multiplayer movement now
uses backend-authoritative plans:

- The local round timer controls spawning.
- Target spawning asks the backend for nearest-road and route data.
- Route distance and simulation speed determine target difficulty.
- The browser animates the player along returned route coordinates.
- Catch detection updates local score, XP, inventory, and feedback immediately.
- Catch submission to the backend is non-blocking; a sync failure does not
  roll back the local catch.
- Authenticated users can join a room and see other online users on the map.
  Presence supplies identity and liveness, while Phase A2 sends movement
  intent to Phase A1 and renders both local and remote plan timelines.

## Backend

The Spring Boot application is under `backend/route-catch-api/`.

### Authentication APIs

- `POST /api/auth/register` creates a user with BCrypt password hashing.
- `POST /api/auth/login` validates credentials and returns a JWT.
- `GET /api/auth/me` validates `Authorization: Bearer <token>` and returns the
  current user.
- JWT validation is handled by Spring Security for protected REST endpoints and
  by the STOMP channel interceptor for WebSocket connections.

```text
register/login -> JWT -> /api/auth/me
```

### Routing APIs

- `POST /api/routes` validates coordinates and wraps OSRM's driving route API.
- `POST /api/nearest` validates coordinates and wraps OSRM's nearest API.
- OSRM `[lon, lat]` coordinates are returned as `{ "lat", "lon" }`.
- Routing engine failures become consistent `502` JSON responses.

### Game APIs

- `GET /api/game/creatures` reads the backend-owned creature catalog.
- Session endpoints create, start, retrieve, end, and list sessions.
- Authenticated session creation stores `game_sessions.user_id` and uses the
  user's display name. Guest sessions remain valid with `user_id = null`.
- Catch submission accepts a creature ID and resolves name, rarity, and score
  from the backend catalog.
- Catch insertion and session score/count updates run in one transaction.
- History endpoints return persisted sessions and their catch snapshots.
- `GET /api/game/me/stats` and `GET /api/game/me/sessions` return
  authenticated current-user data by `user_id`.
- The leaderboard returns completed sessions only.

### Multiplayer Presence

- The STOMP endpoint is `/ws`.
- Clients publish presence to `/app/rooms/{roomId}/presence`.
- Clients subscribe to `/topic/rooms/{roomId}/presence`.
- STOMP `CONNECT` requires `Authorization: Bearer <token>`.
- The server associates each presence update with the authenticated user and
  broadcasts the full room presence list after updates.
- Disconnect cleanup removes the user's presence from tracked rooms and
  broadcasts updated lists.

Presence is intentionally in memory for local/demo use:

```text
roomId -> userId -> presence
websocket sessionId -> userId + joined rooms
```

It is not persisted and remains the temporary remote-marker fallback.

### Multiplayer Movement Plans

Phase A1 added the single-JVM authoritative movement foundation. Phase A2 now
uses it for multiplayer rendering without changing solo routing:

```text
authenticated STOMP movement intent
          |
          v
room membership/game/speed/creature validation
          |
          v
backend OSRM polyline6 route
          |
          v
room/player movement plan + version
          |
          +--> scheduled guarded completion
          +--> sequenced room movement events
          +--> authenticated reconnect snapshot
```

- Start/cancel commands use `/app/rooms/{roomCode}/movements/...`; authenticated
  principal identity is the only source of `playerId`.
- `RoomMovementService` has an in-memory implementation behind replaceable
  routing, event-publisher, event-sequencer, and completion-scheduler
  abstractions.
- The backend requests full polyline6 routes directly from OSRM. The public
  GeoJSON route endpoint remains unchanged for solo and legacy browser play.
- Source priority is the interpolated active plan, the stored terminal
  authoritative position, a finite/range-valid presence position, then the
  configured initial position.
- Map intents include a client-selected destination. Creature intents include
  only the creature instance ID; the backend resolves its room-scoped active
  coordinate before and after routing.
- Position is derived from server elapsed time and speed as an OSRM-distance
  fraction, then applied to cumulative decoded-geometry length.
- Replacements cancel the prior plan at the calculated route point and increase
  the per-room/player version. Completion callbacks re-check movement ID,
  version, current-plan identity, and status before changing state.
- Movement events use UUID IDs, monotonically increasing per-room sequences,
  ISO timestamps, and `MOVEMENT_STARTED`, `MOVEMENT_CANCELLED`, or
  `MOVEMENT_COMPLETED` types on `/topic/rooms/{roomCode}/movements`.
- `GET /api/multiplayer/rooms/{roomCode}/movements` returns the sequence and
  latest plan per player for reconnect recovery.

Movement state and event sequences are intentionally in memory for the current
single-process deployment. The contracts isolate storage and publishing so a
later Redis store or broker relay does not require a frontend event-shape
change.

The multiplayer frontend shares the existing authenticated STOMP connection
for presence, creatures, and movements. Each connection generation subscribes
once to the movement topic before fetching the snapshot. Events with duplicate
IDs, old room sequences, or stale player versions are ignored; a sequence gap
marks state stale and triggers snapshot reconciliation. Reconnects resubscribe
and replace missed history with a snapshot rather than relying on broker replay.
Concurrent snapshot requests are coalesced. Transient failures retry with an
exponential delay capped at 10 seconds; visibility restoration and an
unconfirmed-command timeout can force an immediate generation-guarded refresh.

Polyline6 geometry is decoded once per movement ID at 1e-6 degree precision.
The renderer caches Leaflet `[latitude, longitude]` coordinates, cumulative
haversine segment lengths, measured geometry length, and the backend route
distance. Position uses:

```text
routeFraction = clamp(elapsedSeconds * speedMps / backendDistance, 0, 1)
geometryDistance = routeFraction * measuredGeometryDistance
```

The first accepted snapshot/event clock sample sets
`serverOffsetMs = serverTimestampMs - clientReceiveTimeMs`; later samples with
strictly newer server timestamps use a bounded EWMA adjustment.
Rendering time is
`Date.now() + serverOffsetMs`. This removes dependence on frame history: after
a hidden tab becomes visible, the next render calculates the current timeline
position immediately. The estimate still includes unknown one-way network
latency and is not a precision clock-synchronization protocol.

Presence now owns identity, display data, socket liveness, and a sparse legacy
stationary-coordinate fallback. It publishes on connection and authoritative
movement transitions, not on every animation frame. Movement plans own local
and remote route progression. Players with no plan yet necessarily retain the
presence coordinate fallback until the backend has a latest movement plan for
them.

Controllers remain thin and delegate to `OsrmRoutingService`,
`CreatureCatalogService`, and `GameSessionService`. `GlobalExceptionHandler`
maps validation, malformed JSON, unsupported methods, routing failures,
missing records, invalid states, and unexpected errors to `ApiErrorResponse`.

## PostgreSQL

Flyway migrations create the database schema:

### `creature_catalog`

- `creature_id` primary key
- name, rarity, score value
- creation timestamp

### `game_sessions`

- UUID session ID
- status: `CREATED`, `RUNNING`, or `ENDED`
- created, started, and ended timestamps
- round duration
- accumulated score and caught count
- player display name, defaulting to `Guest`
- nullable `user_id` for authenticated sessions

### `users`

- UUID user ID
- unique username
- optional unique email
- display name
- BCrypt password hash
- creation timestamp

### `caught_creatures`

- UUID catch ID
- foreign keys to session and creature
- snapshot of creature name, rarity, and score
- caught timestamp

- `V1__create_game_tables.sql` creates game tables.
- `V2__seed_creature_catalog.sql` inserts the nine original creatures.
- `V3__add_player_name_to_game_sessions.sql` adds display-name support.
- `V4__create_users_and_link_sessions.sql` creates users and nullable session
  user links.

Hibernate uses schema validation; it does not create or update tables.

## Session Lifecycle

```text
POST sessions
    |
    v
 CREATED -- start --> RUNNING -- end/expiry --> ENDED
```

- Starting an already running session is idempotent.
- Starting an ended session returns `409 INVALID_GAME_SESSION_STATE`.
- Ending an ended session returns the existing ended session.
- Only running sessions accept catches.
- Created sessions do not expire because they have no start time.

### Stale Session Auto-Expiry

A running session is stale after:

```text
startedAt + durationSeconds
```

When stale, it becomes `ENDED` and receives that calculated expiry instant as
`endedAt`, not the later request time. Expiry checks run during session get,
session listing, catch submission, end handling, and leaderboard queries.
A catch submitted after expiry is rejected with `409` and is not persisted.

## History and Leaderboard

The Stats drawer uses:

```text
GET /api/game/sessions?limit=20
GET /api/game/sessions/{sessionId}/catches
GET /api/game/leaderboard?limit=10
GET /api/game/me/stats
GET /api/game/me/sessions?limit=20
```

- Session history is ordered by `createdAt` descending.
- Catch history is ordered by `caughtAt` ascending.
- Leaderboard entries include only ended sessions and are ordered by score
  descending, caught count descending, ended time ascending, then creation time
  descending.
- History, leaderboard, and current-user stats refreshes are non-blocking and
  do not interrupt play.

## Local Startup

`scripts/run-all.sh` starts OSRM, waits for it, starts Spring Boot, waits for
health, prepares `frontend/.env` and dependencies when needed, then starts
Vite. PostgreSQL is intentionally not started by this script and must already
be available. The recommended database command is:

```bash
docker compose up -d postgres
```

Individual scripts are retained for separate logs:

```text
scripts/run-osrm.sh
scripts/run-backend.sh
scripts/run-frontend.sh
```

## Security and Trust Boundaries

- JWT authentication exists for current-user REST endpoints and WebSocket
  room commands. Gameplay remains playable as a guest in solo mode.
- Existing global history and leaderboard endpoints remain public.
- CORS currently allows the local Vite origin.
- The backend owns catalog score values and ignores legacy client score fields.
- The browser still controls solo spawn timing, solo movement, and current
  catch detection.
- Multiplayer local and remote markers render backend movement plans. Presence
  coordinates are only the fallback for an online player with no plan.
- The current shared-creature catch endpoint still requires client coordinates;
  Phase A2 supplies a position calculated on demand from the authoritative
  movement timeline, but moving that derivation entirely into the backend is a
  future hardening step.
- Movement STOMP commands are fire-and-forget. The frontend confirms starts by
  observing a higher authoritative movement version and falls back to a
  snapshot after 15 seconds; Phase A1 does not provide command-correlated error
  responses.
- Broader anti-cheat and fully server-authoritative rounds are future work.
