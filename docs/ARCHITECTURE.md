# Route Catch Game Architecture

This document is the readable structural overview of the committed architecture
at PR #18 (`d44655c`). The detailed engineering handoff is
[`POKEMON_GAME_CONTEXT.md`](../POKEMON_GAME_CONTEXT.md); public request/response
contracts are in [`API.md`](API.md); proposed work belongs only in
[`ROADMAP.md`](ROADMAP.md). Committed source, configuration, migrations, and
tests are the ultimate implementation truth.

## Runtime Topology

```text
Browser / React / Vite
          |
          | REST + WebSocket/STOMP
          v
     Spring Boot
       /   |    \
      /    |     \
     v     v      v
   OSRM  Valhalla PostgreSQL
```

Default local addresses:

```text
Vite           http://localhost:5173
Spring Boot    http://localhost:8080
OSRM           http://localhost:5000
Valhalla       http://localhost:8002
PostgreSQL     localhost:5432
```

The browser calls Spring Boot rather than directly treating OSRM or Valhalla as
application authority. PostgreSQL schema changes are Flyway-owned; Hibernate
uses `ddl-auto=validate`.

Provider responsibilities are intentionally asymmetric:

| Provider | Current responsibility |
|---|---|
| OSRM | SOLO `CAR` route and nearest; multiplayer movement routing; multiplayer creature road snapping |
| Valhalla | SOLO `MOTORCYCLE` and `WALKING` route and nearest |
| PostgreSQL | Users, SOLO sessions/catches/history, creature catalog, completed multiplayer rounds/participants/catch snapshots/history |

## Authority Split

SOLO and multiplayer are different game architectures.

| Concern | SOLO | Multiplayer |
|---|---|---|
| Movement | Frontend epoch-anchored route plan | Backend-created versioned movement plan |
| Routing | Frontend requests provider-neutral backend API with immutable active mode | Backend uses OSRM through the multiplayer movement boundary |
| Targets/creatures | Frontend lifecycle after mode-compatible validation | Backend-owned shared instances |
| Catch | Immediate local transition plus stable-ID backend synchronization | Backend one-winner transition and score; distance currently uses submitted position |
| Score | Frontend gameplay truth plus backend session synchronization | Backend authoritative |
| Round timer | Frontend absolute timeline | Backend room round |
| Active recovery | Transient IndexedDB checkpoint | Not implemented across backend restart |
| Completed history | PostgreSQL session/catch history | PostgreSQL round/player/catch history |

Do not make multiplayer client-authoritative because SOLO already has similar
presentation code. Do not add SOLO `TravelMode` fields to multiplayer commands,
events, plans, or persistence without a separate authority/concurrency design.

## Provider-Neutral SOLO Routing

The public routing boundary is:

```text
RoutingController / NearestController
                |
                v
       TravelRoutingService
                |
                v
       TravelRoutingProvider
          /             \
         v               v
OsrmRoutingService   ValhallaRoutingService
    CAR only         MOTORCYCLE / WALKING
```

`TravelMode` contains exactly:

```text
CAR
MOTORCYCLE
WALKING
```

There is no `BICYCLE`. Public strings are provider-neutral. The controller
turns missing or JSON `null` into `CAR`; values are otherwise case-sensitive.
The façade makes one deterministic selection:

```text
CAR          -> OsrmRoutingService
MOTORCYCLE   -> ValhallaRoutingService (costing: motorcycle)
WALKING      -> ValhallaRoutingService (costing: pedestrian)
```

There is no silent runtime fallback. If Valhalla fails for `WALKING`, the
request fails; it is not rerouted as OSRM driving. Provider identity does not
leak into frontend gameplay state or recovery checkpoints.

### Valhalla Normalization

`ValhallaRoutingService`:

- sends `POST /route` with two locations, `kilometers`, and no directions;
- sends `POST /locate` with one location, matching costing, and `verbose=true`;
- decodes polyline6 geometry through the shared `Polyline6Decoder`;
- concatenates multiple legs and removes only a duplicate join coordinate;
- converts route summary length from kilometres to metres;
- preserves normalized duration in seconds;
- selects the closest usable locate edge;
- extracts the first nonblank road name, or returns `null`;
- validates route status, units, metrics, legs, shapes, coordinates, and locate
  candidates; and
- sanitizes provider failures into the public routing error contract.

Committed defaults are a 2-second connect timeout and 10-second read timeout.
Historical local validation used Valhalla at `localhost:8002`. The repository
does not start or prepare Valhalla.

## SOLO Travel-Mode Lifecycle

Two values have different meanings:

```text
selectedTravelMode   mutable setup choice / next-round preference
activeTravelMode     immutable authority for active or reconciling round
```

Round launch and restart capture synchronously:

```text
selectedTravelMode
        |
        | beginRoundOperation / beginRestartOperation
        v
activeTravelMode + operation scope
        |
        v
checkpoint.round.travelMode
```

Selection is locked while synchronous launch ownership exists and in
`STARTING` or `RUNNING`. It is editable in `RECONCILING`. The old round retains
its active mode even when the next-round preference changes:

```text
checkpoint.round.phase       = RECONCILING
checkpoint.round.travelMode  = WALKING
activeTravelMode             = WALKING
selectedTravelMode           = MOTORCYCLE   # valid next-round choice
```

Checkpoint builders preserve the previous round's mode when updating the same
round. Identity, lifecycle, replay, route, spawn, operation, and writer
generations prevent old callbacks from overwriting a newer round, including ABA
identity/lifecycle sequences.

All active SOLO work obtains its mode from a captured active-round operation:

- confirmed map routes;
- chase routes;
- target nearest requests;
- target validation routes;
- later spawn cadence after catches;
- recovered `ROUTING` continuation; and
- new/restarted rounds after synchronous capture.

The backend's missing-mode `CAR` default remains for compatibility, but active
SOLO gameplay explicitly sends its active mode and does not rely on that
default.

### Simulation Speed Is Separate

```text
TravelMode                        routing semantics/provider selection
simulationSpeedMetersPerSecond    game movement-speed authority
provider duration                 informational route metric
```

The game intentionally supports accelerated simulation. Provider duration does
not control frontend route progress, and an avatar or future presentation
change must not silently switch routing mode.

## Mode-Compatible SOLO Targets

A spawn opportunity publishes a target only after this pipeline succeeds:

```text
random raw candidate
        |
        | nearest(activeTravelMode)
        v
mode-compatible snapped candidate
        |
        | route(player -> candidate, same activeTravelMode)
        v
validate route structure, metrics, measured geometry, endpoint
        |
        v
publish target
```

Current validation requires:

- no raw-coordinate or snapped-only fallback;
- the same captured mode for nearest and route;
- at least two finite, valid route coordinates;
- finite provider distance greater than zero;
- finite measured geometry greater than `0.01 m`; and
- the route's final geometry coordinate within `25 m` of the snapped target.

The 25 m routing endpoint tolerance is independent of the gameplay catch
radius. Each spawn opportunity tries at most three candidates. Exhaustion does
not publish a degraded target; the ordinary later spawn cadence may try again.

Only the current generation/in-flight operation may publish. Staleness is
checked before and after both nearest and route calls, so an old result cannot
publish into a newer round, identity, mode, pause/resume cycle, or spawn
generation.

## SOLO Recovery Architecture

Current checkpoint schema:

```text
schemaVersion = 2
round.travelMode = CAR | MOTORCYCLE | WALKING   # required
```

The IndexedDB database version remains 1 because the object-store structure did
not change. A legacy record migrates only through this strict path:

```text
validate as genuine schema v1
        -> clone/migrate in memory
        -> schemaVersion = 2
        -> round.travelMode = CAR
        -> validate as schema v2
```

The store does not rewrite a v1 record merely by reading it. Bootstrap and any
later replacement remain within identity/lifecycle/writer-generation guards.

Provider identity is not stored. `activeTravelMode` is restored from
`round.travelMode`; `selectedTravelMode` is not persisted as separate gameplay
truth, although hydration initializes the selector to the recovered mode for a
consistent UI.

### Recovery State and Time

The checkpoint stores semantic round state:

- identity, client round UUID, backend session UUID, phase, duration, absolute
  start/end time, and expiry;
- settled player position and simulation speed;
- active travel mode;
- `ROUTING`/`MOVING` intent, route geometry, and movement anchor;
- targets, caught targets, score, XP, spawning state, and next absolute spawn
  deadline; and
- pending stable-ID catch synchronization evidence.

It does not store provider identity, rendered frames, Leaflet/MapLibre camera
pose, `FREE` mode, or animation state.

Authentication resolution is a bootstrap barrier:

```text
AUTH_UNRESOLVED -> RECOVERY_LOADING -> RECOVERY_READY
```

Fresh movement, spawning, and catches stay blocked until READY. Checkpoints are
scoped to authenticated user UUID or stable guest installation UUID.

Movement and round time are reconstructed from wall-clock epochs:

```text
distance(now) = clamp(
    anchorDistance + elapsedSeconds * simulationSpeed,
    0,
    measuredRouteLength
)
```

Reload time therefore advances both movement and the round. Absolute target
expiry and spawn cadence remain authoritative. Live and recovered catch
processing use route-interval geometry, including terminal ordering and exact
round/expiry cutoffs.

### Checkpoint Phases and Retention

```text
STARTING       createdAt + 2 minutes
RUNNING        endsAt + 15 minutes storage grace; resumable only before endsAt
RECONCILING    endsAt + 15 minutes; never resumes gameplay
```

The normal production launch currently writes its first checkpoint as
`RUNNING` only after the backend session starts. The crash window after backend
start but before that first durable checkpoint remains outside the guarantee.

Stable catch UUIDs make exact backend retries idempotent. Pending catches replay
without re-awarding local score/XP. Replacement/deletion writers are serialized
per identity and protected by tombstones, generations, native barriers, and
single-flight submission ownership.

## Renderer Separation

Leaflet is the default SOLO renderer and the multiplayer renderer. MapLibre is
enabled for SOLO with `VITE_SOLO_MAP_RENDERER=maplibre` and is not wired into
multiplayer.

Both SOLO renderers consume the same player, route, target, score, travel-mode,
and recovery truth. MapLibre adds presentation-local camera states:

```text
OVERVIEW -> FOLLOW -> FREE
               ^        |
               +--------+ Resume Follow
```

Fresh MapLibre routes show a short overview prelude before follow. Recovered
already-moving routes carry an ephemeral `RECOVERED_ACTIVE` start intent and
enter `FOLLOW` directly. A recovered `ROUTING` intent requests a fresh route
using `checkpoint.round.travelMode`.

MapLibre camera pose and mode are not checkpointed. Source/test parity exists
for travel modes, but PR #18 did not establish full browser live validation for
all MapLibre mode flows. A known Leaflet presentation observation is that
semantically correct recovered movement can reopen with broader framing than
desired; that is camera polish, not state corruption.

## Multiplayer Routing Isolation

Multiplayer does not use `TravelRoutingService`, Valhalla, or SOLO
`TravelMode`.

Authoritative multiplayer movement remains:

```text
authenticated STOMP intent
        -> RoomMovementService / InMemoryRoomMovementService
        -> MovementRouteClient
        -> OsrmMovementRouteClient
        -> OSRM driving polyline6
```

`Polyline6Codec` delegates decoding to the shared `Polyline6Decoder`, then
retains multiplayer interpolation/geometry responsibilities. This shared codec
utility does not merge provider authority.

Multiplayer creature road snapping remains explicit OSRM through
`OsrmRoomCreatureRoadSnapper` and `OsrmRoutingService`. Boundary tests prohibit
`TravelRoutingService`, Valhalla, and `TravelMode` dependencies in these paths.

Movement plans carry movement UUID, per-player version, route geometry,
distance, simulation speed, server timestamps, destination type, and status.
Room event sequences, command IDs, expected movement versions, round UUIDs,
room generation, state revisions, scheduled-completion guards, and client
connection/subscription generations prevent stale work from replacing current
state.

## Multiplayer Realtime and Finalization

STOMP uses `/ws`, authenticated `CONNECT`, `/app/rooms/{roomCode}/...` commands,
and `/topic/rooms/{roomCode}/...` subscriptions. Presence supplies identity,
liveness, and a fallback position; it is not continuous authoritative movement
truth.

The room lifecycle separates room status from game status:

```text
game: WAITING -> RUNNING -> FINALIZING -> ENDED
room: OPEN / IN_PROGRESS / CLOSED
```

At finalization the single room coordinator freezes movement and creatures,
stops the spawn generation, snapshots the frozen start-time participant roster,
calculates deterministic competition ranking, constructs one immutable result,
persists it, and only then exposes `ENDED` and attempts `GAME_ENDED`.

Persistence and WebSocket publication are separate:

```text
PostgreSQL commit  -> durable result truth
GAME_ENDED         -> timely notification with bounded in-memory retry
REST               -> reconnect/restart recovery
```

## Active State vs Completed History

This distinction is fundamental:

| State | Current storage/authority |
|---|---|
| Rooms, presence, active movement, sequences, active creatures, spawn loops, running/finalizing coordination | In-memory, single Spring Boot JVM |
| Completed round metadata | PostgreSQL `game_rounds` |
| Participant rank/score/rarity totals | PostgreSQL `game_round_players` |
| Immutable participant catch snapshots | PostgreSQL `game_round_player_catches` |

V5 added the three completed-result tables. Exact and latest result reads plus
`GET /api/multiplayer/me/rounds` survive process restart and authorize against
persisted participation. Completed-history durability does not reconstruct an
active or `FINALIZING` round.

## Critical Invariants

- Provider choice is deterministic and has no silent fallback.
- An active SOLO round has one immutable travel mode.
- Reconciliation-time next-round selection cannot rewrite old checkpoint truth.
- Travel mode and simulation speed remain independent.
- Target nearest and validation route use the same captured active mode.
- SOLO recovery remains identity-, lifecycle-, generation-, replay-, and
  writer-scoped.
- Wall-clock movement/time and stable catch IDs remain authoritative across
  refresh.
- Renderer presentation never becomes gameplay or routing authority.
- Multiplayer identity, routes, shared catches, scoring, and round lifecycle
  remain backend-owned.
- Multiplayer movement versions, room sequences, round UUID/generation, and
  scheduled-callback guards must not be weakened.
- Persistence precedes durable round completion; publication retry is
  notification-only.
- Historical result authorization uses persisted round participation, not
  mutable room membership or display name.

## Current Limitations

- Valhalla startup, data preparation, readiness checking, and deployment are
  not repository-managed.
- OSRM scripts contain machine-specific paths.
- `/api/health` does not probe routing providers.
- Active multiplayer state and `FINALIZING` recovery remain single-JVM and
  non-durable.
- Multiplayer catch distance trusts client-submitted coordinates.
- Presence updates are authenticated but the handler does not independently
  enforce room membership.
- `GAME_ENDED` retry/dedup state is in memory; no durable outbox exists.
- SOLO checkpoints are transient/TTL-bound, not historical storage.
- MapLibre is SOLO-only, opt-in, and has no full browser E2E suite.
- The repository has no full browser E2E suite or complete hosted deployment.

Future work is intentionally isolated in [`ROADMAP.md`](ROADMAP.md).
