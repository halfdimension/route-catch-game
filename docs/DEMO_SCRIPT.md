# Interview Demo Script

Target length: 5 to 7 minutes.

## Before the Demo

1. Start one PostgreSQL instance.

   Use a local PostgreSQL installation when it is already configured:

   ```bash
   sudo systemctl start postgresql
   ```

   Or, on a fresh setup, use Docker Compose:

   ```bash
   docker compose up -d postgres
   ```

   Do not run both at the same time. The local service and Compose container
   both use port `5432`.

2. Start the application:

   ```bash
   ./scripts/run-all.sh
   ```

3. Verify the system in a second terminal:

   ```bash
   ./scripts/check-system.sh
   ```

4. Open `http://localhost:5173`.
5. Keep the application, README architecture diagram, and API documentation
   available in separate tabs.

## 1. Product Overview

Show the live map first.

> Route Catch Game is a full-stack map game. React and Leaflet run the live
> chase experience, Spring Boot owns the application API, OSRM supplies real
> road routes, and PostgreSQL persists sessions and catches.

Point out the compact player HUD, targets area, recent catches, and hidden
Stats control.

## 2. Start a Persisted Round

1. Select a short round duration.
2. Click **Start Game**.
3. Show the backend session ID and `RUNNING` status.
4. Explain that the frontend created and started a PostgreSQL-backed session.

## 3. Demonstrate Routing and Chase

1. Wait for targets to spawn.
2. Point out common, rare, and legendary marker styling.
3. Click a target marker or Targets row.
4. Show `Routing...`, the selected-target treatment, and the chase route.
5. Mention the request flow:

   ```text
   React -> Spring Boot -> OSRM -> Spring Boot -> React
   ```

6. Briefly show **Cancel chase**, then select a target again.

## 4. Catch a Creature

1. Increase simulation speed if needed.
2. Let the player reach the target.
3. Show the catch toast, map effect, local score/XP, and Recent Catches row.
4. Point out the backend score and caught-count synchronization.

Explain that local feedback is immediate and backend submission is
non-blocking, so a temporary sync failure does not freeze or roll back play.

## 5. Show Persistence and Stats

1. End the round.
2. Show the round summary.
3. Open **Stats** and select **History**.
4. Select the completed session and show its persisted catches.
5. Switch to **Leaderboard** and show completed-session ranking.
6. Explain stale `RUNNING` session auto-expiry.

## 6. Show Engineering Depth

Open the README architecture diagram or `docs/ARCHITECTURE.md`.

Call out:

- Spring Boot route and nearest wrappers isolate OSRM from the browser.
- Flyway owns schema creation and creature seed data.
- Catch insertion and session score updates share a transaction.
- DTO validation and global exception handling produce stable JSON errors.
- Docker Compose makes PostgreSQL setup reproducible.
- Build, test, orchestration, and diagnostic scripts support local development.

Use `docs/API.md` to show one route request and one catch-submission contract.

## 7. Optional Persistence Proof

Use manual debug mode when a backend-only restart is part of the demo:

```bash
./scripts/run-osrm.sh
./scripts/run-backend.sh
./scripts/run-frontend.sh
```

Run each command in a separate terminal.

1. Note a completed session ID and score.
2. Stop only the backend with Ctrl+C.
3. Restart it with `./scripts/run-backend.sh`.
4. Refresh History and Leaderboard.
5. Show that PostgreSQL retained the session and catches.

## 8. Close

Summarize the current boundary clearly:

- The backend owns catalog scoring, persistence, session state, history, and
  leaderboard data.
- OSRM provides road-aware routing.
- The frontend owns realtime animation, spawning, and catch detection.
- Authentication, hosted deployment, richer creatures, route challenges, and
  analytics are the next planned steps.
