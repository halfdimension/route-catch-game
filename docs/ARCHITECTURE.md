# Architecture

Route Catch Game uses a React frontend for live map gameplay and a Spring Boot API for routing, a PostgreSQL-backed creature catalog, and in-memory game session tracking. The browser still owns movement, spawning, catch detection, progression, and presentation.

## Current Architecture

```text
React UI -> frontend API clients -> Spring Boot API -> OSRM server
                                      |
                                      -> in-memory game sessions
                                      |
                                      -> PostgreSQL creature catalog
```

- React and Vite render the application, HUD, controls, and gameplay state.
- Leaflet and React Leaflet render the map, player, route, and creatures.
- Frontend API clients call Spring Boot for routing, session lifecycle, and catch submission.
- Spring Boot validates requests, calls OSRM, and returns frontend-friendly coordinate objects.
- Flyway creates the database schema and seeds the backend-owned creature catalog.
- Spring Boot creates, starts, ends, and retrieves in-memory game sessions.
- Valid catches are resolved against the backend catalog before updating backend score and caught count atomically.
- Route animation, target spawning, catch detection, local progression, and the local game timer remain frontend-controlled.
- Catch submission is non-blocking; backend failures do not undo local catch feedback or scoring.

## Local Processes

Local development runs four independent processes:

```text
Vite frontend     http://localhost:5173
Spring Boot API   http://localhost:8080
OSRM server       http://localhost:5000
PostgreSQL        localhost:5432
```

The Vite browser client sends API requests to Spring Boot. Spring Boot validates and translates routing requests before calling OSRM, and uses PostgreSQL for creature definitions. PostgreSQL must be running before the root-level scripts start the other three processes.

## Main Modules

- `frontend/src/components`: Map elements, markers, HUD panels, controls, inventory, feedback, and round summary.
- `frontend/src/hooks`: Player movement, route animation, spawning, catch detection, local sessions, backend session synchronization, and progression.
- `frontend/src/config`: API endpoint, game, map, and progression configuration.
- `frontend/src/api`: Spring Boot API adapters used by frontend gameplay hooks.
- `frontend/src/data`: Original creature catalog and mock player profile.
- `frontend/src/utils`: Browser-generated sound effects and small helpers.
- `backend/route-catch-api`: Spring Boot routing adapters, API error handling, Flyway migrations, the creature repository, and in-memory game session/catch services.

## Current Limitations

- No authentication.
- Most gameplay decisions and validation are still controlled by the frontend.
- Backend sessions, scores, and caught counts are in memory and disappear on restart.
- PostgreSQL currently persists only the creature catalog; users, scores, catches, and sessions are not persisted.
- No multiplayer or shared realtime state.
- Catch submissions validate creature IDs and scoring against the backend catalog, but broader anti-cheat validation is not implemented.

## Planned Architecture

```text
React -> Spring Boot -> OSRM/Valhalla
Spring Boot -> PostgreSQL/PostGIS
Spring Boot -> WebSocket clients
```

Future backend work will persist the current session/catch model, add trusted game validation, authentication, isochrone support, and realtime multiplayer while retaining the existing routing wrapper.
