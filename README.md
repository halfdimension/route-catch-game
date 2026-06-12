# Route Catch Game

Route Catch Game is a map-based creature-catching game built with React, Leaflet, and Spring Boot. Players follow real road routes, chase timed creatures, and build score and progression during configurable game rounds.

The current version is a frontend gameplay prototype backed by Spring Boot routing endpoints. The frontend sends route and nearest-road requests to the API, and the API calls a local OSRM service.

For a concise technical overview, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Current Features

- Interactive Leaflet map with an animated player avatar.
- Compact HUD for score, catches, level, XP, and session status.
- Plain map-click movement confirmation and direct creature chasing.
- Spring Boot wrappers for OSRM route and nearest-road requests.
- Backend-linked game session creation, start, end, and restart lifecycle.
- Configurable 60, 120, 180, or 300-second game sessions.
- Original common, rare, and legendary route-game creatures.
- Level progression, speed-limit bonuses, and level-based rarity weights.
- ETA-based target difficulty using route distance and simulation speed.
- Catch scoring, toast and sound feedback, recent catches, and round summaries.

## Tech Stack

- React and Vite
- Leaflet and React Leaflet
- Spring Boot and Maven
- OSRM
- ESLint

## Local Development Runbook

### Recommended Quick Start

Start OSRM, Spring Boot, and Vite together from the project root:

```bash
./scripts/run-all.sh
```

The script waits for OSRM and the backend to become reachable before starting the frontend. Press Ctrl+C to stop the managed OSRM and backend processes.

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

```bash
cd backend/route-catch-api
./mvnw spring-boot:run
```

The API runs at `http://localhost:8080` and exposes:

- `GET /api/health`
- `POST /api/routes`
- `POST /api/nearest`

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

1. Start a round and choose its duration.
2. Creature targets spawn while the round is running.
3. The frontend asks Spring Boot to snap each target to the nearest road.
4. Spring Boot requests nearest-road and route data from OSRM.
5. Route distance, simulation speed, and target lifetime determine difficulty.
6. Click a creature or target-list item to chase it immediately.
7. Click empty map space to confirm movement to that location.
8. Catch creatures before they expire to gain score and XP.
9. When the round ends, movement and spawning stop and a summary appears.

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
- PostgreSQL/PostGIS persistence
- Multiplayer WebSocket support
- Valhalla isochrone integration
- Leaderboard
- Deployment
