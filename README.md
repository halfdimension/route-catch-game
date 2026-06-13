# Route Catch Game

Route Catch Game is a map-based creature-catching game built with React, Leaflet, and Spring Boot. Players follow real road routes, chase timed creatures, and build score and progression during configurable game rounds.

The current version is a frontend gameplay prototype backed by Spring Boot. The backend wraps OSRM routing and persists its creature catalog, game sessions, scores, and caught-creature snapshots in PostgreSQL while the frontend continues to run the live game simulation.

For a concise technical overview, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Current Features

- Interactive Leaflet map with an animated player avatar.
- Compact HUD for score, catches, level, XP, and session status.
- Plain map-click movement confirmation and direct creature chasing.
- Spring Boot wrappers for OSRM route and nearest-road requests.
- Backend-linked session lifecycle and non-blocking catch score synchronization.
- Configurable 60, 120, 180, or 300-second game sessions.
- Original common, rare, and legendary route-game creatures.
- Level progression, speed-limit bonuses, and level-based rarity weights.
- ETA-based target difficulty using route distance and simulation speed.
- Catch scoring, toast and sound feedback, recent catches, and round summaries.

## Tech Stack

- React and Vite
- Leaflet and React Leaflet
- Spring Boot and Maven
- PostgreSQL, JPA, and Flyway
- OSRM
- ESLint

## Local Development Runbook

### Recommended Quick Start

Start OSRM, Spring Boot, and Vite together from the project root:

```bash
./scripts/run-all.sh
```

PostgreSQL must already be running with the local database and user described below. The script waits for OSRM and the backend to become reachable before starting the frontend. Press Ctrl+C to stop the managed OSRM and backend processes.

### Manual Debug Mode

Run each service in a separate terminal when you want to inspect OSRM, backend, and frontend logs independently.

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

The frontend script creates `frontend/.env` from `.env.example` when needed and installs dependencies only when `frontend/node_modules` is absent.

Optionally verify OSRM and both backend routing endpoints:

```bash
./scripts/check-system.sh
```

Open `http://localhost:5173` after all three services are running.

## Run the Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The default frontend API setting is:

```env
VITE_API_BASE_URL=http://localhost:8080
```

Change `VITE_API_BASE_URL` in `frontend/.env` when the Spring Boot API runs at another address.

Build and lint the frontend with:

```bash
cd frontend
npm run build
npm run lint
```

## Run the Backend

Create the local PostgreSQL database and application user once:

```bash
sudo -u postgres psql
```

```sql
CREATE USER route_catch_user WITH PASSWORD 'route_catch_pass';
CREATE DATABASE route_catch_game OWNER route_catch_user;
\q
```

Flyway creates the game tables and seeds the creature catalog automatically when the backend starts.

```bash
cd backend/route-catch-api
./mvnw spring-boot:run
```

The API runs at `http://localhost:8080` and exposes:

- `GET /api/health`
- `POST /api/routes`
- `POST /api/nearest`
- `POST /api/game/sessions`
- `GET /api/game/sessions/{sessionId}`
- `POST /api/game/sessions/{sessionId}/start`
- `POST /api/game/sessions/{sessionId}/end`
- `POST /api/game/sessions/{sessionId}/catches`
- `GET /api/game/creatures`

The creature catalog, game sessions, scores, caught counts, and caught-creature snapshots are stored in PostgreSQL and survive backend restarts.

## Run the OSRM Dependency

The Spring Boot backend expects OSRM at:

```text
http://localhost:5000
```

This is configured by `osrm.base-url` in the backend application properties. The frontend does not call OSRM directly.

One common local setup is:

```bash
docker run -t -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/map.osm.pbf
docker run -t -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-partition /data/map.osrm
docker run -t -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-customize /data/map.osrm
docker run -p 5000:5000 -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/map.osrm
```

Place an OpenStreetMap extract at `osrm-data/map.osm.pbf` before running these commands.

## Gameplay Flow

1. Choose a round duration; the frontend creates and starts a backend game session.
2. Creature targets spawn while the round is running.
3. The frontend asks Spring Boot to snap each target to the nearest road.
4. Spring Boot requests nearest-road and route data from OSRM.
5. Route distance, simulation speed, and target lifetime determine difficulty.
6. Click a creature or target-list item to chase it immediately.
7. Click empty map space to confirm movement to that location.
8. Catch creatures before they expire to gain local score and XP; catches are also submitted to the running backend session.
9. When the round ends, the frontend ends the backend session, stops movement and spawning, and shows a summary.

## Project Structure

```text
frontend/
  src/
    api/          Backend API client
    components/   Map, markers, HUD, controls, and panels
    config/       API, game, map, and progression configuration
    data/         Creature catalog and mock player profile
    hooks/        Session, movement, spawning, catch, and progression logic
    styles/       Global UI styles
    utils/        Browser sound effects
backend/
  route-catch-api/
    src/main/java/com/routecatch/api/
      controller/ REST endpoints
      dto/        API request and response models
      service/    OSRM integration
      game/       DB-backed catalog, sessions, and catch submission
    src/main/resources/db/migration/
      V1__create_game_tables.sql
      V2__seed_creature_catalog.sql
docs/
  ARCHITECTURE.md
scripts/
  check-system.sh
  run-all.sh
  run-backend.sh
  run-frontend.sh
  run-osrm.sh
```

## Roadmap

- JWT authentication
- User profiles and avatar upload
- PostgreSQL persistence for users
- PostGIS-backed spatial features
- Multiplayer WebSocket support
- Valhalla isochrone integration
- Leaderboard
- Deployment
