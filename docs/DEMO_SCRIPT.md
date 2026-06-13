# Demo Script

This walkthrough is designed for a short project demonstration.

## 1. Start the System

Confirm PostgreSQL is running, then execute:

```bash
./scripts/run-all.sh
```

Optionally run the checks in another terminal:

```bash
./scripts/check-system.sh
```

Open `http://localhost:5173`.

For the backend-only restart in step 7, use manual debug mode instead:

```bash
./scripts/run-osrm.sh
./scripts/run-backend.sh
./scripts/run-frontend.sh
```

Run each command in its own terminal.

## 2. Introduce the Architecture

Explain the runtime flow:

```text
React + Leaflet -> Spring Boot -> OSRM
                              -> PostgreSQL
```

The frontend animates the game. Spring Boot wraps routing, validates catches
against its catalog, and persists sessions and catch snapshots.

## 3. Show the Map and Start a Round

1. Point out the player HUD and duration selector.
2. Choose a short round duration.
3. Select **Start Game**.
4. Show the compact backend session ID and `RUNNING` status.

## 4. Chase a Creature

1. Wait for targets to appear.
2. Compare common, rare, and legendary marker treatments.
3. Click a marker or Targets row.
4. Show the `Routing...` state, highlighted target, and chase route.
5. Mention that Spring Boot requests the route from local OSRM.

## 5. Catch a Creature

1. Increase simulation speed if needed.
2. Let the player reach the creature.
3. Show the catch toast, map effect, score, XP, and Recent Catches highlight.
4. Point out the backend score and caught count in the session panel.

Local feedback is immediate. Backend catch submission runs separately and does
not block the game.

## 6. Show Persisted Stats

1. End the round.
2. Open **Stats**.
3. Select **History** and choose the completed session.
4. Show its persisted catch list.
5. Select **Leaderboard** and refresh.
6. Show that only ended sessions are ranked.

## 7. Demonstrate Persistence

1. Copy the session's short ID or note its score.
2. In manual debug mode, stop the backend terminal with Ctrl+C.
3. Restart it:

```bash
./scripts/run-backend.sh
```

4. Refresh History and Leaderboard.
5. Explain that PostgreSQL retains sessions and caught-creature snapshots.
6. Mention that Flyway validates migration history and keeps the seeded
   creature catalog available after restart.

## 8. Close with Current Boundaries

- OSRM supplies real road snapping and routes.
- PostgreSQL persists catalog and game records.
- Spring Boot owns catalog scores and session state.
- The browser still owns spawning, movement animation, catch detection, and
  progression.
- Authentication, multiplayer, and broader anti-cheat remain future work.
