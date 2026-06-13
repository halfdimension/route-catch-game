# Route Catch Game

Route Catch Game is a map-based creature chase game built around real road
routes. Players start timed rounds, chase creatures on a Leaflet map, and catch
them before they expire. The frontend animates gameplay while a Spring Boot API
wraps OSRM routing and persists sessions, catches, scores, and the creature
catalog in PostgreSQL.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Architecture

```text
React + Leaflet frontend
          |
          v
Spring Boot REST API
     |          |
     v          v
   OSRM     PostgreSQL
```

- The frontend owns live map rendering, route animation, target spawning,
  catch detection, progression, and game presentation.
- Spring Boot owns routing adapters, backend session lifecycle, catalog-backed
  catch scoring, history, and leaderboard APIs.
- OSRM provides nearest-road snapping and driving routes.
- PostgreSQL stores the creature catalog, game sessions, and caught-creature
  snapshots. Flyway creates and seeds the schema.

## Main Features

- Leaflet map with animated player movement along OSRM road routes.
- Original common, rare, and legendary creatures with rarity-based markers.
- Direct target chasing, active chase state, route feedback, and cancellation.
- Configurable timed rounds with score, XP, levels, and speed-limit bonuses.
- ETA-based target difficulty derived from route distance and simulation speed.
- Catch toast, sound, map effects, recent catches, and round summaries.
- Backend-created game sessions and catalog-validated catch submission.
- PostgreSQL-persisted sessions, scores, catches, and creature definitions.
- Automatic expiry of stale `RUNNING` backend sessions.
- Stats drawer with persisted game history, catch history, and leaderboard.
- Consistent JSON API errors for validation, routing, state, and method errors.

## Tech Stack

**Frontend**

- React 19 and Vite 8
- Leaflet and React Leaflet
- JavaScript, CSS, and ESLint

**Backend**

- Java 21
- Spring Boot 4
- Spring Web MVC, Validation, Data JPA, and Maven
- Flyway

**Infrastructure**

- PostgreSQL
- OSRM using the MLD algorithm

## Local Prerequisites

- Bash and `curl`
- Java 21
- Node.js `20.19+` or `22.12+` and npm
- Docker with Docker Compose for the recommended PostgreSQL setup, or a local
  PostgreSQL installation
- `psql` for manual database setup and inspection
- A built OSRM server and prepared MLD dataset

The checked-in OSRM scripts currently use these machine-specific paths:

```text
/home/halfdimension/Projects/practice/osrm-backend/build/osrm-routed
/home/halfdimension/Projects/osrm-data/northern-zone-latest.osrm
```

Update `scripts/run-osrm.sh` when OSRM or its dataset is located elsewhere.
The dataset prefix must have at least `.ebg`, `.partition`, and `.cells`
companion files.

## Environment Configuration

Create the frontend environment file:

```bash
cp frontend/.env.example frontend/.env
```

Default value:

```env
VITE_API_BASE_URL=http://localhost:8080
```

The root `.env.example` contains the matching Docker Compose database defaults:

```env
POSTGRES_DB=route_catch_game
POSTGRES_USER=route_catch_user
POSTGRES_PASSWORD=route_catch_pass
```

The Compose file uses these values as defaults, so copying the root file is not
required. If you customize them through a root `.env`, update the backend
datasource settings to match.

The backend defaults are in
`backend/route-catch-api/src/main/resources/application.properties`:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/route_catch_game
spring.datasource.username=route_catch_user
spring.datasource.password=route_catch_pass
osrm.base-url=http://localhost:5000
```

## PostgreSQL Setup with Docker Compose

This is the recommended setup for local development:

```bash
docker compose up -d postgres
```

Check container status and readiness:

```bash
docker compose ps
docker compose logs postgres
```

The `route-catch-postgres` container exposes PostgreSQL on
`localhost:5432` and stores data in the named
`route-catch-postgres-data` volume.

Stop the container while preserving data:

```bash
docker compose down
```

To fully reset the local database:

```bash
docker compose down -v
docker compose up -d postgres
```

`docker compose down -v` permanently deletes the named database volume and all
local sessions and catches. Use it only when a clean database is intended.

## Manual PostgreSQL Setup

As an alternative to Docker, create the local role and database once:

```bash
sudo -u postgres psql
```

```sql
CREATE USER route_catch_user WITH PASSWORD 'route_catch_pass';
CREATE DATABASE route_catch_game OWNER route_catch_user;
\q
```

On backend startup, Flyway applies:

- `V1__create_game_tables.sql`
- `V2__seed_creature_catalog.sql`

JPA uses `ddl-auto=validate`, so Flyway remains responsible for schema changes.

## Quick Start

PostgreSQL must already be running, either through Docker Compose or a local
installation. From the project root:

```bash
docker compose up -d postgres
./scripts/run-all.sh
```

This starts:

- OSRM at `http://localhost:5000`
- Spring Boot at `http://localhost:8080`
- Vite at `http://localhost:5173`

Open `http://localhost:5173`. Press Ctrl+C in the script terminal to stop the
managed OSRM and backend processes along with the frontend.

Check prerequisites and live services with:

```bash
./scripts/check-system.sh
```

## Run Services Separately

Separate terminals are useful when inspecting logs.

Terminal 1:

```bash
./scripts/run-osrm.sh
```

Terminal 2:

```bash
./scripts/run-backend.sh
```

Terminal 3:

```bash
./scripts/run-frontend.sh
```

Equivalent direct commands:

```bash
cd backend/route-catch-api
./mvnw spring-boot:run
```

```bash
cd frontend
npm install
npm run dev
```

## Tests and Builds

Backend tests use H2 and do not require the local PostgreSQL instance:

```bash
cd backend/route-catch-api
./mvnw clean test
```

Frontend verification:

```bash
cd frontend
npm run build
npm run lint
```

Shell script syntax:

```bash
bash -n scripts/run-all.sh
bash -n scripts/run-osrm.sh
bash -n scripts/run-backend.sh
bash -n scripts/run-frontend.sh
bash -n scripts/check-system.sh
```

## Gameplay Flow

1. Choose a round duration and start the game.
2. The frontend creates and starts a persisted backend session.
3. Targets spawn, snap to nearby roads, and receive route-based difficulty.
4. Click a target marker or Targets row to fetch a route and begin chasing.
5. Catch creatures to receive immediate local score, XP, and visual feedback.
6. The frontend submits each creature ID to the backend without blocking play.
7. The backend validates catalog score, stores the catch, and updates the
   persisted session totals.
8. End the round and open Stats to inspect History and Leaderboard data.

## Project Structure

```text
frontend/
  src/
    api/          Spring Boot API clients
    components/   Map, HUD, targets, feedback, Stats, history, leaderboard
    config/       API, game, map, routing, and progression settings
    data/         Frontend creature presentation and mock player profile
    hooks/        Movement, spawning, sessions, catches, and progression
    styles/       Global application styles
    utils/        Rarity and browser sound helpers
backend/route-catch-api/
  src/main/java/com/routecatch/api/
    controller/   Health, route, and nearest endpoints
    dto/          Shared routing and error DTOs
    exception/    Global JSON error handling
    game/         Catalog, sessions, catches, history, and leaderboard
    service/      OSRM routing integration
  src/main/resources/db/migration/
docs/
scripts/
docker-compose.yml
```

## Common Troubleshooting

- **Backend cannot start:** verify PostgreSQL is running and the configured
  database, user, and password exist.
- **PostgreSQL container cannot start:** inspect `docker compose logs postgres`
  and check whether host port `5432` is already occupied.
- **Flyway reports schema permission errors:** grant the application role
  permission on the `public` schema. See
  [Troubleshooting](docs/TROUBLESHOOTING.md).
- **Routing returns `502`:** start OSRM and verify the configured dataset covers
  the coordinates being requested.
- **Frontend cannot reach the API:** confirm `frontend/.env` points to
  `http://localhost:8080` and restart Vite after changing it.
- **Browser shows method not allowed:** `/api/routes`, `/api/nearest`, and catch
  submission are POST endpoints, not browser-tab GET pages.
- **A port is busy:** find and stop the process using ports `5000`, `8080`,
  `5173`, or `5432`.

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for commands and detailed
fixes.

## Current Limitations

- No authentication or users.
- No multiplayer or shared realtime game state.
- Live spawning, movement, catch radius checks, and progression remain
  frontend-controlled.
- Backend catalog validation prevents client-supplied score values, but broader
  anti-cheat validation is not implemented.

## Roadmap

- JWT authentication and persisted user profiles
- Avatar upload
- PostGIS-backed spatial features
- Multiplayer WebSocket sessions
- Valhalla isochrone integration
- Stronger server-authoritative gameplay validation
- Deployment and production observability
