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
  | JSON over HTTP
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

- `components/` renders the Leaflet map, player and creature markers, routes,
  compact HUD, target and catch panels, round summary, and Stats drawer.
- `hooks/` owns route animation, player state, target spawning, catch
  detection, local sessions, backend session synchronization, and progression.
- `api/` calls Spring Boot for routes, nearest-road snapping, backend sessions,
  catch submission, history, and leaderboard data.
- `config/` centralizes API, game, map, routing, and progression values.
- `data/` contains frontend creature presentation data and the mock profile.
- `utils/` contains browser-generated sound and rarity styling helpers.

Live gameplay remains frontend-controlled:

- The local round timer controls spawning.
- Target spawning asks the backend for nearest-road and route data.
- Route distance and simulation speed determine target difficulty.
- The browser animates the player along returned route coordinates.
- Catch detection updates local score, XP, inventory, and feedback immediately.
- Catch submission to the backend is non-blocking; a sync failure does not
  roll back the local catch.

## Backend

The Spring Boot application is under `backend/route-catch-api/`.

### Routing APIs

- `POST /api/routes` validates coordinates and wraps OSRM's driving route API.
- `POST /api/nearest` validates coordinates and wraps OSRM's nearest API.
- OSRM `[lon, lat]` coordinates are returned as `{ "lat", "lon" }`.
- Routing engine failures become consistent `502` JSON responses.

### Game APIs

- `GET /api/game/creatures` reads the backend-owned creature catalog.
- Session endpoints create, start, retrieve, end, and list sessions.
- Catch submission accepts a creature ID and resolves name, rarity, and score
  from the backend catalog.
- Catch insertion and session score/count updates run in one transaction.
- History endpoints return persisted sessions and their catch snapshots.
- The leaderboard returns completed sessions only.

Controllers remain thin and delegate to `OsrmRoutingService`,
`CreatureCatalogService`, and `GameSessionService`. `GlobalExceptionHandler`
maps validation, malformed JSON, unsupported methods, routing failures,
missing records, invalid states, and unexpected errors to `ApiErrorResponse`.

## PostgreSQL

Flyway migration `V1__create_game_tables.sql` creates:

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

### `caught_creatures`

- UUID catch ID
- foreign keys to session and creature
- snapshot of creature name, rarity, and score
- caught timestamp

`V2__seed_creature_catalog.sql` inserts the nine original creatures. Hibernate
uses schema validation; it does not create or update tables.

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
```

- Session history is ordered by `createdAt` descending.
- Catch history is ordered by `caughtAt` ascending.
- Leaderboard entries include only ended sessions and are ordered by score
  descending, caught count descending, ended time ascending, then creation time
  descending.
- History and leaderboard refreshes are non-blocking and do not interrupt play.

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

- There is no authentication or user ownership yet.
- CORS currently allows the local Vite origin.
- The backend owns catalog score values and ignores legacy client score fields.
- The browser still controls spawn timing, movement, and catch detection.
- Broader anti-cheat and fully server-authoritative rounds are future work.
