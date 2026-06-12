# Architecture

Route Catch Game uses a React frontend for map gameplay and a Spring Boot API for routing integration. The browser still owns the prototype game state, while the backend isolates OSRM from the frontend.

## Current Architecture

```text
React UI -> osrmClient.js -> Spring Boot API -> OSRM server
```

- React and Vite render the application, HUD, controls, and gameplay state.
- Leaflet and React Leaflet render the map, player, route, and creatures.
- `frontend/src/api/osrmClient.js` calls Spring Boot through `POST /api/routes` and `POST /api/nearest`.
- Spring Boot validates requests, calls OSRM, and returns frontend-friendly coordinate objects.
- Route animation, target spawning, game sessions, progression, scoring, and catches remain frontend-controlled.

## Local Processes

Local development runs three independent processes:

```text
Vite frontend     http://localhost:5173
Spring Boot API   http://localhost:8080
OSRM server       http://localhost:5000
```

The Vite browser client sends API requests to Spring Boot. Spring Boot validates and translates those requests before calling OSRM. Root-level scripts can start each process independently for debugging or orchestrate all three processes with `scripts/run-all.sh`.

## Main Modules

- `frontend/src/components`: Map elements, markers, HUD panels, controls, inventory, feedback, and round summary.
- `frontend/src/hooks`: Player movement, route animation, spawning, catch detection, sessions, and progression.
- `frontend/src/config`: API endpoint, game, map, and progression configuration.
- `frontend/src/api`: Spring Boot API adapters used by frontend gameplay hooks.
- `frontend/src/data`: Original creature catalog and mock player profile.
- `frontend/src/utils`: Browser-generated sound effects and small helpers.
- `backend/route-catch-api`: Spring Boot controllers, DTOs, and OSRM routing service.

## Current Limitations

- No authentication.
- Game state and validation are still controlled by the frontend.
- No persistence for users, scores, catches, or sessions.
- No multiplayer or shared realtime state.
- The backend currently wraps routing services only.

## Planned Architecture

```text
React -> Spring Boot -> OSRM/Valhalla
Spring Boot -> PostgreSQL/PostGIS
Spring Boot -> WebSocket clients
```

Future backend work will add trusted game and session logic, persistence, authentication, isochrone support, and realtime multiplayer while retaining the existing routing wrapper.
