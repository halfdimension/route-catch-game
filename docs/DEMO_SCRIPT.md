# Route Catch Game Demo Script

Target length: 8 to 12 minutes for the complete mobility and multiplayer
handoff demo. Shorten by demonstrating one full catch flow and using route-only
checks for the other modes.

## Before the Demo

1. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

2. Prepare Valhalla separately on `http://localhost:8002`.

   This is required for `MOTORCYCLE` and `WALKING`. The committed repository
   does not contain a Valhalla launcher, container, or tile-build workflow.

3. Start the committed application helper:

   ```bash
   ./scripts/run-all.sh
   ```

   It starts OSRM, Spring Boot, and Vite. It does not start PostgreSQL or
   Valhalla.

4. Run the committed diagnostic check:

   ```bash
   ./scripts/check-system.sh
   ```

   This proves the default CAR/OSRM path, PostgreSQL readiness, and backend
   health. It does not check Valhalla, so validate those modes explicitly:

   ```bash
   curl --fail-with-body \
     --header 'Content-Type: application/json' \
     --data '{"lat":28.6139,"lon":77.209,"travelMode":"MOTORCYCLE"}' \
     http://localhost:8080/api/nearest

   curl --fail-with-body \
     --header 'Content-Type: application/json' \
     --data '{"lat":28.6139,"lon":77.209,"travelMode":"WALKING"}' \
     http://localhost:8080/api/nearest
   ```

5. Open `http://localhost:5173`.
6. Prepare a second browser profile/private window for multiplayer.
7. Use Leaflet for the primary demo. It is the default and the renderer that
   received complete live PR #18 validation for all three modes.

## 1. Explain the Current Topology

Open [`ARCHITECTURE.md`](ARCHITECTURE.md) and summarize:

```text
React -> Spring Boot -> OSRM / Valhalla
                    -> PostgreSQL
React <-> Spring Boot over authenticated STOMP for multiplayer
```

Provider responsibility:

```text
SOLO CAR          -> OSRM
SOLO MOTORCYCLE   -> Valhalla motorcycle
SOLO WALKING      -> Valhalla pedestrian
multiplayer       -> established OSRM authoritative paths
```

Emphasize that provider identity is a backend concern and there is no silent
fallback.

## 2. Demonstrate SOLO CAR

1. Register/login or continue as a guest.
2. Choose **Car** and a short round.
3. Start the round.
4. Point out that the travel-mode selector is locked while the round is
   launching/running.
5. Wait for a target. Explain that publication required:

   ```text
   random candidate
       -> nearest(CAR)
       -> route to snapped candidate(CAR)
       -> compatibility validation
       -> publish
   ```

6. Select the target, show the route, and let the player move/catch.
7. Increase simulation speed if useful and explain that it changes game
   animation speed, not `CAR` routing semantics.
8. Show immediate local catch feedback plus backend score/count synchronization.

## 3. Demonstrate SOLO MOTORCYCLE

1. End or restart into a fresh setup state.
2. Choose **Motorcycle**.
3. Start a new round and show a target/chase route.
4. Explain the public request remains `travelMode: "MOTORCYCLE"`; only the
   backend adapter knows that Valhalla uses motorcycle costing.
5. If time permits, complete catch and later-spawn behavior.

Do not stop Valhalla and imply fallback. If Valhalla is unavailable, the
selected request correctly fails with a provider error.

## 4. Demonstrate SOLO WALKING

1. End or restart into setup and choose **Walking**.
2. Start the round and show route/nearest behavior.
3. Explain that route selection uses Valhalla pedestrian costing while
   `simulationSpeedMetersPerSecond` still controls accelerated game movement.
4. Complete a catch if time allows.

This is a useful invariant example: a visibly fast player can still be routed
with walking semantics.

## 5. Demonstrate Immutable Active Mode

During a running round, try the selector and show that it is disabled. Explain:

```text
selectedTravelMode  captured at launch  -> activeTravelMode
activeTravelMode    immutable until that round is gone
```

If a round ends with catch synchronization still reconciling, the selector may
become editable for the next round. A new selection does not rewrite the old
checkpoint's `round.travelMode`.

## 6. Demonstrate Refresh Recovery v2

Use a running WALKING round for a clear provider/mode example:

1. Start movement toward a target.
2. Refresh while moving.
3. Show that the original countdown did not restart.
4. Show the reconstructed player/route/targets/score state.
5. Confirm continued routing remains WALKING.

Explain the stored authority:

```text
schemaVersion = 2
checkpoint.round.travelMode = WALKING
```

The checkpoint stores semantic movement and absolute time, not rendered frames,
provider identity, or camera pose. IndexedDB database version remains 1. A
genuine legacy v1 checkpoint migrates in memory to v2 with CAR.

Known presentation note: Leaflet can restore semantically correct movement
while reopening at broader framing than desired. That is camera polish, not
recovery corruption.

## 7. Show Persistence and SOLO History

1. End the round.
2. Open Stats.
3. Show current-user stats/session history and persisted catch snapshots.
4. Point out stable catch IDs and idempotent backend synchronization: recovery
   replays the same logical catch without re-awarding local score/XP.

## 8. Demonstrate Multiplayer

Use two authenticated users in separate browser profiles.

1. Create/join the same room.
2. Start a room round as host.
3. Move a player and show backend-created, versioned OSRM movement plans.
4. Show shared creatures and a one-winner catch transition.
5. End the round and open the authoritative results.
6. Show ranking and the current user's catch snapshot.
7. Open multiplayer history in Stats.

Explain the isolation boundary:

- Multiplayer has no CAR/MOTORCYCLE/WALKING selector or TravelMode STOMP field.
- `MovementRouteClient` / `OsrmMovementRouteClient` owns authoritative OSRM
  movement routing.
- OSRM also performs multiplayer creature road snapping.
- Valhalla and `TravelRoutingService` are not multiplayer dependencies.

Then explain the storage split:

```text
active room/round/movement/creatures   in-memory, single JVM
completed results/ranks/catches        durable PostgreSQL
```

Completed history survives backend restart; an active room does not.

## 9. Optional Completed-Result Restart Proof

For easier process control, start components in separate terminals:

```bash
./scripts/run-osrm.sh
./scripts/run-backend.sh
./scripts/run-frontend.sh
```

With external Valhalla and PostgreSQL still running:

1. Record a completed multiplayer round ID.
2. Stop only Spring Boot.
3. Restart it with `./scripts/run-backend.sh`.
4. Query personal multiplayer history or the exact result as a persisted
   participant.
5. Show that the result survives while the previous active room does not.

## 10. Optional MapLibre Preview

Restart Vite with:

```bash
cd frontend
VITE_SOLO_MAP_RENDERER=maplibre npm run dev
```

Show `OVERVIEW`, `FOLLOW`, `FREE`, and Resume Follow on SOLO. Recovered
already-moving routes should enter `FOLLOW` directly. State clearly:

- MapLibre is opt-in and SOLO-only.
- Multiplayer remains Leaflet.
- Source/test travel-mode parity exists.
- Full browser live validation for all three MapLibre modes was not completed
  during PR #18, so this is not proof of production readiness.

## Close

Summarize the current milestone:

- Three immutable per-round SOLO travel modes behind a provider-neutral API.
- OSRM for CAR and multiplayer; Valhalla for SOLO motorcycle/walking.
- Mode-compatible spawning and recovery checkpoint schema v2.
- Accelerated simulation kept independent of routing semantics.
- Durable completed multiplayer history despite single-JVM active authority.
- Leaflet default, MapLibre opt-in SOLO, with productionization left as future
  work in [`ROADMAP.md`](ROADMAP.md).
