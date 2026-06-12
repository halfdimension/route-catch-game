# Architecture

Route Catch Game is currently a frontend prototype built with React, Vite, and Leaflet. The browser owns the game loop, map interaction, routing requests, animation, target spawning, session timer, score, and caught inventory.

## Current Prototype

```text
React UI -> osrmClient.js -> OSRM server
```

- React + Vite render the application shell, panels, controls, and gameplay state.
- Leaflet and React Leaflet render the map, player marker, route line, and creature markers.
- The frontend calls OSRM directly through `src/api/osrmClient.js`.
- Route animation is handled in the browser by walking along decoded OSRM route coordinates.
- Target spawning is handled in the browser, including rarity selection, road snapping, route feasibility, and expiry.
- Game session state is handled in the browser with a local timer.

## Main Modules

- `src/components`: Presentational and interactive UI pieces such as the map, panels, markers, route line, inventory, and feedback toast.
- `src/hooks`: Frontend gameplay logic for player state, route animation, target spawning, catch detection, and game sessions.
- `src/config`: Centralized configuration for game constants, map defaults, and routing URLs.
- `src/api`: Client-side API adapters, currently direct OSRM route and nearest-road calls.
- `src/data`: Local prototype data such as the creature catalog and mock user profile.
- `src/utils`: Small helpers that do not fit into UI, hooks, data, or API modules.

## Current Limitations

- No backend yet.
- No authentication yet.
- Game state is controlled by the frontend and can be reset or manipulated locally.
- No persistence for users, scores, catches, or sessions.
- No multiplayer or shared realtime state.

## Planned Backend Architecture

```text
React -> Spring Boot -> OSRM/Valhalla
Spring Boot -> PostgreSQL/PostGIS
Spring Boot -> WebSocket clients
```

The planned backend will move trusted game/session logic behind Spring Boot, proxy routing and isochrone services, persist user and gameplay data in PostgreSQL/PostGIS, and support realtime multiplayer through WebSocket clients.
