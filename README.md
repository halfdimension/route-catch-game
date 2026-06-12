# Route Catch Game

Route Catch Game is a React + Vite + Leaflet prototype where a player moves through a real map, routes through OSRM, and catches timed creature targets before they expire.

The current version is a frontend prototype. It calls OSRM directly from the browser at `http://localhost:5000` and does not yet include a backend, authentication, persistence, or deployment setup.

## Current Features

- Interactive Leaflet map centered around Delhi.
- Player avatar marker with mock user profile data.
- Plain map click movement with route confirmation.
- Direct creature chasing from map markers and the active target list.
- OSRM route fetching and animated movement along route geometry.
- OSRM nearest-road snapping for spawned creature targets.
- Timed 60-second game sessions with ready, running, and ended states.
- Creature catalog with common, rare, and legendary creatures.
- ETA-based target difficulty from route distance and simulation speed.
- Catch detection, scoring, catch toast feedback, and generated browser sound effects.
- Caught creature inventory panel.
- Game controls for spawning, reset actions, and simulation speed up to 700 m/s.

## Tech Stack

- React
- Vite
- Leaflet
- React Leaflet
- OSRM backend service running locally
- ESLint

## Run the Frontend

Install dependencies:

```bash
npm install
```

Optional environment setup:

```bash
cp .env.example .env
```

Configure `VITE_OSRM_BASE_URL` in `.env` if your OSRM service is not running at the default `http://localhost:5000`.

Start the Vite development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run lint:

```bash
npm run lint
```

## Run the OSRM Dependency

The frontend expects OSRM at:

```text
http://localhost:5000
```

This value is configured by `VITE_OSRM_BASE_URL`. If the variable is not set, the app falls back to `http://localhost:5000`.

One common local setup is to run OSRM with Docker and an OpenStreetMap extract. Example:

```bash
docker run -t -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/map.osm.pbf
docker run -t -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-partition /data/map.osrm
docker run -t -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-customize /data/map.osrm
docker run -p 5000:5000 -v "$PWD/osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/map.osrm
```

Place your downloaded `.osm.pbf` file at `osrm-data/map.osm.pbf` before running these commands. Use an extract that covers the area you want to play in.

## Gameplay Flow

1. Start a game session from the session panel.
2. Creature targets spawn only while the game is running.
3. Each target is snapped to the nearest road when possible.
4. The app asks OSRM for a route from the current player position to the target.
5. Route distance, route duration, simulation speed, and target lifetime are used to assign difficulty.
6. Click a creature marker or active target list item to immediately chase it.
7. Click an empty map area to preview movement and confirm with the "Move here?" panel.
8. Catch a creature by moving within the catch radius before it expires.
9. Catches update score, show feedback, play a generated sound, and appear in the inventory.
10. When the session ends, active targets and movement stop while final score and inventory remain visible.

## Project Structure

```text
src/
  api/
    osrmClient.js
  components/
    CatchToast.jsx
    CaughtInventoryPanel.jsx
    GameControlsPanel.jsx
    GameMap.jsx
    GameSessionPanel.jsx
    MoveConfirmPanel.jsx
    MovementStatusPanel.jsx
    PlayerMarker.jsx
    RouteLine.jsx
    ScorePanel.jsx
    TargetInfoPanel.jsx
    TargetLayer.jsx
    TargetMarker.jsx
  data/
    creatureCatalog.js
    mockUserProfile.js
  hooks/
    useCatchDetection.js
    useGameSession.js
    usePlayerState.js
    useRouteAnimation.js
    useTargetSpawner.js
  styles/
    global.css
  utils/
    soundEffects.js
  App.jsx
  main.jsx
```

## Roadmap

- Spring Boot backend wrapper
- JWT auth
- User profiles and avatar upload
- PostgreSQL persistence
- Multiplayer WebSocket support
- Valhalla isochrone integration
- Leaderboard
- Deployment
